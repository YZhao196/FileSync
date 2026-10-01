/**
 * What the photo action bars actually do.
 *
 * One hook, used by the viewer's bottom bar and by the selection bar, so
 * "delete" cannot mean two subtly different things depending on where it was
 * tapped. Every action reports through the same `message`, because the spec
 * asks for a toast on every result and the alternative is each bar inventing
 * its own wording.
 *
 * Two of these are worth reading before changing:
 *
 *   - **Delete goes to the server's trash, not to gone.** `force: false` on the
 *     Immich side is the whole point — PLAN.md §10 says the app must not be the
 *     thing that destroys data — and the confirmation says "trash" rather than
 *     "delete" for that reason.
 *   - **Download writes a real file and hands it to the share sheet**, rather
 *     than only reporting success. A "Downloaded" toast with nothing on disk is
 *     the kind of lie that is only discovered on a plane.
 *
 * UNVERIFIED: which directory `expo-file-system` writes into and whether the
 * share sheet can reach it, on either platform. Neither can be settled without
 * a device.
 */

import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { useCallback, useState } from 'react'

import type { Photo, PhotoId } from '../../core/types'
import { safeFilename } from '../../lib/photos'
import { blobToBytes } from '../../platform/blob'
import { useSession } from '../../state/session'

export interface PhotoActions {
  /** Non-null while something is in flight, so bars can disable themselves. */
  busy: boolean
  /** The most recent result, for the toast. Cleared by `dismiss`. */
  message: string | null
  dismiss: () => void
  favourite: (photo: Photo) => Promise<void>
  /** Favourites a whole selection. Every id gets the same target state. */
  favouriteMany: (ids: PhotoId[]) => Promise<void>
  remove: (ids: PhotoId[]) => Promise<void>
  share: (ids: PhotoId[]) => Promise<void>
  download: (photo: Photo) => Promise<void>
  addToAlbum: (albumId: string, ids: PhotoId[]) => Promise<void>
}

export function usePhotoActions(): PhotoActions {
  const { backends } = useSession()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const run = useCallback(async (work: () => Promise<string>) => {
    setBusy(true)
    try {
      setMessage(await work())
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }, [])

  const favourite = useCallback(
    (photo: Photo) =>
      run(async () => {
        await backends.photos.setFavourite(photo.id, !photo.isFavourite)
        return photo.isFavourite ? 'Removed from favourites' : 'Added to favourites'
      }),
    [backends, run],
  )

  const favouriteMany = useCallback(
    (ids: PhotoId[]) =>
      run(async () => {
        // Sequential rather than concurrent. A selection can be a hundred
        // photos, and firing a hundred requests at a phone-sized server to
        // save a few hundred milliseconds is how a bulk action becomes a
        // timeout — and a timeout here would leave some favourited and some
        // not, with no way to tell which.
        for (const id of ids) await backends.photos.setFavourite(id, true)
        return ids.length === 1 ? 'Added 1 photo to favourites' : `Added ${ids.length} photos to favourites`
      }),
    [backends, run],
  )

  const remove = useCallback(
    (ids: PhotoId[]) =>
      run(async () => {
        await backends.photos.remove(ids)
        return ids.length === 1
          ? 'Moved to trash — restore it in Immich'
          : `${ids.length} photos moved to trash — restore them in Immich`
      }),
    [backends, run],
  )

  const share = useCallback(
    (ids: PhotoId[]) =>
      run(async () => {
        const url = await backends.photos.share(ids)
        // The link is the result, so it is shown rather than copied — copying
        // silently would leave the reader unsure whether it worked.
        return `Share link: ${url}`
      }),
    [backends, run],
  )

  const download = useCallback(
    (photo: Photo) =>
      run(async () => {
        const blob = await backends.photos.original(photo.id)
        const filename = safeFilename(photo.name)

        // The bytes go to disk directly. `expo-file-system`'s current API takes
        // a `Uint8Array`; the older string-plus-encoding form is deprecated and
        // throws at runtime, and going through base64 would inflate the photo
        // by a third and hold a second copy of it in memory.
        const file = new File(Paths.cache, filename)
        file.create({ overwrite: true })
        file.write(await blobToBytes(blob))

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri)
          return `Saved ${filename}`
        }
        return `${filename} written to the app's cache`
      }),
    [backends, run],
  )

  const addToAlbum = useCallback(
    (albumId: string, ids: PhotoId[]) =>
      run(async () => {
        await backends.photos.addToAlbum(albumId, ids)
        return ids.length === 1 ? 'Added 1 photo' : `Added ${ids.length} photos`
      }),
    [backends, run],
  )

  return {
    busy,
    message,
    dismiss: () => setMessage(null),
    favourite,
    favouriteMany,
    remove,
    share,
    download,
    addToAlbum,
  }
}
