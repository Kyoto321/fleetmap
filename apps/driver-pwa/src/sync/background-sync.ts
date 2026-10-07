/**
 * Background Sync — drains the mutations_queue when connectivity is restored.
 *
 * Called by:
 * 1. Service Worker 'sync' event (when supported — Chrome/Android)
 * 2. 'online' event listener in the app (iOS Safari fallback)
 *
 * Implements idempotent replay:
 * - Each mutation has a tracking_uuid sent as X-Tracking-UUID header
 * - Server deduplicates using this key (Redis SET with TTL)
 * - On 409 Conflict: server resolved it — remove from queue
 * - On 5xx: keep in queue, increment retry counter
 * - After 10 retries: discard to prevent stale queue growth
 */

import {
  getPendingMutations,
  removeMutation,
  incrementMutationRetry,
  type PendingMutation,
} from '../db'

const MAX_RETRIES = 10

export async function drainMutationsQueue(authToken: string, subdomain?: string): Promise<SyncResult> {
  const mutations = await getPendingMutations()

  if (mutations.length === 0) return { synced: 0, failed: 0, errors: [] }

  const result: SyncResult = { synced: 0, failed: 0, errors: [] }

  for (const mutation of mutations) {
    if (mutation.retry_count >= MAX_RETRIES) {
      // Discard permanently stale mutations
      await removeMutation(mutation.id!)
      result.errors.push(`Discarded stale mutation ${mutation.tracking_uuid}`)
      continue
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type':     'application/json',
        'Authorization':    `Bearer ${authToken}`,
        'X-Tracking-UUID': mutation.tracking_uuid,
      }
      if (subdomain) {
        headers['X-Subdomain'] = subdomain
      }

      const response = await fetch(mutation.endpoint, {
        method:  mutation.method,
        headers,
        body: mutation.method !== 'DELETE'
          ? JSON.stringify({
              ...mutation.payload,
              client_updated_at: mutation.client_timestamp,
            })
          : undefined,
        credentials: 'include'
      })

      if (response.ok || response.status === 409) {
        // 409 = conflict resolved server-side — still safe to remove from queue
        await removeMutation(mutation.id!)
        result.synced++
      } else if (response.status >= 500) {
        await incrementMutationRetry(mutation.id!)
        result.failed++
        result.errors.push(`Server error ${response.status} for ${mutation.tracking_uuid}`)
      } else if (response.status === 401) {
        // Auth expired — stop draining, need fresh token
        break
      } else {
        // 4xx client error — discard (won't recover)
        await removeMutation(mutation.id!)
        result.errors.push(`Client error ${response.status} — discarded ${mutation.tracking_uuid}`)
      }
    } catch (networkError) {
      // Network not yet available — stop draining this cycle
      result.failed++
      break
    }
  }

  return result
}

export interface SyncResult {
  synced: number
  failed: number
  errors: string[]
}
