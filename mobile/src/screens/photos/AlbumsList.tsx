/**
 * The albums list — UI-MOBILE.md §2.5.
 *
 * Albums live inside the Photos tab rather than as a fourth tab, because the
 * spec fixes the tab bar at three and calls a fourth "dead weight half the
 * time". A segmented control in the Photos header switches between this and the
 * timeline.
 *
 * Read-only apart from opening one. Rename, delete and the album's own share
 * are §2.5's action list and are not here; they are destructive operations on
 * something the server owns, and the desktop's position — that album
 * management is Immich's job — applies to a phone too.
 */

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'

import { GradientTile } from '../../components/GradientTile'
import { Icon } from '../../components/Icon'
import type { Album } from '../../core/types'
import { useSession } from '../../state/session'
import { useTheme } from '../../theme/ThemeProvider'

export function AlbumsList({ onOpen }: { onOpen: (album: Album) => void }) {
  const theme = useTheme()
  const { backends } = useSession()

  const [albums, setAlbums] = useState<Album[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setAlbums(await backends.photos.albums())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load albums.')
      setAlbums([])
    }
  }, [backends])

  useEffect(() => {
    void load()
  }, [load])

  if (albums === null) {
    return (
      <View style={[styles.centred, { backgroundColor: theme.color.background }]}>
        <ActivityIndicator color={theme.color['icon-primary']} />
      </View>
    )
  }

  return (
    <FlatList
      style={{ backgroundColor: theme.color.background }}
      data={albums}
      keyExtractor={(album) => album.id}
      contentContainerStyle={{ padding: theme.spacing['spacing-03'] }}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => onOpen(item)}
          accessibilityRole="button"
          style={[styles.row, { paddingHorizontal: theme.spacing['spacing-03'] }]}
        >
          <GradientTile
            gradient={item.gradient}
            style={{ width: 56, height: 56, borderRadius: theme.radius.small }}
          />
          <View style={styles.grow}>
            <Text
              numberOfLines={1}
              style={[theme.text['text-body-compact-01'], { color: theme.color['text-primary'] }]}
            >
              {item.name}
            </Text>
            <Text
              style={[theme.text['text-helper-text-01'], { color: theme.color['text-secondary'] }]}
            >
              {item.count === 1 ? '1 item' : `${item.count} items`}
            </Text>
          </View>
          <Icon name="back" size={16} color={theme.color['icon-secondary']} />
        </Pressable>
      )}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Icon name="folder" size={32} color={theme.color['icon-secondary']} />
          <Text
            style={[
              theme.text['text-body-01'],
              styles.centre,
              { color: theme.color['text-secondary'] },
            ]}
          >
            {error ?? 'No albums yet. Immich creates albums; this browses them.'}
          </Text>
        </View>
      }
    />
  )
}

const styles = StyleSheet.create({
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 44 },
  grow: { flex: 1, gap: 2 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 64, paddingHorizontal: 32 },
  centre: { textAlign: 'center' },
})
