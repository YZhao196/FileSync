import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { AlbumPicker, ConfirmDialog, ShareDialog } from '../../components/Dialogs'
import { Icon } from '../../components/Icon'
import { PhotoTile } from '../../components/PhotoTile'
import { useToast } from '../../components/Toaster'
import type { PhotoBackend } from '../../core/backends'
import type { Album, Photo, PhotoId } from '../../core/types'
import { safeFilename, applyFilter, groupAnchor, groupPhotos, shortLabel, FILTERS, REVIEW_FILTER, type PhotoFilter } from '../../lib/photos'
import { saveFile } from '../../native/bridge'
import { PhotoViewer } from './PhotoViewer'

/**
 * What the optional decision pipeline contributes to this screen, if anything.
 *
 * Passed by the timeline and by nothing else. Absent means the pipeline is off,
 * and every surface that depends on it is absent with it — rather than present,
 * permanently empty, and reading as broken.
 */
export interface DecisionHooks {
  /** Scores by photo id. Empty until the user has asked for a scoring pass. */
  scores: ReadonlyMap<PhotoId, number>
  scoring: boolean
  /** Ask for scores. The caller drives the backlog; see PhotosTimeline. */
  onScore: (ids: PhotoId[]) => void
  /** Album name per photo, or empty when the decision model is unavailable. */
  suggestAlbum: (ids: PhotoId[], albums: string[]) => Promise<Map<PhotoId, string>>
}

/**
 * A wall of photos with everything that can be done to them.
 *
 * Timeline and Albums are the same screen with different questions asked of the
 * server — so they share this rather than two copies of selection, the viewer
 * and the action bar. Only the toolbar's left-hand slot, the source of `photos`,
 * and whether the decision pipeline is wired in differ.
 *
 * Mutations are optimistic: a favourite flips and a deletion disappears before
 * the server confirms, then `onChanged` re-reads. Without that, every like
 * would wait on a round trip and the grid would jump underneath the click.
 */
