/**
 * A drawable URI for one photo, or null while it is in flight.
 *
 * Returns null rather than throwing on failure, and the caller is expected to
 * draw the photo's gradient in that case. That is not a fallback bolted on: the
 * gradient is what the tile shows anyway, so a thumbnail that fails to load
 * degrades into a slower version of the same picture rather than a hole.
 *
 * There is no cache here yet. Every mount refetches, and the same photo shown
 * twice is downloaded twice — which is exactly what UI-MOBILE.md §4's
 * "Storage & cache" section is about, and it is the next thing this needs.
 * Until then the honest description is that this makes the viewer work and
 * makes the timeline slow, and the mock backend hides the cost because it
 * returns bytes from memory.
 */

import { useEffect, useState } from 'react'

import type { PhotoId } from '../core/types'
import { blobToDataUri } from '../platform/blob'
import { useSession } from '../state/session'

export function usePhotoUri(id: PhotoId, size: 'small' | 'large' = 'large'): string | null {
  const { backends } = useSession()
  const [uri, setUri] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Cleared on id change so a fast swipe shows the next photo's gradient
    // rather than briefly leaving the previous photo on screen, which reads as
    // the wrong image rather than as loading.
    setUri(null)

    backends.photos
      .thumb(id, size)
      .then(blobToDataUri)
      .then((next) => {
        if (!cancelled) setUri(next)
      })
      .catch(() => {
        // A thumbnail that will not load is not an error worth surfacing — the
        // gradient already communicates "photo here".
        if (!cancelled) setUri(null)
      })

    return () => {
      cancelled = true
    }
  }, [backends, id, size])

  return uri
}
