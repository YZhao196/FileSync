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
        background: 'rgba(9,9,12,0.96)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        animation: 'fadeInFast 150ms ease',
      }}
    >
      <div style={{ height: 50, display: 'flex', alignItems: 'center', padding: '0 20px', flexShrink: 0, gap: 14 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }} className="mono">
          {photo.name}
        </span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
          {photo.takenAt ? new Date(photo.takenAt).toLocaleDateString() : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
            {index + 1} / {total}
          </span>
          <button
            onClick={onClose}
            aria-label="Close viewer"
            style={{
              background: 'rgba(255,255,255,0.1)',
              color: '#fff',
              fontSize: 15,
              padding: '5px 11px',
              borderRadius: 3,
            }}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
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
            borderRadius: 4,
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
          gap: 32,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            onClick={() => onAction(action.id, photo)}
            style={{
              color: 'rgba(255,255,255,0.65)',
              fontSize: 13,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {action.label}
          </button>
        ))}
        <button
          onClick={() => onAction('favourite', photo)}
          aria-pressed={photo.isFavourite}
          style={{
            color: photo.isFavourite ? '#ffc857' : 'rgba(255,255,255,0.65)',
            fontSize: 13,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Icon name="star" size={13} filled={photo.isFavourite} />
          {photo.isFavourite ? 'Favourited' : 'Favourite'}
        </button>
        <button onClick={() => onAction('delete', photo)} style={{ color: '#ff7168', fontSize: 13 }}>
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
      style={{
        background: 'rgba(255,255,255,0.08)',
        borderRadius: '50%',
        width: 44,
        height: 44,
        fontSize: 24,
        color: disabled ? 'rgba(255,255,255,0.2)' : '#fff',
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
