import type { CSSProperties } from 'react'
import type { PhotoBackend } from '../core/backends'
import type { Photo } from '../core/types'
import { useThumb } from '../hooks/useThumb'
import { GradientTile } from './GradientTile'

/**
 * A photo in the grid. Owns the thumbnail fetch so `GradientTile` stays a
 * presentational component that takes a plain `src`.
 */
export function PhotoTile({
  photo,
  backend,
  selected,
  style,
  onClick,
}: {
  photo: Photo
  backend: PhotoBackend
  selected?: boolean
  style?: CSSProperties
  onClick?: () => void
}) {
  const src = useThumb(backend, photo.id, 'small')

  return (
    <GradientTile
      gradient={photo.gradient}
      src={src}
      selected={selected}
      isVideo={photo.isVideo}
      isFavourite={photo.isFavourite}
      title={photo.name}
      style={style}
      onClick={onClick}
    />
  )
}
