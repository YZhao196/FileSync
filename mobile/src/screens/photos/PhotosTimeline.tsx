/**
 * The Photos timeline — UI-MOBILE.md §2.1, with §2.3's multi-select.
 *
 * A three-column grid, grouped by date, paging as it scrolls, filtered by the
 * chip row, and selectable. Tapping a tile opens the viewer; long-pressing one
 * starts a selection, which is the gesture the spec asks for.
 *
 * Two things differ from how the desktop does it, both deliberately:
 *
 *   - **Rows, not a column count.** React Native's `FlatList` cannot mix
 *     full-width section headers with `numColumns`, so photos are chunked into
 *     rows and a `SectionList` renders those under sticky headers.
 *   - **`groupPhotos`, `applyFilter` and `FILTERS` come from the shared
 *     library**, so the date buckets and the filter vocabulary are the
 *     desktop's own code rather than an imitation of it.
 *
 * Rows carry each photo's index into the visible list, because the viewer needs
 * to know where in *that* list it opened. Recomputing it from the photo id at
 * tap time would be the same work with an extra way to be wrong when the filter
 * changes mid-scroll.
 *
 * UNVERIFIED: none of this has run against a real Immich. The mock backend is
 * what renders today — `core/client.ts` selects it in a development build and
 * cannot reach it in a release one.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native'

import { Icon } from '../../components/Icon'
import { Toast } from '../../components/Toast'
import type { Photo, PhotoId } from '../../core/types'
import { applyFilter, groupPhotos, type PhotoFilter } from '../../lib/photos'
import { useSession } from '../../state/session'
import { useTheme } from '../../theme/ThemeProvider'
import { AlbumPicker } from './AlbumPicker'
import { FilterChips } from './FilterChips'
import { PhotoViewer } from './PhotoViewer'
import { SelectionBar } from './SelectionBar'
import { PhotoTile } from './PhotoTile'
import { COLUMNS, chunkRows } from './rows'
import { usePhotoActions } from './usePhotoActions'

const GAP = 2

/** A photo paired with its position in the currently-visible list. */
interface Placed {
  photo: Photo
  index: number
}

