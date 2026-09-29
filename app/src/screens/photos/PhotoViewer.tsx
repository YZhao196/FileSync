import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import type { PhotoBackend } from '../../core/backends'
import type { Photo } from '../../core/types'
import { useThumb } from '../../hooks/useThumb'
import type { PhotoAction } from '../../lib/photos'

/**
 * Full-window viewer. The chrome is always visible here rather than auto-hidden
 * on click — keyboard navigation is the desktop affordance (← → navigate,
 * Esc close), and hiding controls on click fights with click-to-zoom.
 *
 * The bar offers what the collection can actually do. Favourite reads its state
 * from the photo, so a toggle here and a toggle in the grid stay in step.
 */
export function PhotoViewer({
  photos,
  index,
  backend,
  onIndex,
  onClose,
  onAction,
  readOnly = false,
}: {
  photos: Photo[]
  index: number
  backend: PhotoBackend
  onIndex: (i: number) => void
  onClose: () => void
  onAction: (action: PhotoAction, photo: Photo) => void
  /** Hides the action bar. Used by search, which has no selection to act on. */
  readOnly?: boolean
}) {
  const photo = photos[index]
  // Guard before the body, so the body can call hooks unconditionally.
  if (!photo) return null

  return (
    <ViewerBody
      photo={photo}
      index={index}
      total={photos.length}
      backend={backend}
      onIndex={onIndex}
      onClose={onClose}
      onAction={onAction}
      readOnly={readOnly}
    />
  )
}

const ACTIONS: ReadonlyArray<{ id: PhotoAction; label: string }> = [
  { id: 'share', label: 'Share' },
  { id: 'download', label: 'Download' },
  { id: 'album', label: 'Add to album' },
]

function ViewerBody({
  photo,
  index,
  total,
  backend,
  onIndex,
  onClose,
  onAction,
  readOnly,
}: {
  photo: Photo
  index: number
  total: number
  backend: PhotoBackend
  onIndex: (i: number) => void
  onClose: () => void
  onAction: (action: PhotoAction, photo: Photo) => void
  readOnly: boolean
}) {
  const src = useThumb(backend, photo.id, 'large')
  const [zoomed, setZoomed] = useState(false)

  // Reset the zoom when the photo changes, or the next one opens zoomed.
  useEffect(() => setZoomed(false), [photo.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onIndex(Math.max(0, index - 1))
      if (e.key === 'ArrowRight') onIndex(Math.min(total - 1, index + 1))
      if (e.key === ' ') {
        e.preventDefault()
        setZoomed((z) => !z)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, total, onClose, onIndex])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${photo.name}`}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--background-inverse)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        animation: 'fadeInFast 150ms ease',
      }}
    >
      <div
        style={{
          height: 50,
          display: 'flex',
          alignItems: 'center',
          padding: '0 var(--spacing-05)',
          flexShrink: 0,
          gap: 'var(--spacing-05)',
        }}
      >
        <span className="code-01" style={{ color: 'var(--text-inverse)' }}>
          {photo.name}
        </span>
        <span className="label-01" style={{ color: 'var(--text-inverse)', opacity: 0.7 }}>
          {photo.takenAt ? new Date(photo.takenAt).toLocaleDateString() : ''}
        </span>
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: 'var(--spacing-03)',
            alignItems: 'center',
          }}
        >
          <span className="label-01" style={{ color: 'var(--text-inverse)', opacity: 0.7 }}>
            {index + 1} / {total}
          </span>
          <button
            onClick={onClose}
            aria-label="Close viewer"
            style={{
              background: 'var(--background-inverse-hover)',
              color: 'var(--icon-inverse)',
              padding: 'var(--spacing-02) var(--spacing-03)',
              borderRadius: 'var(--border-radius-small)',
            }}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--spacing-05)' }}>
        <NavButton label="‹" disabled={index === 0} onClick={() => onIndex(index - 1)} />
        <div
          onClick={() => setZoomed((z) => !z)}
          title={zoomed ? 'Click to fit' : 'Click to zoom'}
          style={{
            position: 'relative',
            width: zoomed ? '86vw' : 580,
            height: zoomed ? '76vh' : 420,
            maxWidth: '86vw',
            maxHeight: '76vh',
            borderRadius: 'var(--border-radius-small)',
            overflow: 'hidden',
            cursor: 'zoom-in',
            transition: 'width 140ms ease, height 140ms ease',
            background: `linear-gradient(145deg, ${photo.gradient[0]}, ${photo.gradient[1]})`,
          }}
        >
          {src && (
            <img
              src={src}
              alt=""
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
              }}
            />
          )}
        </div>
        <NavButton label="›" disabled={index === total - 1} onClick={() => onIndex(index + 1)} />
      </div>

      <div
        style={{
          height: 56,
          display: readOnly ? 'none' : 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--spacing-07)',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            onClick={() => onAction(action.id, photo)}
            className="body-compact-01"
            style={{
              color: 'var(--text-inverse)',
              opacity: 0.75,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--spacing-02)',
            }}
          >
            {action.label}
          </button>
        ))}
        <button
          onClick={() => onAction('favourite', photo)}
          aria-pressed={photo.isFavourite}
          className="body-compact-01"
          style={{
            color: photo.isFavourite ? 'var(--support-warning)' : 'var(--text-inverse)',
            opacity: photo.isFavourite ? 1 : 0.75,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--spacing-02)',
          }}
        >
          <Icon name="star" size={13} filled={photo.isFavourite} />
          {photo.isFavourite ? 'Favourited' : 'Favourite'}
        </button>
        <button
          onClick={() => onAction('delete', photo)}
          className="body-compact-01"
          style={{ color: 'var(--support-error-inverse)' }}
        >
          Delete
        </button>
      </div>
    </div>
  )
}

function NavButton({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label === '‹' ? 'Previous photo' : 'Next photo'}
      className="heading-03"
      style={{
        background: 'var(--background-inverse-hover)',
        borderRadius: 'var(--border-radius-full)',
        width: 44,
        height: 44,
        color: 'var(--text-inverse)',
        opacity: disabled ? 0.3 : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  )
}
