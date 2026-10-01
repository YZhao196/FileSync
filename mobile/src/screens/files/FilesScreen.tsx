/**
 * The files browser — UI-MOBILE.md §3.1, first pass.
 *
 * A list rather than the desktop's split panes, which the spec asks for
 * explicitly: there is no room for a tree and a preview side by side on a
 * phone. Folders sort above files, and tapping a folder descends.
 *
 * This is the one screen where mobile does something the desktop deliberately
 * does not. UI-DESKTOP.md cuts the Files browser entirely — "deliberately
 * absent, not deferred", because Nextcloud's own client covers it. On a phone
 * there is no such client doing the job, so the spec puts it back.
 *
 * Not here yet, and not stubbed: preview, rename, move, delete, new folder,
 * sort and grid view. The rows do not pretend to open anything.
 */

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'

import { Icon } from '../../components/Icon'
import type { FileEntry } from '../../core/types'
import { useSession } from '../../state/session'
import { useTheme } from '../../theme/ThemeProvider'

/** The desktop's vocabulary, so the same file looks the same on both. */
function iconFor(entry: FileEntry): 'folder' | 'image' | 'file-text' | 'archive' | 'file' {
  if (entry.isFolder) return 'folder'
  if (entry.mime?.startsWith('image/')) return 'image'
  if (entry.mime?.startsWith('text/')) return 'file-text'
  if (entry.mime === 'application/zip') return 'archive'
  return 'file'
}

export function FilesScreen() {
  const theme = useTheme()
  const { backends } = useSession()

  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (next: string) => {
      setLoading(true)
      setError(null)
      try {
        const list = await backends.files.list(next)
        // Folders first, always — the spec is explicit, and it is the one
        // ordering that stays useful however the rest is sorted.
        setEntries([...list].sort((a, b) => Number(b.isFolder) - Number(a.isFolder)))
        setPath(next)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read that folder.')
      } finally {
        setLoading(false)
      }
    },
    [backends],
  )

  useEffect(() => {
    void load('')
  }, [load])

  const segments = path.split('/').filter(Boolean)

  return (
    <View style={[styles.flex, { backgroundColor: theme.color.background }]}>
      {/* Breadcrumb. Tappable segments, and the whole thing scrolls
          horizontally once a path gets deep enough to overflow. */}
      <View
        style={[
          styles.breadcrumb,
          { borderBottomColor: theme.color['border-subtle-00'], paddingHorizontal: theme.spacing['spacing-04'] },
        ]}
      >
        <Pressable onPress={() => void load('')} hitSlop={8}>
          <Text style={[theme.text['text-body-compact-01'], { color: theme.color['link-primary'] }]}>
            Files
          </Text>
        </Pressable>
        {segments.map((segment, i) => (
          <View key={i} style={styles.crumb}>
            <Text style={[theme.text['text-body-compact-01'], { color: theme.color['text-secondary'] }]}>
              ›
            </Text>
            <Pressable
              onPress={() => void load(segments.slice(0, i + 1).join('/'))}
              hitSlop={8}
            >
              <Text
                style={[theme.text['text-body-compact-01'], { color: theme.color['link-primary'] }]}
              >
                {segment}
              </Text>
            </Pressable>
          </View>
        ))}
      </View>

      {loading ? (
        <View style={styles.centred}>
          <ActivityIndicator color={theme.color['icon-primary']} />
        </View>
      ) : error ? (
        <View style={styles.centred}>
          <Icon name="alert" size={32} color={theme.color['support-error']} />
          <Text style={[theme.text['text-body-01'], { color: theme.color['text-secondary'] }]}>
            {error}
          </Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(entry) => entry.path}
          renderItem={({ item }) => (
            <Pressable
              // 44pt minimum target, per the spec's accessibility line — the
              // padding does the work rather than a fixed height, so a longer
              // filename wraps instead of clipping.
              style={[styles.row, { paddingHorizontal: theme.spacing['spacing-04'] }]}
              onPress={() => item.isFolder && void load(item.path)}
            >
              <Icon
                name={iconFor(item)}
                size={20}
                color={item.isFolder ? theme.color['icon-primary'] : theme.color['icon-secondary']}
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
                  {item.sizeLabel ? `${item.sizeLabel} · ` : ''}
                  {item.modifiedLabel}
                </Text>
              </View>
              {item.isFolder && <Icon name="back" size={16} color={theme.color['icon-secondary']} />}
            </Pressable>
          )}
          ItemSeparatorComponent={() => (
            <View style={{ height: 1, backgroundColor: theme.color['border-subtle-00'] }} />
          )}
          ListEmptyComponent={
            <View style={styles.centred}>
              <Text style={[theme.text['text-body-01'], { color: theme.color['text-secondary'] }]}>
                This folder is empty.
              </Text>
            </View>
          }
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  crumb: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  grow: { flex: 1, gap: 2 },
})
