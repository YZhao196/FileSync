import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@primer/react'
import { ChoiceScreen } from '../../components/ChoiceScreen'
import { FolderPicker } from '../../components/FolderPicker'
import { carbonIcon, Icon, IconBadge } from '../../components/Icon'
import { NeedsServer } from '../../components/NeedsServer'
import { useToast } from '../../components/Toaster'
import type { Backends } from '../../core/backends'
import type { Photo, PhotoId } from '../../core/types'
import { FILE_MANAGER } from '../../lib/platform'
import { revealInSystem } from '../../native/bridge'
import { useApp } from '../../state/store'
import { PhotoCollection, type DecisionHooks } from './PhotoCollection'

/**
 * The photo timeline, and the two ways of handing the library to the OS.
 *
 * The grid itself lives in `PhotoCollection`, which Albums also uses — this
 * screen owns only the module's mode, the timeline's fetch, and the optional
 * decision pipeline, which the timeline is the only place to opt into.
 */
export function PhotosTimeline() {
  const { photoMode, setPhotoMode, photoFolder, setPhotoFolder, isHost, backends } = useApp()

  if (photoMode === 'choose') {
    return (
      <ChoiceScreen
        choices={[
          {
            icon: 'image',
            title: 'Browse photos in-app',
            body: 'View and manage your Immich library directly inside FileSynapse.',
            actionLabel: 'Open photo browser',
            primary: true,
            onAction: () => setPhotoMode('inapp'),
          },
          {
            icon: 'folder',
            title: 'Open local storage folder',
            body: `Browse the photos directory in ${FILE_MANAGER}.`,
            actionLabel: (
              <>
                {`Open in ${FILE_MANAGER}`}
                <Icon name="external" size={12} />
              </>
            ),
            onAction: () => setPhotoMode(isHost ? 'native-pick' : 'native'),
          },
        ]}
      />
    )
  }

  if (photoMode === 'native-pick') {
    return (
      <FolderPicker
        title="Where are your photos?"
        body="Select the local folder FileSynapse should watch. This folder will open in your system viewer when you browse photos."
        initial={photoFolder}
        placeholder="~/Pictures"
        onConfirm={(p) => {
          setPhotoFolder(p)
          setPhotoMode('native')
        }}
        onBack={() => setPhotoMode('choose')}
      />
    )
  }

  if (photoMode === 'native') {
    return (
      <NativeFolder
        path={photoFolder}
        onChange={() => setPhotoMode('native-pick')}
        onReset={() => setPhotoMode('choose')}
      />
    )
  }

  // The sidebar lists Timeline from the module mode, not from the connection,
  // so this is reachable before an address exists.
  if (!backends) return <NeedsServer />

  return <Timeline onReset={() => setPhotoMode('choose')} backends={backends} />
}

function NativeFolder({
  path,
  onChange,
  onReset,
}: {
  path: string
  onChange: () => void
  onReset: () => void
}) {
  const { show } = useToast()
  const { isHost } = useApp()

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--background)' }}>
      <div
        style={{
          width: 380,
          background: 'var(--layer-01)',
          border: '1px solid var(--border-subtle-01)',
          borderRadius: 'var(--border-radius-large)',
          padding: 'var(--spacing-06)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--spacing-04)',
        }}
      >
        <IconBadge name="folder" size={26} />
        <div className="heading-compact-02" style={{ color: 'var(--text-primary)' }}>
          Photos open in your system viewer
        </div>
        <div className="body-01" style={{ color: 'var(--text-secondary)' }}>
          {`Nothing is browsed in-app. The folder below is handed to ${FILE_MANAGER}.`}
        </div>
        <code
          className="code-01"
          style={{
            color: 'var(--text-secondary)',
            background: 'var(--layer-02)',
            padding: 'var(--spacing-02) var(--spacing-03)',
            borderRadius: 'var(--border-radius-medium)',
          }}
        >
          {path}
        </code>
        <div style={{ display: 'flex', gap: 'var(--spacing-03)', flexWrap: 'wrap' }}>
          <Button
            variant="primary"
            trailingVisual={carbonIcon('external')}
            onClick={async () => {
              const ok = await revealInSystem(path)
              if (!ok) show('Opening a folder needs the desktop shell — see filesynapsetodo.md')
            }}
          >
            {`Open in ${FILE_MANAGER}`}
          </Button>
          {isHost && (
            <Button variant="default" onClick={onChange}>
              Change location
            </Button>
          )}
          <Button variant="default" onClick={onReset}>
            Use in-app viewer
          </Button>
        </div>
      </div>
    </div>
  )
}

