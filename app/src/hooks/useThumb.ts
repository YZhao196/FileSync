import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PhotoBackend } from '../core/backends'
import type { PhotoId } from '../core/types'
import { cacheGeneration, noteThumb, releaseUrl, subscribeCache, trackUrl } from '../lib/thumbCache'

/**
 * Loads a photo thumbnail and hands back an object URL.
 *
 * The indirection exists because Immich's thumbnails need an `x-api-key`
 * header, which an `<img src>` cannot send. Fetched bytes are turned into an
 * object URL and revoked on unmount, so a long scroll does not leak.
 *
 * Returns `undefined` while loading and when no thumbnail exists — the caller
 * shows its placeholder in both cases. Bytes fetched are reported to the
 * session cache so Settings can show a real figure.
 */
export function useThumb(
  backend: PhotoBackend,
  id: PhotoId,
  size: 'small' | 'large',
): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  const generation = useSyncExternalStore(subscribeCache, cacheGeneration)

  useEffect(() => {
    let cancelled = false
    let created: string | undefined

    backend
      .thumb(id, size)
      .then((blob) => {
        if (!blob || cancelled) return
        noteThumb(blob.size)
        created = URL.createObjectURL(blob)
        trackUrl(created)
        setUrl(created)
      })
      .catch(() => {
        /* fall back to the gradient */
      })

    return () => {
      cancelled = true
      if (created) {
        releaseUrl(created)
        URL.revokeObjectURL(created)
      }
    }
    // `generation` is a dependency so a cache clear re-fetches this tile rather
    // than leaving a revoked URL on screen.
  }, [backend, id, size, generation])

  return url
}
