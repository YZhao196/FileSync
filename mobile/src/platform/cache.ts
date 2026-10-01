/**
 * The app's cache directory — UI-MOBILE.md §4's "Storage & cache".
 *
 * The spec's framing is exact and worth repeating: thumbnails "accumulate on
 * demand and are **disposable** — clearing them costs nothing but a
 * re-download". So this reports a number and empties a directory, and nothing
 * depends on the contents surviving.
 *
 * Today the directory holds downloaded files from the viewer and the file
 * browser. It does *not* yet hold thumbnails, because there is no thumbnail
 * cache — `usePhotoUri` refetches every mount. So the number here is honest but
 * small, and will become the number the spec means once that lands.
 *
 * Everything is wrapped rather than assumed: the filesystem API is new, its
 * shapes are still settling, and a settings screen that throws because it could
 * not measure a directory would take the whole tab down with it.
 */

import { Directory, Paths } from 'expo-file-system'

/** Bytes in the cache directory, or null if it could not be measured. */
export async function cacheBytes(): Promise<number | null> {
  try {
    const entries = new Directory(Paths.cache).list()
    let total = 0
    for (const entry of entries) {
      // `size` is on files, not directories. A nested directory's contents are
      // not counted, which is a real undercount and the reason this is
      // described as approximate rather than exact.
      const size = (entry as { size?: number | null }).size
      if (typeof size === 'number') total += size
    }
    return total
  } catch {
    return null
  }
}

/**
 * Empties the cache directory.
 *
 * Deletes the contents rather than the directory itself: the directory is
 * managed by the platform, and removing it is a good way to find out that
 * something else writes there.
 */
export async function clearCache(): Promise<boolean> {
  try {
    const directory = new Directory(Paths.cache)
    for (const entry of directory.list()) {
      entry.delete()
    }
    return true
  } catch {
    return false
  }
}
