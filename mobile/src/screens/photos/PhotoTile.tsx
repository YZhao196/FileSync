/**
 * One photo in a grid: the gradient, with the thumbnail over it when it loads.
 *
 * The gradient is drawn first and always. That is not decoration — it is what
 * makes a thumbnail that has not arrived yet look deliberate rather than
 * broken, and it is what the tile shows if the server never produces one. On
 * the desktop the same gradient is the placeholder for a photo whose thumbnail
 * is missing, so the two agree on what "no image" looks like.
 *
 * Used by both the timeline and an album's contents, so a photo that fails to
 * load looks the same in both places. They had drifted into two nearly
 * identical tiles before this existed.
 */

import { Image, StyleSheet, View } from 'react-native'

import { GradientTile } from '../../components/GradientTile'
import { Icon } from '../../components/Icon'
import type { Photo } from '../../core/types'
import { usePhotoUri } from '../../hooks/usePhotoUri'
import { useTheme } from '../../theme/ThemeProvider'

export function PhotoTile({
  photo,
  size,
  selected,
}: {
  photo: Photo
  /** The side length in points; tiles are square. */
  size: number
  selected?: boolean
}) {
  const theme = useTheme()
  const uri = usePhotoUri(photo.id, 'small')

  return (
    <GradientTile
      gradient={photo.gradient}
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.small,
        borderWidth: selected ? 3 : 0,
        borderColor: theme.color['border-interactive'],
        overflow: 'hidden',
      }}
    >
      {uri && (
        <Image
          source={{ uri }}
          // `cover` rather than `contain`: a grid of tiles at different aspect
          // ratios with letterboxing looks broken, and this is a thumbnail.
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
        />
      )}

      <PhotoBadges photo={photo} selected={selected} />
    </GradientTile>
  )
}

/**
 * The video, favourite and selection marks, in the corners.
 *
 * A plain `View`, not a `GradientTile` — the first version of this drew the
 * gradient again as the overlay's background, which painted over the thumbnail
 * and produced a grid of coloured squares that looked like the cache failing.
 *
 * The marks are white, which is only legible over a dark image. Carbon's icons
 * take a single colour with no stroke, so the honest options are a shadow
 * (which SVG does not give cheaply here) or a scrim behind each mark. Neither
 * is worth the pixels on a 100pt tile; noted so the next person knows it was
 * seen rather than missed.
 */
function PhotoBadges({ photo, selected }: { photo: Photo; selected?: boolean }) {
  if (!photo.isVideo && !photo.isFavourite && !selected) return null

  return (
    <View style={styles.overlay} pointerEvents="none">
      {selected && <Icon name="check" variant="filled" size={16} color="#ffffff" />}
      {photo.isFavourite && <Icon name="star" variant="filled" size={16} color="#ffffff" />}
      {photo.isVideo && <Icon name="play" size={20} color="#ffffff" />}
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    // Written out rather than `StyleSheet.absoluteFillObject`, which this
    // React Native version does not expose — spreading the registered style id
    // would have produced a numeric key and no layout at all.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: 4,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    gap: 4,
  },
})
