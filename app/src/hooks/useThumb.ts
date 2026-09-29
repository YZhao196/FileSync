import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PhotoBackend } from '../core/backends'
import type { PhotoId } from '../core/types'
import { cacheGeneration, noteThumb, releaseUrl, subscribeCache, trackUrl } from '../lib/thumbCache'
import { cacheKey, getThumb, putThumb } from '../lib/thumbStore'

/**
 * Loads a photo thumbnail and hands back an object URL.
 *
 * Cache-first: a thumbnail already on disk is shown without touching the
 * network, which is the whole point of the store (PLAN.md §11 — a central index
 * on the server, a thumbnail cache on each device).
 *
 * The indirection through bytes exists because Immich's thumbnails need an
 * `x-api-key` header, which an `<img src>` cannot send.
 *
 * Returns `undefined` while loading and when no thumbnail exists — the caller
 * shows its placeholder in both cases.
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

    const key = cacheKey(backend.cacheScope, size, id)

    const show = (blob: Blob) => {
      if (cancelled) return
      created = URL.createObjectURL(blob)
      trackUrl(created)
      setUrl(created)
    }

    void (async () => {
      const cached = await getThumb(key)
      if (cached) {
        show(cached)
        return
      }

      const fetched = await backend.thumb(id, size).catch(() => null)
      if (!fetched || cancelled) return

      noteThumb(fetched.size)
      putThumb(key, fetched)
      show(fetched)
    })()

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
