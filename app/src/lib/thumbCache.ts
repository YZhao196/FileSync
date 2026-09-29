/**
 * Session thumbnail accounting.
 *
 * PLAN.md §11 wants a thumbnail cache on each device — derived, disposable,
 * rebuildable. What exists here is the *session* half of that: every thumbnail
 * fetched is counted and its object URL registered, so Settings can report real
 * numbers and "Clear cache" can actually release something.
 *
 * There is no on-disk cache yet. That is a genuine gap, not a hidden one, and
 * it is recorded in for-human.md — an object URL dies with the process, so this
 * cache does not survive a restart and cannot make a cold start faster.
 */

type Listener = () => void

const urls = new Set<string>()
const listeners = new Set<Listener>()

let bytes = 0
let count = 0
let generation = 0

/** Bumped by `clear()`. Tiles depend on it, so they re-fetch afterwards. */
export function cacheGeneration(): number {
  return generation
}

export function noteThumb(bytesFetched: number): void {
  bytes += bytesFetched
  count += 1
}

export function trackUrl(url: string): void {
  urls.add(url)
}

export function releaseUrl(url: string): void {
  urls.delete(url)
}

export interface CacheStats {
  count: number
  bytes: number
}

export function cacheStats(): CacheStats {
  return { count, bytes }
}

export function subscribeCache(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Releases every object URL handed out this session and resets the counters.
 *
 * Visible thumbnails are re-fetched rather than broken: revoking a URL that an
 * `<img>` is still displaying would leave a blank tile, so the generation bump
 * tells `useThumb` to ask the backend again.
 */
export function clearCache(): void {
  for (const url of urls) URL.revokeObjectURL(url)
  urls.clear()
  bytes = 0
  count = 0
  generation += 1
  for (const fn of listeners) fn()
}