function Timeline({ onReset, backends }: { onReset: () => void; backends: Backends }) {
  const { decisionPipeline } = useApp()
  const { show } = useToast()

  const [photos, setPhotos] = useState<Photo[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  /**
   * Guards against a second page being asked for while the first is still in
   * flight. State alone is not enough: a scroll fires many events in one tick,
   * and `loadingMore` would still read false for all of them.
   */
  const inFlight = useRef(false)

  /** Pages 1..n, in order and de-duplicated. */
  const fetchPages = useCallback(
    async (n: number) => {
      const results = await Promise.all(
        Array.from({ length: n }, (_, i) => backends.photos.list({ page: i + 1 })),
      )
      const merged: Photo[] = []
      const seen = new Set<PhotoId>()
      for (const result of results) {
        for (const photo of result.photos) {
          if (seen.has(photo.id)) continue
          seen.add(photo.id)
          merged.push(photo)
        }
      }
      return { photos: merged, hasMore: results[results.length - 1]?.hasMore ?? false }
    },
    [backends],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchPages(1)
      .then((first) => {
        if (cancelled) return
        setPhotos(first.photos)
        setPage(1)
        setHasMore(first.hasMore)
      })
      .catch(() => {
        if (cancelled) return
        setPhotos([])
        setHasMore(false)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchPages])

  /**
   * Reloads everything currently loaded, not just the first page: after
   * favouriting a photo the user may be several hundred items down, and being
   * bounced back to the top is worse than a handful of extra requests.
   */
  const reload = useCallback(async () => {
    try {
      const refreshed = await fetchPages(page)
      setPhotos(refreshed.photos)
      setHasMore(refreshed.hasMore)
    } catch {
      // A failed refresh leaves what is on screen alone — emptying a library
      // because one request failed would read as data loss.
    }
  }, [fetchPages, page])

  const loadMore = useCallback(() => {
    if (inFlight.current || !hasMore) return
    inFlight.current = true
    setLoadingMore(true)
    backends.photos
      .list({ page: page + 1 })
      .then((next) => {
        setPhotos((prev) => {
          // The server may re-send an item that landed between pages. A
          // duplicate id becomes a duplicate React key, which is a crash.
          const seen = new Set(prev.map((p) => p.id))
          return [...prev, ...next.photos.filter((p) => !seen.has(p.id))]
        })
        setPage((n) => n + 1)
        setHasMore(next.hasMore)
      })
      .catch(() => {
        // Stop asking rather than retrying on every scroll frame.
        setHasMore(false)
      })
      .finally(() => {
        inFlight.current = false
        setLoadingMore(false)
      })
  }, [backends, page, hasMore])

  const [scores, setScores] = useState<Map<PhotoId, number>>(new Map())
  const [scoring, setScoring] = useState(false)

  /**
   * Scores the photos it is handed, a batch at a time, until the queue drains.
   *
   * This loop *is* the work queue: there is no job object on the server and no
   * endpoint to poll, because a second source of truth for "what is left" is a
   * thing to get out of sync. Each call reports what it managed and what is
   * still pending, and the loop continues while that number falls.
   *
   * It runs sequentially on the server's side too — see decisions.mjs — so this
   * is minutes of work for a page, not seconds, and that is deliberate.
   */
  const score = useCallback(
    async (ids: PhotoId[]) => {
      if (ids.length === 0 || scoring) return
      setScoring(true)
      try {
        let queue = [...ids]
        while (queue.length > 0) {
          const result = await backends.server.scorePhotos(queue)
          if (!result.ok) {
            show(result.reason ?? 'The server could not score these right now')
            break
          }
          if (result.scores.length > 0) {
            setScores((prev) => {
              const next = new Map(prev)
              for (const s of result.scores) next.set(s.id, s.score)
              return next
            })
          }
          const handled = result.scores.length + result.failed.length
          // Nothing moved. Stopping beats re-asking the same ids for ever, which
          // is what a server that rejects everything would otherwise cause.
          if (handled === 0) break
          queue = queue.slice(handled)
        }
      } catch (e) {
        show(e instanceof Error ? `Scoring failed: ${e.message}` : 'Scoring failed')
      } finally {
        setScoring(false)
      }
    },
    [backends, scoring, show],
  )

  const suggestAlbum = useCallback(
    async (ids: PhotoId[], albums: string[]) => {
      try {
        const suggestions = await backends.server.suggestAlbums(ids, albums)
        return new Map(suggestions.map((s) => [s.id, s.album]))
      } catch {
        return new Map<PhotoId, string>()
      }
    },
    [backends],
  )

  // Absent when the pipeline is off, which is what makes the review chip and the
  // Score button disappear with it rather than sitting there inert.
  const decisions = useMemo<DecisionHooks | undefined>(
    () => (decisionPipeline ? { scores, scoring, onScore: score, suggestAlbum } : undefined),
    [decisionPipeline, scores, scoring, score, suggestAlbum],
  )

  return (
    <PhotoCollection
      photos={photos}
      loading={loading}
      backend={backends.photos}
      onChanged={reload}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={loadMore}
      empty="No photos yet. Uploads from your phone appear here."
      decisions={decisions}
      leading={
        <Button variant="invisible" size="small" onClick={onReset} leadingVisual={carbonIcon('back')}>
          Change source
        </Button>
      }
    />
  )
}