export function PhotosTimeline() {
  const theme = useTheme()
  const { backends } = useSession()
  const actions = usePhotoActions()

  const [photos, setPhotos] = useState<Photo[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<PhotoFilter>('all')

  const [selection, setSelection] = useState<ReadonlySet<PhotoId>>(new Set())
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [picking, setPicking] = useState(false)

  // Seeded from the window so the first frame is the right size, then corrected
  // by the container's own measurement. See `tileSize`.
  const [width, setWidth] = useState(() => Dimensions.get('window').width)

  const load = useCallback(
    async (nextPage: number) => {
      try {
        setError(null)
        const result = await backends.photos.list({ page: nextPage })
        setPhotos((current) => (nextPage === 0 ? result.photos : [...current, ...result.photos]))
        setHasMore(result.hasMore)
        setPage(nextPage)
      } catch (err) {
        // Shown rather than swallowed: a gallery that stops silently looks
        // exactly like an empty library.
        setError(err instanceof Error ? err.message : 'Could not load photos.')
        setHasMore(false)
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [backends],
  )

  useEffect(() => {
    setLoading(true)
    void load(0)
  }, [load])

  const visible = useMemo(() => applyFilter(photos, filter), [photos, filter])

  // A map rather than `visible.indexOf` per photo: the list grows with every
  // page, and a linear scan inside a map over the same list is quadratic in the
  // library size — which is invisible at one page and is the whole frame budget
  // at twenty.
  const indexById = useMemo(() => new Map(visible.map((photo, i) => [photo.id, i])), [visible])

  const sections = useMemo(
    () =>
      groupPhotos(visible).map((group) => ({
        title: group.date,
        data: chunkRows(
          group.photos.map((photo) => ({ photo, index: indexById.get(photo.id) ?? 0 }) as Placed),
        ),
      })),
    [visible, indexById],
  )

  const selecting = selection.size > 0
  const tile = tileSize(width)

  function toggle(id: PhotoId) {
    setSelection((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading) {
    return (
      <View style={[styles.centred, { backgroundColor: theme.color.background }]}>
        <ActivityIndicator color={theme.color['icon-primary']} />
      </View>
    )
  }

  return (
    <View
      style={styles.flex}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
    >
      <FilterChips value={filter} onChange={setFilter} />

      <SectionList
        style={{ backgroundColor: theme.color.background }}
        sections={sections}
        keyExtractor={(row) => row.map((p) => p.photo.id).join(',')}
        stickySectionHeadersEnabled
        contentContainerStyle={{ padding: GAP }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true)
              void load(0)
            }}
            tintColor={theme.color['icon-primary']}
          />
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (hasMore && !error && !loading) void load(page + 1)
        }}
        renderSectionHeader={({ section }) => (
          <View style={{ backgroundColor: theme.color.background }}>
            <Text
              testID="date-header"
              style={[
                theme.text['text-heading-compact-01'],
                { color: theme.color['text-primary'], paddingVertical: theme.spacing['spacing-03'] },
              ]}
            >
              {section.title}
            </Text>
          </View>
        )}
        renderItem={({ item: row }) => (
          <View style={styles.row}>
            {row.map(({ photo, index }) => (
              <Pressable
                key={photo.id}
                testID="photo-tile"
                // Tapping toggles while selecting and opens the viewer
                // otherwise; the long press is what starts a selection, which
                // is the gesture §2.1 asks for and the only way to reach it
                // without a mode button in the header.
                onPress={() => (selecting ? toggle(photo.id) : setViewerIndex(index))}
                onLongPress={() =>
                  setSelection((current) => new Set(current).add(photo.id))
                }
                delayLongPress={250}
                style={{ width: tile, height: tile }}
              >
                <PhotoTile photo={photo} size={tile} selected={selection.has(photo.id)} />
              </Pressable>
            ))}
            {/* Keeps a short final row at tile width instead of stretching it. */}
            {row.length < COLUMNS &&
              Array.from({ length: COLUMNS - row.length }, (_, i) => (
                <View key={`filler-${i}`} style={{ width: tile }} />
              ))}
          </View>
        )}
        ListEmptyComponent={
          error ? (
            <Message icon="alert" tone="error" title="Couldn't load photos" body={error} />
          ) : (
            <Message
              icon="image"
              title={filter === 'all' ? 'No photos yet' : 'Nothing here'}
              body={filter === 'all' ? 'Uploads from your phone appear here.' : 'Try another filter.'}
            />
          )
        }
      />

      {selecting ? (
        <SelectionBar
          ids={[...selection]}
          actions={actions}
          onCancel={() => setSelection(new Set())}
          onAddToAlbum={() => setPicking(true)}
        />
      ) : null}

      {viewerIndex !== null && (
        <PhotoViewer
          photos={visible}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          actions={actions}
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

/**
 * A third of the *container*, less the gaps.
 *
 * Measured with `onLayout` rather than taken from the window. The window is the
 * wrong number on a tablet, in split view, and wherever the list does not span
 * the full width — and because `onLayout` re-fires on rotation, it reflows the
 * grid in landscape without subscribing to anything.
 *
 * The window value seeds the first render so the opening frame is the right
 * size rather than zero; `onLayout` corrects it immediately after. A zero-width
 * first pass would flash empty tiles, which reads as a loading bug.
 */
function tileSize(containerWidth: number): number {
  return Math.max(1, Math.floor((containerWidth - GAP * (COLUMNS + 1)) / COLUMNS))
}

function Message({
  icon,
  title,
  body,
  tone,
}: {
  icon: 'alert' | 'image'
  title: string
  body: string
  tone?: 'error'
}) {
  const theme = useTheme()
  return (
    <View style={styles.message}>
      <Icon
        name={icon}
        size={32}
        color={tone === 'error' ? theme.color['support-error'] : theme.color['icon-secondary']}
      />
      <Text style={[theme.text['text-heading-compact-02'], { color: theme.color['text-primary'] }]}>
        {title}
      </Text>
      <Text
        style={[
          theme.text['text-body-01'],
          { color: theme.color['text-secondary'], textAlign: 'center' },
        ]}
      >
        {body}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: GAP, marginBottom: GAP },
  tileOverlay: {
    flex: 1,
    padding: 4,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    gap: 4,
  },
  message: { alignItems: 'center', gap: 8, paddingVertical: 64, paddingHorizontal: 32 },
})
