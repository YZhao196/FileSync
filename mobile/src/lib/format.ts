/** Display formatting. Sizes are binary (GiB shown as "GB", as the design does). */

const UNITS: ReadonlyArray<readonly [string, number]> = [
  ['TB', 1024 ** 4],
  ['GB', 1024 ** 3],
  ['MB', 1024 ** 2],
  ['KB', 1024],
]

export function compactBytes(n: number): string {
  for (const [unit, factor] of UNITS) {
    if (n >= factor) {
      const v = n / factor
      return `${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${unit}`
    }
  }
  return `${Math.round(n)} B`
}

export function usedOverTotal(used: number, total: number): string {
  return `${compactBytes(used)} / ${compactBytes(total)}`
}

export function percent(used: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, (used / total) * 100))
}

/** "Today 03:14" · "Tomorrow 03:14" · "Sep 14 03:14" */
export function formatClock(iso: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown'

  const today = new Date()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(d, today)) return `Today ${time}`
  if (sameDay(d, new Date(today.getTime() + 86_400_000))) return `Tomorrow ${time}`
  if (sameDay(d, new Date(today.getTime() - 86_400_000))) return `Yesterday ${time}`
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`
}

export function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  if (days === 0) return `${hours} h`
  return `${days} days, ${hours} h`
}