export function PhotoCollection({
  photos,
  loading,
  backend,
  onChanged,
  empty,
  leading,
  showFilters = true,
  defaultCols = 6,
  decisions,
}: {
  photos: Photo[] | null
  loading: boolean
  backend: PhotoBackend
  onChanged: () => void
  empty: ReactNode
  leading?: ReactNode
  showFilters?: boolean
  defaultCols?: number
  decisions?: DecisionHooks
}) {
  const { show } = useToast()

  const [filter, setFilter] = useState<PhotoFilter>('all')
  const [gridCols, setGridCols] = useState(defaultCols)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<PhotoId>>(new Set())
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)

  /** Applied on top of `photos` so a mutation shows before the refetch lands. */
  const [patched, setPatched] = useState<Map<PhotoId, Partial<Photo>>>(new Map())
  const [removed, setRemoved] = useState<Set<PhotoId>>(new Set())

  const [dialog, setDialog] = useState<'delete' | 'album' | 'share' | null>(null)
  /**
   * Set when a dialog opens, so the viewer's controls act on the photo on
   * screen rather than on the selection — which is empty when the viewer was
   * opened without going through Select. Without this, Delete and Add to album
   * from the viewer operate on nothing and look broken.
   */
  const [deleteTargets, setDeleteTargets] = useState<PhotoId[]>([])
  const [albumTargets, setAlbumTargets] = useState<PhotoId[]>([])
  const [albums, setAlbums] = useState<Album[] | null>(null)
  const [albumsLoading, setAlbumsLoading] = useState(false)
  const [albumSuggestion, setAlbumSuggestion] = useState<string | null>(null)
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)

  /** Kept separate from `visible`: scoring is asked of the whole loaded page,
   *  not of whatever the current filter happens to be showing. */
  const sourceIds = useMemo(
    () => (photos ?? []).filter((p) => !removed.has(p.id)).map((p) => p.id),
    [photos, removed],
  )

  const visible = useMemo(() => {
    const base = (photos ?? []).filter((p) => !removed.has(p.id))
    const patchedList = base.map((p) => {
      const patch = patched.get(p.id)
      return patch ? { ...p, ...patch } : p
    })
    return applyFilter(patchedList, filter, decisions?.scores)
  }, [photos, filter, patched, removed, decisions?.scores])

  const dateGroups = useMemo(() => groupPhotos(visible), [visible])

  /**
   * Under the review filter the order is the score, not the date, so grouping by
   * date is not just useless but actively wrong: it shatters the queue into one
   * section per photo. A single unnamed group renders it as the flat grid it is.
   * `dateGroups` is kept separately because the date rail is date navigation,
   * and belongs to the date ordering rather than to whatever is on screen.
   */
  const groups = useMemo<Array<{ date: string | null; photos: Photo[] }>>(
    () => (filter === 'review' ? [{ date: null, photos: visible }] : dateGroups),
    [visible, filter, dateGroups],
  )
  const allIds = useMemo(() => visible.map((p) => p.id), [visible])

  const reset = useCallback(() => {
    setSelecting(false)
    setSelected(new Set())
    setRemoved(new Set())
    setPatched(new Map())
  }, [])

  const refetch = useCallback(() => {
    onChanged()
    // The refetch replaces `photos`, so the optimistic layers must go or they
    // would keep filtering against a list that no longer exists.
    setRemoved(new Set())
    setPatched(new Map())
  }, [onChanged])

  const toggle = (id: PhotoId) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Every action runs on an explicit id list, so selection and the viewer use
   *  the same code path. */
  const targetIds = (single?: Photo): PhotoId[] =>
    single ? [single.id] : [...selected]

  const act = (single: Photo | undefined, label: string) => {
    switch (label) {
      case 'favourite':
        void toggleFavourite(targetIds(single))
        break
      case 'download':
        void download(targetIds(single), single)
        break
      case 'share':
        void openShare(targetIds(single))
        break
      case 'album':
        void openAlbumPicker(targetIds(single))
        break
      case 'delete':
        setDeleteTargets(targetIds(single))
        setDialog('delete')
        break
    }
  }

  async function toggleFavourite(ids: PhotoId[]) {
    const current = (photos ?? []).filter((p) => ids.includes(p.id))
    const turningOn = !current.every((p) => p.isFavourite)
    setPatched((prev) => {
      const next = new Map(prev)
      for (const id of ids) next.set(id, { ...next.get(id), isFavourite: turningOn })
      return next
    })
    try {
      await Promise.all(ids.map((id) => backend.setFavourite(id, turningOn)))
      show(turningOn ? `Favourited ${ids.length} item${ids.length === 1 ? '' : 's'}` : 'Removed from favourites')
      refetch()
    } catch (e) {
      setPatched(new Map())
      show(e instanceof Error ? `Could not update: ${e.message}` : 'Could not update')
    }
  }

  async function download(ids: PhotoId[], single?: Photo) {
    try {
      // Several at once would mean several save dialogs, which is worse than
      // saying no. The viewer and single-select paths always pass one.
      if (ids.length > 1) {
        show('Select one item to download')
        return
      }
      const id = ids[0]
      const photo = single ?? (photos ?? []).find((p) => p.id === id)
      if (!id || !photo) return
      const blob = await backend.original(id)
      const ok = await saveFile(safeFilename(photo.name), blob)
      show(ok ? `Saved ${photo.name}` : 'Download cancelled')
    } catch (e) {
      show(e instanceof Error ? `Download failed: ${e.message}` : 'Download failed')
    }
  }

  async function openShare(ids: PhotoId[]) {
    setDialog('share')
    setSharing(true)
    setShareLink(null)
    setShareError(null)
    try {
      const link = await backend.share(ids)
      setShareLink(link)
    } catch (e) {
      setShareError(
        e instanceof Error
          ? `The server refused to create a link: ${e.message}`
          : 'The server refused to create a link.',
      )
    } finally {
      setSharing(false)
    }
  }

  async function loadAlbums(): Promise<Album[]> {
    if (albums) return albums
    setAlbumsLoading(true)
    try {
      const list = await backend.albums()
      setAlbums(list)
      return list
    } catch {
      setAlbums([])
      return []
    } finally {
      setAlbumsLoading(false)
    }
  }

  async function openAlbumPicker(ids: PhotoId[]) {
    setAlbumTargets(ids)
    setDialog('album')
    setAlbumSuggestion(null)

    const known = await loadAlbums()
    if (!decisions || known.length === 0) return

    try {
      // The picker files everything selected into one album, so the per-photo
      // answers are reduced to the most common one. A suggestion is an offer:
      // nothing is filed until the tap below, which is the whole reason this
      // lives inside the dialog rather than in a background job.
      const perPhoto = await decisions.suggestAlbum(ids, known.map((a) => a.name))
      const tally = new Map<string, number>()
      for (const name of perPhoto.values()) tally.set(name, (tally.get(name) ?? 0) + 1)
      const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
      setAlbumSuggestion(best?.[0] ?? null)
    } catch {
      // A suggestion that cannot be produced is simply not shown.
      setAlbumSuggestion(null)
    }
  }

  async function confirmDelete() {
    const ids = deleteTargets
    setDialog(null)
    setRemoved((prev) => new Set([...prev, ...ids]))
    reset()
    try {
      await backend.remove(ids)
      show(`Moved ${ids.length} item${ids.length === 1 ? '' : 's'} to trash`)
      refetch()
    } catch (e) {
      setRemoved(new Set())
      show(e instanceof Error ? `Delete failed: ${e.message}` : 'Delete failed')
    }
  }

  async function pickAlbum(album: Album) {
    const ids = albumTargets
    setDialog(null)
    try {
      await backend.addToAlbum(album.id, ids)
      show(`Added ${ids.length} item${ids.length === 1 ? '' : 's'} to ${album.name}`)
      reset()
      refetch()
    } catch (e) {
      show(e instanceof Error ? `Could not add: ${e.message}` : 'Could not add to album')
    }
  }

  const allSelected = visible.length > 0 && selected.size === visible.length

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-03)',
          padding: 'var(--spacing-03) var(--spacing-05)',
          borderBottom: '1px solid var(--border-subtle-01)',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        {selecting ? (
          <>
            <Button variant="invisible" size="small" onClick={reset}>
              Cancel
            </Button>
            <Button variant="invisible" size="small" onClick={() => setSelected(new Set(allIds))}>
              {allSelected ? 'Deselect all' : 'Select all'}
            </Button>
            <span className="body-compact-01" style={{ color: 'var(--text-primary)' }}>
              {selected.size} selected
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--spacing-03)', flexWrap: 'wrap' }}>
              {(['share', 'album', 'favourite', 'download'] as const).map((a) => (
                <Button
                  key={a}
                  variant="invisible"
                  size="small"
                  disabled={selected.size === 0}
                  onClick={() => act(undefined, a)}
                >
                  {a === 'album' ? 'Add to album' : a[0].toUpperCase() + a.slice(1)}
                </Button>
              ))}
              <Button
                variant="danger"
                size="small"
                disabled={selected.size === 0}
                onClick={() => act(undefined, 'delete')}
              >
                Delete
              </Button>
            </div>
          </>
        ) : (
          <>
            {leading}

            {showFilters && (
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--spacing-02)',
                  marginLeft: 'var(--spacing-03)',
                }}
              >
                {FILTERS.map((c) => (
                  <FilterChip
                    key={c.id}
                    active={filter === c.id}
                    label={c.label}
                    onClick={() => setFilter(c.id)}
                  />
                ))}
                {decisions && decisions.scores.size > 0 && (
                  <FilterChip
                    active={filter === REVIEW_FILTER.id}
                    label={REVIEW_FILTER.label}
                    onClick={() =>
                      setFilter(filter === REVIEW_FILTER.id ? 'all' : REVIEW_FILTER.id)
                    }
                  />
                )}
              </div>
            )}

            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-03)',
              }}
            >
              {decisions && (
                <Button
                  variant="invisible"
                  size="small"
                  disabled={decisions.scoring}
                  onClick={() => decisions.onScore(sourceIds)}
                >
                  {decisions.scoring ? 'Scoring…' : 'Score'}
                </Button>
              )}
              {visible.length > 0 && (
                <Button variant="invisible" size="small" onClick={() => setSelecting(true)}>
                  Select
                </Button>
              )}
              <div
                style={{
                  display: 'flex',
                  border: '1px solid var(--border-subtle-01)',
                  borderRadius: 'var(--border-radius-medium)',
                  overflow: 'hidden',
                }}
              >
                {[4, 6, 8].map((n, i) => (
                  <button
                    key={n}
                    onClick={() => setGridCols(n)}
                    aria-pressed={gridCols === n}
                    aria-label={`${n} columns`}
                    className="label-01"
                    style={{
                      padding: 'var(--spacing-01) var(--spacing-03)',
                      background: gridCols === n ? 'var(--background-brand)' : 'var(--layer-01)',
                      color: gridCols === n ? 'var(--text-on-color)' : 'var(--text-primary)',
                      borderRight: i < 2 ? '1px solid var(--border-subtle-01)' : 'none',
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '12px 50px 12px 20px' }}>
          {loading ? (
            <SkeletonGrid cols={gridCols} />
          ) : visible.length === 0 ? (
            <Blankslate>
              <Blankslate.Visual>
                <Icon name="image" size={24} />
              </Blankslate.Visual>
              <Blankslate.Description>
                {filter === 'review'
                  ? 'Nothing scored yet. Press Score to build the review queue — weakest first, and it never deletes anything on its own.'
                  : empty}
              </Blankslate.Description>
            </Blankslate>
          ) : (
            groups.map((g) => (
              <section key={g.date ?? 'review'} id={g.date ? groupAnchor(g.date) : undefined}>
                {g.date && (
                  <h2
                    className="heading-compact-01"
                    style={{
                      color: 'var(--text-primary)',
                      padding: 'var(--spacing-05) 0 var(--spacing-03)',
                      position: 'sticky',
                      top: 0,
                      background: 'var(--background)',
                      zIndex: 1,
                    }}
                  >
                    {g.date}
                  </h2>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridCols}, 1fr)`, gap: 2 }}>
                  {g.photos.map((p) => (
                    <PhotoTile
                      key={p.id}
                      photo={p}
                      backend={backend}
                      selected={selected.has(p.id)}
                      onClick={() => {
                        if (selecting) toggle(p.id)
                        else setViewerIndex(visible.indexOf(p))
                      }}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        {filter !== 'review' && dateGroups.length > 1 && !loading && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: 48,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-evenly',
              padding: '12px 0',
              zIndex: 3,
            }}
          >
            {dateGroups.map((g) => (
              <button
                key={g.date}
                onClick={() => document.getElementById(groupAnchor(g.date))?.scrollIntoView({ behavior: 'smooth' })}
                className="label-01"
                style={{ color: 'var(--text-helper)', padding: 'var(--spacing-01)', textAlign: 'center' }}
              >
                {shortLabel(g.date)}
              </button>
            ))}
          </div>
        )}
      </div>

      {viewerIndex !== null && visible[viewerIndex] && (
        <PhotoViewer
          photos={visible}
          index={viewerIndex}
          backend={backend}
          onIndex={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          onAction={(label, photo) => act(photo, label)}
        />
      )}

      {dialog === 'delete' && (
        <ConfirmDialog
          title={`Delete ${deleteTargets.length} item${deleteTargets.length === 1 ? '' : 's'}?`}
          body="They go to the server's trash, not straight to gone — recoverable for the retention window. Restoring them is done in Immich, not here."
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog === 'album' && (
        <AlbumPicker
          albums={albums}
          loading={albumsLoading}
          count={albumTargets.length}
          suggested={albumSuggestion}
          onPick={pickAlbum}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog === 'share' && (
        <ShareDialog
          link={shareLink}
          loading={sharing}
          error={shareError}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="label-01"
      style={{
        padding: 'var(--spacing-01) var(--spacing-04)',
        borderRadius: 'var(--border-radius-full)',
        border: `1px solid ${active ? 'var(--background-brand)' : 'var(--border-subtle-01)'}`,
        background: active ? 'var(--background-brand)' : 'var(--layer-01)',
        color: active ? 'var(--text-on-color)' : 'var(--text-primary)',
      }}
    >
      {label}
    </button>
  )
}

function SkeletonGrid({ cols }: { cols: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 2 }}>
      {Array.from({ length: cols * 3 }, (_, i) => (
        <div
          key={i}
          style={{ aspectRatio: '1', background: 'var(--layer-01)', borderRadius: 'var(--border-radius-small)' }}
        />
      ))}
    </div>
  )
}
