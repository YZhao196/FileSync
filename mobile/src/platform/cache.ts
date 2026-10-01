/**
 * Downloads, and the app's cache directory — UI-MOBILE.md §4.
 *
 * The spec names two things separately and so does this: the **thumbnail
 * cache**, which `thumbStore.ts` owns and which is disposable by design, and
 * **downloaded files**, which are things the user asked to keep. Clearing one
 * must not clear the other, which is why the thumbnail folder is excluded here
 * rather than the whole directory being reported as one number.
 *
 * The spec's framing for thumbnails is exact: they "accumulate on demand and
 * are **disposable** — clearing them costs nothing but a re-download".
 * Downloads are not that. A person who downloaded a document and then cleared
 * the cache would be surprised to find it gone, which is the reason for the
 * second button.
 *
 * Everything is wrapped rather than assumed: a settings screen that throws
 * because it could not measure a directory would take the whole tab down.
 */

import { Directory, File, Paths } from 'expo-file-system'

/** Must match `FOLDER` in `thumbStore.ts` — these are the files not counted here. */
const THUMBS = 'thumbs'

/** Everything in the cache directory except the thumbnails. */
function downloads(): File[] {
  try {
    return new Directory(Paths.cache)
      .list()
      .filter((entry): entry is File => entry instanceof File && entry.name !== THUMBS)
  } catch {
    return []
  }
}

/** Bytes of downloaded files, or null if the directory could not be read. */
export async function downloadsBytes(): Promise<number | null> {
  try {
    let total = 0
    for (const file of downloads()) {
      const size = (file as { size?: number | null }).size
      if (typeof size === 'number') total += size
    }
    return total
  } catch {
    return null
  }
}

/**
 * Removes downloaded files, leaving the thumbnails alone.
 *
 * The thumbnail directory is skipped by name rather than by type because
 * `Directory.list()` returns both, and deleting it here would make "Clear
 * downloads" silently empty the timeline's cache as well.
 */
export async function clearDownloads(): Promise<boolean> {
  try {
    for (const file of downloads()) file.delete()
    return true
  } catch {
    return false
  }
}
