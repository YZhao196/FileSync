import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { AlbumPicker, ConfirmDialog, ShareDialog } from '../../components/Dialogs'
import { PhotoTile } from '../../components/PhotoTile'
import { useToast } from '../../components/Toaster'
import type { PhotoBackend } from '../../core/backends'
import type { Album, Photo, PhotoId } from '../../core/types'
import { safeFilename, applyFilter, groupAnchor, groupPhotos, shortLabel, FILTERS, type PhotoFilter } from '../../lib/photos'
import { saveFile } from '../../native/bridge'
import { PhotoViewer } from './PhotoViewer'

/**
 * A wall of photos with everything that can be done to them.
 *
 * Timeline, Albums, People and Places are the same screen with different
 * questions asked of the server — so they share this rather than four copies
 * of selection, the viewer and the action bar. Only the toolbar's left-hand
 * slot and the source of `photos` differ.
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
}: {
  photos: Photo[] | null
  loading: boolean
  backend: PhotoBackend
  onChanged: () => void
  empty: ReactNode
  leading?: ReactNode
  showFilters?: boolean
  defaultCols?: number
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
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)

  const visible = useMemo(() => {
    const base = (photos ?? []).filter((p) => !removed.has(p.id))
    const patchedList = base.map((p) => {
      const patch = patched.get(p.id)
      return patch ? { ...p, ...patch } : p
    })
    return applyFilter(patchedList, filter)
  }, [photos, filter, patched, removed])

  const groups = useMemo(() => groupPhotos(visible), [visible])
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

  async function openAlbumPicker(ids: PhotoId[]) {
    setAlbumTargets(ids)
    setDialog('album')
    if (albums) return
    setAlbumsLoading(true)
    try {
      setAlbums(await backend.albums())
    } catch {
      setAlbums([])
    } finally {
      setAlbumsLoading(false)
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
          gap: 10,
          padding: '8px 20px',
          borderBottom: '1px solid var(--bd)',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        {selecting ? (
          <>
            <button className="btn--link" onClick={reset} style={{ fontSize: 12 }}>
              Cancel
            </button>
            <button className="btn--link" onClick={() => setSelected(new Set(allIds))} style={{ fontSize: 12 }}>
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{selected.size} selected</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['share', 'album', 'favourite', 'download'] as const).map((a) => (
                <button
                  key={a}
                  className="btn btn--sm"
                  disabled={selected.size === 0}
                  onClick={() => act(undefined, a)}
                >
                  {a === 'album' ? '+ Album' : a[0].toUpperCase() + a.slice(1)}
                </button>
              ))}
              <button
                className="btn btn--sm btn--danger"
                disabled={selected.size === 0}
                onClick={() => act(undefined, 'delete')}
              >
                Delete
              </button>
            </div>
          </>
        ) : (
          <>
            {leading}

            {showFilters && (
              <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
                {FILTERS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setFilter(c.id)}
                    aria-pressed={filter === c.id}
                    style={{
                      padding: '4px 12px',
                      borderRadius: 20,
                      fontSize: 12,
                      border: `1px solid ${filter === c.id ? 'var(--acc)' : 'var(--bd)'}`,
                      background: filter === c.id ? 'var(--acc)' : 'var(--surf2)',
                      color: filter === c.id ? '#fff' : 'var(--tx)',
                      fontWeight: filter === c.id ? 600 : 400,
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
              {visible.length > 0 && (
                <button
                  className="btn--link"
                  onClick={() => setSelecting(true)}
                  style={{ fontSize: 12, color: 'var(--txm)' }}
                >
                  Select
                </button>
              )}
              <div style={{ display: 'flex', border: '1px solid var(--bd)', borderRadius: 8, overflow: 'hidden' }}>
                {[4, 6, 8].map((n) => (
                  <button
                    key={n}
                    onClick={() => setGridCols(n)}
                    aria-pressed={gridCols === n}
                    aria-label={`${n} columns`}
                    style={{
                      padding: '3px 8px',
                      fontSize: 11,
                      background: gridCols === n ? 'var(--acc)' : 'var(--surf)',
                      color: gridCols === n ? '#fff' : 'var(--tx)',
                      borderRight: '1px solid var(--bd)',
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
          ) : groups.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--txm)', fontSize: 13 }}>{empty}</div>
          ) : (
            groups.map((g) => (
              <section key={g.date} id={groupAnchor(g.date)}>
                <h2
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--tx)',
                    padding: '16px 0 8px',
                    position: 'sticky',
                    top: 0,
                    background: 'var(--surf)',
                    zIndex: 1,
                  }}
                >
                  {g.date}
                </h2>
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

        {groups.length > 1 && !loading && (
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
            {groups.map((g) => (
              <button
                key={g.date}
                onClick={() => document.getElementById(groupAnchor(g.date))?.scrollIntoView({ behavior: 'smooth' })}
                style={{ fontSize: 9, color: 'var(--txd)', padding: '2px 4px', textAlign: 'center' }}
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

function SkeletonGrid({ cols }: { cols: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 2 }}>
      {Array.from({ length: cols * 3 }, (_, i) => (
        <div key={i} style={{ aspectRatio: '1', background: 'var(--skeleton)', borderRadius: 2 }} />
      ))}
    </div>
  )
}
