/**
 * The Photos timeline — UI-MOBILE.md §2.1.
 *
 * A three-column grid, grouped by date, paging as it scrolls. This is the read
 * path: load a page, group it, draw it. Selection, the viewer and search are
 * the next screens, and they are absent rather than stubbed — a control that
 * does nothing is worse than one that is not there.
 *
 * Two things differ from how the desktop does it, both deliberately:
 *
 *   - **Rows, not a column count.** React Native's `FlatList` cannot mix
 *     full-width section headers with `numColumns`, so photos are chunked into
 *     rows and a `SectionList` renders those under sticky headers.
 *   - **`groupPhotos` and `applyFilter` come from the shared library**, so the
 *     date buckets and the filter vocabulary are the desktop's own code rather
 *     than an imitation of it.
 *
 * UNVERIFIED: none of this has run against a real Immich. The mock backend is
 * what renders today — `core/client.ts` selects it in a development build and
 * cannot reach it in a release one.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Dimensions,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native'

import { GradientTile } from '../../components/GradientTile'
import { Icon } from '../../components/Icon'
import type { Photo } from '../../core/types'
import { applyFilter, groupPhotos, type PhotoFilter } from '../../lib/photos'
import { useSession } from '../../state/session'
import { useTheme } from '../../theme/ThemeProvider'
import { COLUMNS, chunkRows } from './rows'

const GAP = 2

export function PhotosTimeline() {
  const theme = useTheme()
  const { backends } = useSession()

  const [photos, setPhotos] = useState<Photo[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const filter: PhotoFilter = 'all'

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

  const sections = useMemo(
    () =>
      groupPhotos(applyFilter(photos, filter)).map((group) => ({
        title: group.date,
        data: chunkRows(group.photos),
      })),
    [photos, filter],
  )

  const tile = tileSize(width)

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
    <SectionList
      style={{ backgroundColor: theme.color.background }}
      sections={sections}
      // A row's identity is its photos, so a re-grouping does not drop the
      // rows that did not change.
      keyExtractor={(row) => row.map((p) => p.id).join(',')}
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
          {row.map((photo) => (
            <GradientTile
              key={photo.id}
              testID="photo-tile"
              gradient={photo.gradient}
              style={{ width: tile, height: tile, borderRadius: theme.radius.small }}
            />
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
          <Message icon="image" title="No photos yet" body="Uploads from your phone appear here." />
        )
      }
    />
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
  message: { alignItems: 'center', gap: 8, paddingVertical: 64, paddingHorizontal: 32 },
})
