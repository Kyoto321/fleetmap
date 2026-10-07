/** Throttle — returns a function that fires at most once every `ms` milliseconds */
export function throttle<T extends (...args: Parameters<T>) => ReturnType<T>>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let lastCall = 0
  let scheduled: ReturnType<typeof setTimeout> | null = null

  return (...args: Parameters<T>) => {
    const now = Date.now()
    const remaining = ms - (now - lastCall)

    if (remaining <= 0) {
      if (scheduled) { clearTimeout(scheduled); scheduled = null }
      lastCall = now
      fn(...args)
    } else if (!scheduled) {
      scheduled = setTimeout(() => {
        lastCall = Date.now()
        scheduled = null
        fn(...args)
      }, remaining)
    }
  }
}

/** Format a datetime string to a locale-friendly string */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/** Map job status to badge class */
export function statusToBadgeClass(status: string): string {
  const map: Record<string, string> = {
    pending:     'badge-neutral',
    assigned:    'badge-info',
    in_progress: 'badge-warning',
    completed:   'badge-success',
    failed:      'badge-danger',
    cancelled:   'badge-neutral',
  }
  return map[status] ?? 'badge-neutral'
}

/** Map vehicle status to badge class */
export function vehicleStatusClass(status: string): string {
  const map: Record<string, string> = {
    en_route:    'badge-info',
    idle:        'badge-success',
    offline:     'badge-neutral',
    maintenance: 'badge-warning',
  }
  return map[status] ?? 'badge-neutral'
}
