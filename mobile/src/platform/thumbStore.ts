/**
 * On-disk thumbnail cache.
 *
 * The desktop stores thumbnails in IndexedDB, which React Native does not have.
 * What it does have is a filesystem, and for images that is strictly better: a
 * cached thumbnail is a real file with a real `file://` URI, which
 * `expo-image` will load directly. The desktop's IndexedDB version has to hand
 * back a Blob and then make an object URL out of it. Here there is no second
 * copy in memory and no base64.
 *
 * The interface mirrors `app/src/lib/thumbStore.ts` — same `cacheKey` shape,
 * same "every failure is a silent miss" rule — so the two clients think about
 * the cache the same way even though they store it differently.
 *
 * PLAN.md §11 puts the thumbnail cache on each device: derived, disposable,
 * rebuildable. So nothing here is precious, and every function fails to a miss
 * rather than throwing. A cache that throws is worse than no cache, because the
 * caller then has to handle a failure from the thing whose whole job is to be
 * optional.
 *
 * UNVERIFIED: that `file://` URIs resolve inside `expo-image` on both
 * platforms. A miss there shows the gradient, which is exactly what a failed
 * cache read does anyway — the failure mode is a slower app, not a broken one.
 */

import { Directory, File, Paths } from 'expo-file-system'

/** Bumped when the cache should discard everything written before it. */
const SCHEMA = 'v1'

const FOLDER = 'thumbs'

/**
 * Stable across devices and restarts, and used as a filename.
 *
 * The desktop's version is `v1|scope|size|id`, pipe-separated because IndexedDB
 * keys can hold anything. Here the key becomes a path component, so the
 * separators are replaced — `/` in it would silently create a directory.
 */
export const cacheKey = (scope: string, size: string, id: number | string): string =>
  `${SCHEMA}-${scope}-${size}-${id}`.replace(/[^A-Za-z0-9._-]/g, '_')

function folder(): Directory {
  return new Directory(Paths.cache, FOLDER)
}

function fileFor(key: string): File {
  return new File(folder(), `${key}.bin`)
}

/** The URI of a cached thumbnail, or null if it is not there. */
export function readThumb(key: string): string | null {
  try {
    const file = fileFor(key)
    return file.exists ? file.uri : null
  } catch {
    return null
  }
}

/**
 * Stores a thumbnail and returns its URI.
 *
 * Returns null on any failure, and the caller falls back to what it fetched —
 * the bytes are already in hand, so a cache that cannot write costs nothing.
 */
export function writeThumb(key: string, bytes: Uint8Array): string | null {
  try {
    const directory = folder()
    if (!directory.exists) directory.create({ intermediates: true })

    const file = fileFor(key)
    if (file.exists) file.delete()
    file.create()
    file.write(bytes)
    return file.uri
  } catch {
    return null
  }
}

export async function clearThumbs(): Promise<void> {
  try {
    const directory = folder()
    if (directory.exists) directory.delete()
  } catch {
    // Nothing to do about it, and nothing depends on it succeeding.
  }
}

export interface ThumbStats {
  count: number
  bytes: number
}

export async function thumbStats(): Promise<ThumbStats> {
  try {
    const directory = folder()
    if (!directory.exists) return { count: 0, bytes: 0 }

    let count = 0
    let bytes = 0
    for (const entry of directory.list()) {
      count += 1
      const size = (entry as { size?: number | null }).size
      if (typeof size === 'number') bytes += size
    }
    return { count, bytes }
  } catch {
    return { count: 0, bytes: 0 }
  }
}
