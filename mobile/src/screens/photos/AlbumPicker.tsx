/**
 * "Add to album" — UI-MOBILE.md §2.5, add-to-existing half only.
 *
 * **No "New album" row, and that is a decision rather than an omission.**
 * §2.5 lists one, but creating an album is not on the backend interface the two
 * clients share, and the desktop states the position plainly: "creating one is
 * Immich's job". Adding `createAlbum` to `PhotoBackend` would be inventing an
 * Immich call in the shared contract on the strength of an older spec, and
 * UI-DESKTOP.md's reasoning — that Immich already does this well and a second
 * implementation is duplication — applies to a phone exactly as much as to a
 * desktop. Recorded as a divergence rather than quietly dropped.
 *
 * Tapping an album adds and closes; the result is reported by the caller's
 * toast, not here, so there is one place that says what happened.
 */

import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import { GradientTile } from '../../components/GradientTile'
import type { Album, PhotoId } from '../../core/types'
import { useSession } from '../../state/session'
import { useTheme } from '../../theme/ThemeProvider'

export function AlbumPicker({
  ids,
  onPick,
  onClose,
}: {
  ids: PhotoId[]
  onPick: (albumId: string) => void
  onClose: () => void
}) {
  const theme = useTheme()
  const { backends } = useSession()
  const [albums, setAlbums] = useState<Album[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    backends.photos
      .albums()
      .then((next) => {
        if (!cancelled) setAlbums(next)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load albums.')
      })
    return () => {
      cancelled = true
    }
  }, [backends])

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.color['layer-01'], borderTopLeftRadius: theme.radius.large, borderTopRightRadius: theme.radius.large },
          ]}
        >
          <Text
            style={[
              theme.text['text-heading-compact-02'],
              { color: theme.color['text-primary'], padding: theme.spacing['spacing-04'] },
            ]}
          >
            Add {ids.length === 1 ? '1 photo' : `${ids.length} photos`} to album
          </Text>

          {error ? (
            <Text
              style={[
                theme.text['text-body-01'],
                { color: theme.color['support-error'], padding: theme.spacing['spacing-04'] },
              ]}
            >
              {error}
            </Text>
          ) : albums === null ? (
            <ActivityIndicator style={styles.loading} color={theme.color['icon-primary']} />
          ) : (
            <FlatList
              data={albums}
              keyExtractor={(album) => album.id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => onPick(item.id)}
                  style={[styles.row, { paddingHorizontal: theme.spacing['spacing-04'] }]}
                >
                  <GradientTile
                    gradient={item.gradient}
                    style={{ width: 40, height: 40, borderRadius: theme.radius.small }}
                  />
                  <View style={styles.grow}>
                    <Text
                      style={[
                        theme.text['text-body-compact-01'],
                        { color: theme.color['text-primary'] },
                      ]}
                    >
                      {item.name}
                    </Text>
                    <Text
                      style={[
                        theme.text['text-helper-text-01'],
                        { color: theme.color['text-secondary'] },
                      ]}
                    >
                      {item.count} items
                    </Text>
                  </View>
                </Pressable>
              )}
              ListEmptyComponent={
                <Text
                  style={[
                    theme.text['text-body-01'],
                    { color: theme.color['text-secondary'], padding: theme.spacing['spacing-04'] },
                  ]}
                >
                  No albums yet. Immich creates albums; this adds to them.
                </Text>
              }
            />
          )}

          <Pressable onPress={onClose} style={styles.cancel}>
            <Text style={[theme.text['text-body-compact-01'], { color: theme.color['link-primary'] }]}>
              Cancel
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { maxHeight: '70%' },
  loading: { padding: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 44 },
  grow: { flex: 1, gap: 2 },
  cancel: { alignItems: 'center', justifyContent: 'center', minHeight: 48 },
})
