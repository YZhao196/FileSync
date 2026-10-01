import { useEffect, useMemo, useRef, useState } from 'react'
import { TextInput } from '@primer/react'
import type { Photo, TreeNode } from '../core/types'
import { useThumb } from '../hooks/useThumb'
import { parentOf } from '../lib/paths'
import { modShortcut } from '../lib/platform'
import { useApp } from '../state/store'
import { Icon } from './Icon'
import { PhotoViewer } from '../screens/photos/PhotoViewer'

/**
 * Search over photos and files, opened with ⌘K / Ctrl+K.
 *
 * Photos go to the server: Immich's smart search understands "beach" and "dog",
 * and nothing here tries to reimplement that (PLAN.md §11). Files are filtered
 * client-side from the tree the browser has already loaded, because WebDAV has
 * no portable search primitive and inventing one client-side would be a lie
 * about what was searched — the palette says so in the footer when it applies.
 *
 * Debounced, so typing does not put a request on the wire per keystroke.
 *
 * The results list stays hand-rolled rather than an `ActionList`. The palette's
 * keyboard model is input-first: focus never leaves the field, Enter opens the
 * first file match, and Escape closes. `ActionList` brings its own focus zone
 * and roving tab order, and its leading/trailing visual slots size their own
 * contents, which would fight both that model and the 30px thumbnails here. The
 * field itself is Primer `TextInput`; everything else is on the tokens.
 */
