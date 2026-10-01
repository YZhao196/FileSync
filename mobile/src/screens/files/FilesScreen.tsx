/**
 * The files browser — UI-MOBILE.md §3.1, with §3.2's preview and §3.3's actions.
 *
 * A list rather than the desktop's split panes, which the spec asks for
 * explicitly: there is no room for a tree and a preview side by side on a
 * phone. Folders sort above files, always, and tapping a folder descends while
 * tapping a file previews.
 *
 * This is the one screen where mobile does something the desktop deliberately
 * does not. UI-DESKTOP.md cuts the Files browser entirely — "deliberately
 * absent, not deferred", because Nextcloud's own client covers it. On a phone
 * there is no such client doing the job, so the spec puts it back.
 *
 * **Sort is client-side, over what has been listed.** The server returns a
 * directory in one call and this orders it; there is no server-side sort to
 * ask for, so a folder with more entries than fit in one response would sort
 * only the part that arrived. `list` returns them all today.
 *
 * Not here: grid view, search within files, and Move. Grid view and search are
 * §3.1's and are simply not built; Move is explained in `FileSheet`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { Icon } from '../../components/Icon'
import { Toast } from '../../components/Toast'
import type { FileEntry } from '../../core/types'
import { useSession } from '../../state/session'
import { useTheme } from '../../theme/ThemeProvider'
import { FilePreview } from './FilePreview'
import { FileSheet } from './FileSheet'
import { useFileActions } from './useFileActions'

type SortKey = 'name' | 'modified' | 'size'
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'modified', label: 'Date' },
  { key: 'size', label: 'Size' },
]

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
  const [sort, setSort] = useState<SortKey>('name')
  const [previewing, setPreviewing] = useState<FileEntry | null>(null)
  const [sheeting, setSheeting] = useState<FileEntry | null>(null)
  const [newFolder, setNewFolder] = useState<string | null>(null)

  const load = useCallback(
    async (next: string) => {
      setLoading(true)
      setError(null)
      try {
        const list = await backends.files.list(next)
        setEntries(list)
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

  const actions = useFileActions(() => void load(path))

  const sorted = useMemo(() => {
    const compare = (a: FileEntry, b: FileEntry): number => {
      switch (sort) {
        case 'modified':
          return b.modifiedLabel.localeCompare(a.modifiedLabel)
        case 'size':
          return b.sizeBytes - a.sizeBytes
        default:
          return a.name.localeCompare(b.name, undefined, { numeric: true })
      }
    }
    // Folders first, always — the spec is explicit, and it is the one ordering
    // that stays useful however the rest is sorted.
    return [...entries].sort((a, b) =>
      a.isFolder === b.isFolder ? compare(a, b) : a.isFolder ? -1 : 1,
    )
  }, [entries, sort])

  const segments = path.split('/').filter(Boolean)

  return (
    <View style={[styles.flex, { backgroundColor: theme.color.background }]}>
      <View
        style={[
          styles.breadcrumb,
          {
            borderBottomColor: theme.color['border-subtle-00'],
            paddingHorizontal: theme.spacing['spacing-04'],
          },
        ]}
      >
        <Pressable onPress={() => void load('')} hitSlop={8}>
          <Text style={[theme.text['text-body-compact-01'], { color: theme.color['link-primary'] }]}>
            Files
          </Text>
        </Pressable>
        {segments.map((segment, i) => (
          <View key={i} style={styles.crumb}>
            <Text
              style={[theme.text['text-body-compact-01'], { color: theme.color['text-secondary'] }]}
            >
              ›
            </Text>
            <Pressable onPress={() => void load(segments.slice(0, i + 1).join('/'))} hitSlop={8}>
              <Text
                style={[theme.text['text-body-compact-01'], { color: theme.color['link-primary'] }]}
              >
                {segment}
              </Text>
            </Pressable>
          </View>
        ))}

        <View style={styles.spacer} />

        <Pressable onPress={() => setNewFolder('')} hitSlop={8} accessibilityLabel="New folder">
          <Icon name="add" size={20} color={theme.color['icon-primary']} />
        </Pressable>
      </View>

      <View style={[styles.sorts, { paddingHorizontal: theme.spacing['spacing-04'] }]}>
        {SORTS.map((option) => {
          const active = option.key === sort
          return (
            <Pressable
              key={option.key}
              onPress={() => setSort(option.key)}
              hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[
                  theme.text['text-label-01'],
                  { color: active ? theme.color['link-primary'] : theme.color['text-secondary'] },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {newFolder !== null && (
        <View style={[styles.newFolder, { paddingHorizontal: theme.spacing['spacing-04'] }]}>
          <TextInput
            value={newFolder}
            onChangeText={setNewFolder}
            placeholder="Folder name"
            placeholderTextColor={theme.color['text-placeholder']}
            autoFocus
            onSubmitEditing={() => {
              const name = newFolder.trim()
              if (name) void actions.createFolder(path, name)
              setNewFolder(null)
            }}
            style={[
              theme.text['text-body-compact-01'],
              styles.grow,
              {
                color: theme.color['text-primary'],
                backgroundColor: theme.color['field-01'],
                borderBottomColor: theme.color['border-interactive'],
                borderBottomWidth: 2,
                borderRadius: theme.radius.small,
                paddingHorizontal: 12,
                paddingVertical: 10,
              },
            ]}
          />
          <Pressable
            onPress={() => {
              const name = newFolder.trim()
              if (name) void actions.createFolder(path, name)
              setNewFolder(null)
            }}
            hitSlop={8}
          >
            <Icon name="check" size={20} color={theme.color['icon-primary']} />
          </Pressable>
        </View>
      )}

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
          data={sorted}
          keyExtractor={(entry) => entry.path}
          renderItem={({ item }) => (
            <Pressable
              // 44pt minimum target, per the spec's accessibility line — the
              // padding does the work rather than a fixed height, so a longer
              // filename wraps instead of clipping.
              style={[styles.row, { paddingHorizontal: theme.spacing['spacing-04'] }]}
              onPress={() => (item.isFolder ? void load(item.path) : setPreviewing(item))}
              onLongPress={() => setSheeting(item)}
              delayLongPress={250}
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

      {previewing && <FilePreview entry={previewing} onClose={() => setPreviewing(null)} />}
      {sheeting && (
        <FileSheet entry={sheeting} actions={actions} onClose={() => setSheeting(null)} />
      )}

      <Toast message={actions.message} onDismiss={actions.dismiss} />
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
  spacer: { flex: 1 },
  sorts: { flexDirection: 'row', gap: 16, paddingVertical: 8 },
  newFolder: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 44 },
  grow: { flex: 1 },
})
