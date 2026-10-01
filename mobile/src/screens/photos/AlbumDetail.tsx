/**
 * One album's contents — UI-MOBILE.md §2.5, "Open: grid of that album's items;
 * same viewer and selection behaviour".
 *
 * Same viewer, yes — it is the same `PhotoViewer` component. Selection is not
 * here yet: §2.5 asks for it and it is a real gap rather than a decision, noted
 * so it does not read as one.
 *
 * The 1000-item cap is worth knowing before reading the code. Immich's search
 * endpoint caps `size` at 1000, so an album larger than that shows the first
 * thousand — the shared client says so in `remote.ts`. Nothing here can fix
 * that; it needs paging through the album, which needs a cursor the client does
 * not use yet.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native'

import { Icon } from '../../components/Icon'
import { Toast } from '../../components/Toast'
import type { Album, Photo, PhotoId } from '../../core/types'
import { useSession } from '../../state/session'
import { useTheme } from '../../theme/ThemeProvider'
import { AlbumPicker } from './AlbumPicker'
import { PhotoTile } from './PhotoTile'
import { PhotoViewer } from './PhotoViewer'
import { COLUMNS, chunkRows } from './rows'
import { SelectionBar } from './SelectionBar'
import { usePhotoActions } from './usePhotoActions'

const GAP = 2

export function AlbumDetail({ album, onBack }: { album: Album; onBack: () => void }) {
  const theme = useTheme()
  const { backends } = useSession()
  const actions = usePhotoActions()

  const [photos, setPhotos] = useState<Photo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)

  // Measured rather than taken from the window, for the reasons the timeline
  // gives: the window is the wrong number in split view and on a tablet.
  const [width, setWidth] = useState(() => Dimensions.get('window').width)
  const tile = Math.max(1, Math.floor((width - GAP * 4) / COLUMNS))

  const [selection, setSelection] = useState<ReadonlySet<PhotoId>>(new Set())
  const [picking, setPicking] = useState(false)
  const selecting = selection.size > 0

  function toggle(id: PhotoId) {
    setSelection((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const load = useCallback(async () => {
    setError(null)
    try {
      setPhotos(await backends.photos.albumAssets(album.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this album.')
      setPhotos([])
    }
  }, [backends, album.id])

  useEffect(() => {
    void load()
  }, [load])

  const rows = photos ? chunkRows(photos.map((photo, index) => ({ photo, index }))) : []

  return (
    <View
      style={[styles.flex, { backgroundColor: theme.color.background }]}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
    >
      <View style={[styles.header, { paddingHorizontal: theme.spacing['spacing-04'] }]}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityLabel="Back to albums">
          <Icon name="back" size={20} color={theme.color['icon-primary']} />
        </Pressable>
        <Text
          numberOfLines={1}
          style={[
            theme.text['text-heading-compact-02'],
            styles.grow,
            { color: theme.color['text-primary'] },
          ]}
        >
          {album.name}
        </Text>
      </View>

      {photos === null ? (
        <View style={styles.centred}>
          <ActivityIndicator color={theme.color['icon-primary']} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: GAP }}>
          {rows.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.row}>
              {row.map(({ photo, index }) => (
                <Pressable
                  key={photo.id}
                  testID="album-tile"
                  // Same gesture as the timeline, so a photo behaves the same
                  // way in both places — §2.5 asks for "the same viewer and
                  // selection behaviour" and this is what that means.
                  onPress={() => (selecting ? toggle(photo.id) : setViewerIndex(index))}
                  onLongPress={() => setSelection((current) => new Set(current).add(photo.id))}
                  delayLongPress={250}
                  style={{ width: tile, height: tile }}
                >
                  <PhotoTile photo={photo} size={tile} selected={selection.has(photo.id)} />
                </Pressable>
              ))}
            </View>
          ))}

          {rows.length === 0 && (
            <View style={styles.empty}>
              <Icon name="image" size={32} color={theme.color['icon-secondary']} />
              <Text
                style={[
                  theme.text['text-body-01'],
                  { color: theme.color['text-secondary'], textAlign: 'center' },
                ]}
              >
                {error ?? 'This album is empty.'}
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {viewerIndex !== null && photos && (
        <PhotoViewer
          photos={photos}
          initialIndex={viewerIndex}
          onClose={() => {
            setViewerIndex(null)
            // A photo deleted from the viewer should not still be in the grid.
            void load()
          }}
          actions={actions}
        />
      )}

      {selecting && (
        <SelectionBar
          ids={[...selection]}
          actions={actions}
          onCancel={() => setSelection(new Set())}
          onAddToAlbum={() => setPicking(true)}
        />
      )}

      {picking && (
        <AlbumPicker
          ids={[...selection]}
          onClose={() => setPicking(false)}
          onPick={(albumId) => {
            void actions.addToAlbum(albumId, [...selection])
            setPicking(false)
            setSelection(new Set())
          }}
        />
      )}

      <Toast message={actions.message} onDismiss={actions.dismiss} />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 44 },
  grow: { flex: 1 },
  row: { flexDirection: 'row', gap: GAP, marginBottom: GAP },
  badge: { flex: 1, padding: 4, alignItems: 'flex-start', justifyContent: 'flex-start' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 64 },
})
