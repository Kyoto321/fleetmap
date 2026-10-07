import Dexie, { type Table } from 'dexie'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CachedJob {
  id:               string
  tenant_id:        string
  title:            string
  description:      string | null
  status:           string
  priority:         number
  scheduled_at:     string | null
  completed_at:     string | null
  driver_id:        string | null
  vehicle_id:       string | null
  delivery_address: object | null
  version:          number
  server_updated_at: string
  metadata:         Record<string, unknown>
  synced_at:        string
}

export interface PendingMutation {
  id?:              number          // Auto-increment local ID
  tracking_uuid:   string          // Client-generated idempotency key
  method:          'POST' | 'PATCH' | 'DELETE'
  endpoint:        string
  payload:         Record<string, unknown>
  client_timestamp: string         // Client-side UTC timestamp for LWW
  retry_count:     number
  last_retry_at:   string | null
  created_at:      string
}

// ── Database ──────────────────────────────────────────────────────────────────

class FleetDB extends Dexie {
  jobs_cache!:      Table<CachedJob, string>
  mutations_queue!: Table<PendingMutation, number>

  constructor() {
    super('FleetPlatformDB')

    this.version(1).stores({
      // jobs_cache: indexed by id (primary), tenant_id, status, scheduled_at
      jobs_cache:      'id, tenant_id, status, scheduled_at, synced_at',
      // mutations_queue: auto-increment PK, indexed by tracking_uuid and creation time
      mutations_queue: '++id, tracking_uuid, created_at, retry_count',
    })
  }
}

export const db = new FleetDB()

// ── Helpers ───────────────────────────────────────────────────────────────────

export async function upsertJob(job: CachedJob): Promise<void> {
  await db.jobs_cache.put({ ...job, synced_at: new Date().toISOString() })
}

export async function bulkUpsertJobs(jobs: CachedJob[]): Promise<void> {
  const now = new Date().toISOString()
  await db.jobs_cache.bulkPut(jobs.map((j) => ({ ...j, synced_at: now })))
}

export async function getJobsByStatus(status?: string): Promise<CachedJob[]> {
  if (status) {
    return db.jobs_cache.where('status').equals(status).sortBy('scheduled_at')
  }
  return db.jobs_cache.orderBy('scheduled_at').toArray()
}

export async function enqueueMutation(
  mutation: Omit<PendingMutation, 'id' | 'retry_count' | 'last_retry_at' | 'created_at'>
): Promise<number> {
  return db.mutations_queue.add({
    ...mutation,
    retry_count: 0,
    last_retry_at: null,
    created_at: new Date().toISOString(),
  })
}

export async function getPendingMutations(): Promise<PendingMutation[]> {
  return db.mutations_queue.orderBy('created_at').toArray()
}

export async function removeMutation(id: number): Promise<void> {
  await db.mutations_queue.delete(id)
}

export async function incrementMutationRetry(id: number): Promise<void> {
  await db.mutations_queue.where('id').equals(id).modify((m) => {
    m.retry_count++
    m.last_retry_at = new Date().toISOString()
  })
}
