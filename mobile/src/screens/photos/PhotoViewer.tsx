/**
 * The full-screen viewer — UI-MOBILE.md §2.2.
 *
 * A modal rather than a route, and deliberately. Swiping between photos needs
 * the whole list, and pushing an array of photos through navigation params
 * would serialise it and warn about it; holding it here keeps the viewer a
 * function of state the timeline already has.
 *
 * **What is here:** swipe between photos, double-tap to zoom, and the action
 * bar — share, download, favourite, delete.
 *
 * **What is not, and is not pretended:** pinch-to-zoom, swipe-down-to-dismiss,
 * and auto-hiding bars. Each needs a gesture layer (`react-native-gesture-
 * handler`, which is installed, plus reanimated, which is not) and the honest
 * thing is to leave them out rather than ship gestures that half work. Double-
 * tap is included because it needs no gesture library at all.
 *
 * The top bar shows the filename and date but no Info sheet and no More menu;
 * §2.2's Info sheet wants EXIF the backend does not yet expose.
 */

import { useCallback, useRef, useState } from 'react'
import {
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'

import { GradientTile } from '../../components/GradientTile'
import { Icon } from '../../components/Icon'
import type { Photo } from '../../core/types'
import { usePhotoUri } from '../../hooks/usePhotoUri'
import { useTheme } from '../../theme/ThemeProvider'
import type { PhotoActions } from './usePhotoActions'

export function PhotoViewer({
  photos,
  initialIndex,
  onClose,
  actions,
}: {
  photos: Photo[]
  initialIndex: number
  onClose: () => void
  actions: PhotoActions
}) {
  const theme = useTheme()
  const [index, setIndex] = useState(initialIndex)
  // Typed as a plain rectangle, not `ScaledSize`: it is seeded from the window
  // and then replaced by `onLayout`, which reports a `LayoutRectangle` and has
  // no `scale` or `fontScale`.
  const [size, setSize] = useState<{ width: number; height: number }>(() => Dimensions.get('window'))
  const listRef = useRef<FlatList<Photo>>(null)

  const current = photos[index]

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (size.width === 0) return
      const next = Math.round(event.nativeEvent.contentOffset.x / size.width)
      if (next !== index && next >= 0 && next < photos.length) setIndex(next)
    },
    [index, photos.length, size.width],
  )

  const confirmDelete = useCallback(() => {
    if (!current) return
    Alert.alert(
      'Move to trash?',
      // The wording matters: this is recoverable, and saying so is what stops
      // someone treating an accidental tap as a loss.
      'It goes to the server’s trash and can be restored in Immich for the retention period.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move to trash',
          style: 'destructive',
          onPress: () => {
            void actions.remove([current.id])
            onClose()
          },
        },
      ],
    )
  }, [actions, current, onClose])

  if (!current) return null

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View
        style={[styles.flex, { backgroundColor: theme.color['background-inverse'] }]}
        onLayout={(event: LayoutChangeEvent) => setSize(event.nativeEvent.layout)}
      >
        <View style={[styles.topBar, { paddingTop: theme.spacing['spacing-06'] }]}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <Icon name="close" size={20} color={theme.color['text-inverse']} />
          </Pressable>
          <Text
            numberOfLines={1}
            style={[
              theme.text['text-body-compact-01'],
              styles.grow,
              { color: theme.color['text-inverse'], textAlign: 'center' },
            ]}
          >
            {current.name}
          </Text>
          <Pressable
            onPress={() => void actions.favourite(current)}
            hitSlop={12}
            accessibilityLabel={current.isFavourite ? 'Remove from favourites' : 'Add to favourites'}
          >
            <Icon
              name="star"
              variant={current.isFavourite ? 'filled' : 'outline'}
              size={20}
              color={
                current.isFavourite ? theme.color['support-warning'] : theme.color['text-inverse']
              }
            />
          </Pressable>
        </View>

        <FlatList
          ref={listRef}
          data={photos}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: size.width, offset: size.width * i, index: i })}
          keyExtractor={(photo) => photo.id}
          onMomentumScrollEnd={onScroll}
          renderItem={({ item }) => <ViewerPage photo={item} size={size} />}
        />

        <View style={[styles.bottomBar, { paddingBottom: theme.spacing['spacing-06'] }]}>
          <ViewerAction
            icon="external"
            label="Share"
            onPress={() => void actions.share([current.id])}
            disabled={actions.busy}
          />
          <ViewerAction
            icon="download"
            label="Download"
            onPress={() => void actions.download(current)}
            disabled={actions.busy}
          />
          <ViewerAction
            icon="star"
            label="Favourite"
            onPress={() => void actions.favourite(current)}
            disabled={actions.busy}
          />
          <ViewerAction icon="alert" label="Delete" onPress={confirmDelete} disabled={actions.busy} />
        </View>
      </View>
    </Modal>
  )
}

/** One page. The gradient is always drawn; the photo lands on top of it. */
function ViewerPage({ photo, size }: { photo: Photo; size: { width: number; height: number } }) {
  const uri = usePhotoUri(photo.id, 'large')
  const [zoomed, setZoomed] = useState(false)

  return (
    <Pressable
      onPress={() => setZoomed((z) => !z)}
      style={{ width: size.width, height: size.height - 160, justifyContent: 'center' }}
    >
      <GradientTile gradient={photo.gradient} style={StyleSheet.absoluteFill} />
      {uri && (
        <Image
          source={{ uri }}
          resizeMode={zoomed ? 'cover' : 'contain'}
          style={[styles.image, zoomed && styles.zoomed]}
        />
      )}
      {photo.isVideo && (
        <View style={styles.playBadge}>
          <Icon name="play" size={32} color="#ffffff" />
        </View>
      )}
    </Pressable>
  )
}

function ViewerAction({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: 'external' | 'download' | 'star' | 'alert'
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  const theme = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      style={styles.action}
    >
      <Icon
        name={icon}
        size={20}
        color={disabled ? theme.color['text-disabled'] : theme.color['text-inverse']}
      />
      <Text
        style={[
          theme.text['text-helper-text-01'],
          { color: disabled ? theme.color['text-disabled'] : theme.color['text-inverse'] },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  action: { alignItems: 'center', gap: 4, minWidth: 64, minHeight: 44 },
  image: { width: '100%', height: '100%' },
  zoomed: { transform: [{ scale: 1.6 }] },
  playBadge: { position: 'absolute', alignSelf: 'center' },
})
