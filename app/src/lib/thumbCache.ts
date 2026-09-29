/**
 * Thumbnail cache bookkeeping.
 *
 * Two halves, and they are different things:
 *
 * - **Object URLs** handed to `<img>` tags. They die with the process, so they
 *   are tracked here only so `clearCache()` can revoke them rather than leave a
 *   blank tile on screen.
 * - **The on-disk store** in `thumbStore.ts`, which is what makes a cold start
 *   fast (PLAN.md §11). This module owns the counters Settings reports, seeded
 *   from the store and incremented as new thumbnails are written.
 */

import { clearThumbs, storedStats } from './thumbStore'

type Listener = () => void

const urls = new Set<string>()
const listeners = new Set<Listener>()

let bytes = 0
let count = 0
let generation = 0

/** Bumped by `clearCache()`. Tiles depend on it, so they re-fetch afterwards. */
export function cacheGeneration(): number {
  return generation
}

function notify(): void {
  for (const fn of listeners) fn()
}

/**
 * Seeds the counters from what is already on disk.
 *
 * Called once at startup. Without it the figure in Settings would describe this
 * session only, and would read zero on a machine with a full cache.
 */
export async function hydrateThumbs(): Promise<void> {
  const stored = await storedStats()
  count = stored.count
  bytes = stored.bytes
  notify()
}

/** A thumbnail was fetched and written to disk: it counts from now on. */
export function noteThumb(bytesFetched: number): void {
  bytes += bytesFetched
  count += 1
  notify()
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
 * Releases every object URL handed out this session, empties the on-disk store,
 * and resets the counters.
 *
 * Visible thumbnails are re-fetched rather than broken: revoking a URL that an
 * `<img>` is still displaying would leave a blank tile, so the generation bump
 * tells `useThumb` to ask the backend again.
 */
export function clearCache(): void {
  for (const url of urls) URL.revokeObjectURL(url)
  urls.clear()
  void clearThumbs()
  bytes = 0
  count = 0
  generation += 1
  notify()
}
