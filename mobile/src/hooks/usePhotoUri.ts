/**
 * A drawable URI for one photo — from the cache when it is there.
 *
 * The cache is the point of this hook rather than an optimisation bolted onto
 * it. The desktop caches thumbnails because PLAN.md §11 says the index lives on
 * the server and the thumbnails live on the device, so scrolling a timeline
 * does not query the server for images it has already seen. Without that, every
 * remount refetches, and a list that recycles its rows refetches constantly.
 *
 * A cached thumbnail is a file, so the URI handed back is `file://…` and
 * `expo-image` loads it with no decoding step in JavaScript. The `data:` URI
 * path is only the fallback for a cache that could not write.
 *
 * Returns null rather than throwing, and the caller draws the photo's gradient
 * in that case. That is not a fallback bolted on either: the gradient is what
 * the tile shows anyway, so a thumbnail that fails to load degrades into a
 * slower version of the same picture rather than a hole.
 */

import { useEffect, useState } from 'react'

import type { PhotoId } from '../core/types'
import { blobToBytes, blobToDataUri } from '../platform/blob'
import { cacheKey, readThumb, writeThumb } from '../platform/thumbStore'
import { useSession } from '../state/session'

export function usePhotoUri(id: PhotoId, size: 'small' | 'large' = 'large'): string | null {
  const { backends } = useSession()
  const [uri, setUri] = useState<string | null>(null)
  const scope = backends.photos.cacheScope

  useEffect(() => {
    let cancelled = false

    // Cleared on id change so a fast swipe shows the next photo's gradient
    // rather than briefly leaving the previous photo on screen, which reads as
    // the wrong image rather than as loading.
    const key = cacheKey(scope, size, id)
    const cached = readThumb(key)
    if (cached) {
      setUri(cached)
      return
    }
    setUri(null)

    backends.photos
      .thumb(id, size)
      .then(async (blob) => {
        if (!blob) return null
        const bytes = await blobToBytes(blob)
        // The file URI is preferred; a data URI is the fallback for a cache
        // that could not write, which costs memory but still shows the photo.
        return writeThumb(key, bytes) ?? blobToDataUri(blob)
      })
      .then((next) => {
        if (!cancelled) setUri(next)
      })
      .catch(() => {
        // A thumbnail that will not load is not worth surfacing — the gradient
        // already communicates "photo here".
        if (!cancelled) setUri(null)
      })

    return () => {
      cancelled = true
    }
  }, [backends, id, size, scope])

  return uri
}