export function SearchPalette() {
  const { searchOpen, setSearchOpen, backends, go } = useApp()

  const [query, setQuery] = useState('')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [tree, setTree] = useState<TreeNode[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // The shortcut is global: a palette you can only open from one screen is not
  // a palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(!searchOpen)
      }
      if (e.key === 'Escape' && searchOpen) setSearchOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchOpen, setSearchOpen])

  useEffect(() => {
    if (!searchOpen) return
    inputRef.current?.focus()
  }, [searchOpen])

  // Reset between openings, so the last query does not reappear.
  useEffect(() => {
    if (!searchOpen) {
      setQuery('')
      setPhotos([])
      setError(null)
      // `searching` goes with them. Closing the palette mid-search cancels the
      // request, and the cancellation is exactly what stops `.finally` from
      // clearing this — so without it the next opening shows a spinner before
      // a single character has been typed, and nothing short of a completed
      // search clears it again.
      setSearching(false)
    }
  }, [searchOpen])

  useEffect(() => {
    if (!searchOpen) return
    const q = query.trim()
    if (!q) {
      setPhotos([])
      setError(null)
      // Also here, and for the same reason: emptying the box cancels whatever
      // was in flight, so the `.finally` that would have cleared this never
      // runs and the spinner outlives the search that started it.
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      backends.photos
        .search(q)
        .then((r) => {
          if (!cancelled) setPhotos(r)
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e))
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 280)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, searchOpen, backends])

  // Re-read the file tree each time the palette opens — once per opening, not
  // per keystroke. Caching it for the session meant a file renamed in the
  // browser still turned up under its old name here, which is worse than a
  // small delay.
  useEffect(() => {
    if (!searchOpen) return
    let cancelled = false
    backends.files
      .tree()
      .then((t) => {
        if (!cancelled) setTree(t)
      })
      .catch(() => {
        if (!cancelled) setTree([])
      })
    return () => {
      cancelled = true
    }
  }, [searchOpen, backends])

  const fileMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !tree) return []
    const out: TreeNode[] = []
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.name.toLowerCase().includes(q)) out.push(n)
        if (n.children?.length) walk(n.children)
        if (out.length >= 12) return
      }
    }
    walk(tree)
    return out.slice(0, 12)
  }, [query, tree])

  if (!searchOpen) return null

  // The viewer takes over the screen while a result is open. Two overlays at
  // once would put the palette's dim layer over the photo, so the palette
  // steps aside and Esc brings it back.
  if (openIndex !== null && photos[openIndex]) {
    return (
      <PhotoViewer
        photos={photos}
        index={openIndex}
        backend={backends.photos}
        onIndex={setOpenIndex}
        onClose={() => setOpenIndex(null)}
        onAction={() => {}}
        readOnly
      />
    )
  }

  const hasQuery = Boolean(query.trim())
  const resultCount = photos.length + fileMatches.length

  return (
    <>
      <div
        onClick={() => setSearchOpen(false)}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--overlay)',
          zIndex: 130,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: '12vh',
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 560,
            maxWidth: '92vw',
            maxHeight: '66vh',
            background: 'var(--layer-01)',
            border: '1px solid var(--border-subtle-01)',
            borderRadius: 'var(--border-radius-large)',
            boxShadow: 'var(--shadow-overlay)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            animation: 'fadeInFast 120ms ease',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-03)',
              padding: 'var(--spacing-04) var(--spacing-05)',
              borderBottom: '1px solid var(--border-subtle-01)',
            }}
          >
            <TextInput
              ref={inputRef}
              block
              leadingVisual={<Icon name="search" size={16} />}
              placeholder="Search photos and files…"
              value={query}
              aria-label="Search photos and files"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && fileMatches[0]) {
                  go('files', { filePath: parentOf(fileMatches[0].path) })
                }
              }}
            />
            {searching && (
              <span
                className="helper-text-01"
                style={{ color: 'var(--text-helper)', whiteSpace: 'nowrap' }}
              >
                Searching…
              </span>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {!hasQuery ? (
              <Hint text="Type to search. Photos are matched by the server; files by name." />
            ) : error ? (
              <Hint text={error} danger />
            ) : resultCount === 0 && !searching ? (
              <Hint text={`Nothing matched “${query.trim()}”.`} />
            ) : (
              <>
                {photos.length > 0 && <Section label={`Photos · ${photos.length}`} />}
                {photos.map((p, i) => (
                  <PhotoRow
                    key={p.id}
                    photo={p}
                    backend={backends.photos}
                    onOpen={() => setOpenIndex(i)}
                  />
                ))}

                {fileMatches.length > 0 && <Section label={`Files · ${fileMatches.length}`} />}
                {fileMatches.map((f) => (
                  <button
                    key={f.path}
                    className="hoverable"
                    onClick={() => go('files', { filePath: parentOf(f.path) })}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--spacing-04)',
                      width: '100%',
                      padding: 'var(--spacing-03) var(--spacing-05)',
                      textAlign: 'left',
                    }}
                  >
                    <Icon
                      name={f.isFolder ? 'folder' : 'file'}
                      size={16}
                      style={{ color: 'var(--icon-secondary)' }}
                    />
                    <span
                      className="body-compact-01"
                      style={{ flex: 1, color: 'var(--text-primary)' }}
                    >
                      {f.name}
                    </span>
                    <span className="code-01" style={{ color: 'var(--text-helper)' }}>
                      {parentOf(f.path) || '/'}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>

          <div
            className="helper-text-01"
            style={{
              padding: 'var(--spacing-02) var(--spacing-05)',
              borderTop: '1px solid var(--border-subtle-01)',
              color: 'var(--text-helper)',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 'var(--spacing-04)',
            }}
          >
            <span>Files are matched by name from the loaded folder list</span>
            <span>{modShortcut('K')} to toggle · Esc to close</span>
          </div>
        </div>
      </div>
    </>
  )
}

function Section({ label }: { label: string }) {
  return (
    <div
      className="label-01"
      style={{
        padding: 'var(--spacing-03) var(--spacing-05) var(--spacing-02)',
        color: 'var(--text-secondary)',
      }}
    >
      {label}
    </div>
  )
}

function Hint({ text, danger }: { text: string; danger?: boolean }) {
  return (
    <div
      className="body-01"
      style={{
        padding: 'var(--spacing-06)',
        color: danger ? 'var(--text-error)' : 'var(--text-helper)',
        textAlign: 'center',
      }}
    >
      {text}
    </div>
  )
}

function PhotoRow({
  photo,
  backend,
  onOpen,
}: {
  photo: Photo
  backend: ReturnType<typeof useApp>['backends']['photos']
  onOpen: () => void
}) {
  const src = useThumb(backend, photo.id, 'small')

  return (
    <button
      className="hoverable"
      onClick={onOpen}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-04)',
        width: '100%',
        padding: 'var(--spacing-03) var(--spacing-05)',
        textAlign: 'left',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 30,
          height: 30,
          borderRadius: 'var(--border-radius-small)',
          flexShrink: 0,
          background: `linear-gradient(145deg, ${photo.gradient[0]}, ${photo.gradient[1]})`,
          overflow: 'hidden',
        }}
      >
        {src && <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </span>
      <span
        className="body-compact-01"
        style={{
          flex: 1,
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {photo.name}
      </span>
      <span className="helper-text-01" style={{ color: 'var(--text-helper)' }}>
        {photo.dateGroup}
      </span>
      {photo.isFavourite && (
        <Icon name="star" size={16} filled style={{ color: 'var(--support-warning)' }} />
      )}
    </button>
  )
}
