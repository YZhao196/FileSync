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
        borderRadius: 'var(--border-radius-small)',
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
            // These badges sit on top of arbitrary photo content, so they need a
            // pairing that stays dark-on-light whatever the theme: the overlay
            // scrim under a white on-color icon, not `background-inverse` (which
            // flips to a light surface in the dark theme).
            background: 'var(--overlay)',
            color: 'var(--icon-on-color)',
            borderRadius: 'var(--border-radius-full)',
            width: 20,
            height: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
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
            color: 'var(--icon-on-color)',
          }}
          aria-label="Favourite"
        >
          <Icon
            name="star"
            size={16}
            filled
            style={{ filter: 'drop-shadow(0 1px 2px var(--shadow))' }}
          />
        </span>
      )}

      {selected && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'color-mix(in srgb, var(--background-brand) 25%, transparent)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 20,
              height: 20,
              background: 'var(--background-brand)',
              borderRadius: 'var(--border-radius-full)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--icon-on-color)',
            }}
          >
            <Icon name="check" size={16} />
          </div>
        </>
      )}
    </div>
  )
}
