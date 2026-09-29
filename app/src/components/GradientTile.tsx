import { useState, type CSSProperties } from 'react'
import type { Gradient } from '../core/types'
import { Icon } from './Icon'

/**
 * A photo tile.
 *
 * The gradient underneath is the loading state *and* the permanent fallback:
 * if there is no thumbnail URL, or the image fails, the tile still reads as a
 * photo. Nothing here ever resizes an image on request — the URL comes from the
 * backend already pointing at a server-rendered size.
 */
export function GradientTile({
  gradient,
  src,
  selected,
  isVideo,
  isFavourite,
  style,
  onClick,
  title,
}: {
  gradient: Gradient
  src?: string
  selected?: boolean
  isVideo?: boolean
  isFavourite?: boolean
  style?: CSSProperties
  onClick?: () => void
  title?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(src) && !failed

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={title}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      style={{
        aspectRatio: '1',
        position: 'relative',
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: 2,
        background: `linear-gradient(145deg, ${gradient[0]}, ${gradient[1]})`,
        ...style,
      }}
    >
      {showImage && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 180ms ease',
          }}
        />
      )}

      {isVideo && (
        <span
          style={{
            position: 'absolute',
            bottom: 4,
            left: 4,
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            borderRadius: '50%',
            width: 20,
            height: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 8,
          }}
          aria-label="Video"
        >
          <Icon name="play" size={16} filled />
        </span>
      )}

      {isFavourite && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            color: '#fff',
            fontSize: 13,
            textShadow: '0 1px 3px rgba(0,0,0,0.6)',
          }}
          aria-label="Favourite"
        >
          <Icon
            name="star"
            size={16}
            filled
            style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.65))' }}
          />
        </span>
      )}

      {selected && (
        <>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(12,102,228,0.25)' }} />
          <div
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 20,
              height: 20,
              background: 'var(--acc)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              color: '#fff',
            }}
          >
            <Icon name="check" size={16} />
          </div>
        </>
      )}
    </div>
  )
}
