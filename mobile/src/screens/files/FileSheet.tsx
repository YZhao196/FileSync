/**
 * The long-press context sheet — UI-MOBILE.md §3.3.
 *
 * Download, Rename, Delete and Info. **Move is not here**, and that is a
 * deliberate omission rather than a gap: moving needs a folder picker that can
 * walk the tree, and Nextcloud's API makes a move a `MOVE` with an absolute
 * `Destination` — the same call the shared client already exposes as `move`,
 * with the destination coming from a picker that does not exist yet. Shipping a
 * Move that could not choose a destination would be worse than not offering it.
 *
 * Rename writes a new name in the same directory, which the shared client
 * documents as a move within one collection. The path arithmetic lives in the
 * shared `paths.ts` so a rename means the same thing on both clients.
 */

import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { Icon } from '../../components/Icon'
import type { FileEntry } from '../../core/types'
import { useTheme } from '../../theme/ThemeProvider'
import type { FileActions } from './useFileActions'

export function FileSheet({
  entry,
  actions,
  onClose,
}: {
  entry: FileEntry
  actions: FileActions
  onClose: () => void
}) {
  const theme = useTheme()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(entry.name)

  function commitRename() {
    const next = name.trim()
    if (next && next !== entry.name) {
      void actions.rename(entry, next)
    }
    onClose()
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.color['layer-01'],
            borderTopLeftRadius: theme.radius.large,
            borderTopRightRadius: theme.radius.large,
            paddingBottom: theme.spacing['spacing-06'],
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            theme.text['text-label-01'],
            { color: theme.color['text-secondary'], padding: theme.spacing['spacing-04'] },
          ]}
        >
          {/* The folder is not shown — the breadcrumb already said where you
              are, and repeating the full path here wraps on a phone. */}
          {entry.name}
        </Text>

        {renaming ? (
          <View style={{ paddingHorizontal: theme.spacing['spacing-04'], gap: 12 }}>
            <TextInput
              value={name}
              onChangeText={setName}
              autoFocus
              selectTextOnFocus
              onSubmitEditing={commitRename}
              style={[
                theme.text['text-body-compact-01'],
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
            <Pressable onPress={commitRename} style={styles.action}>
              <Text
                style={[theme.text['text-body-compact-01'], { color: theme.color['link-primary'] }]}
              >
                Rename
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            {!entry.isFolder && (
              <Row
                icon="download"
                label="Download"
                onPress={() => {
                  void actions.download(entry)
                  onClose()
                }}
              />
            )}
            <Row icon="file-text" label="Rename" onPress={() => setRenaming(true)} />
            <Row
              icon="alert"
              label="Delete"
              destructive
              onPress={() => {
                actions.confirmDelete(entry)
                onClose()
              }}
            />
            <Row
              icon="search"
              label={infoLine(entry)}
              onPress={() => undefined}
              // Info is a label rather than an action: the sheet has nowhere to
              // put a sub-panel, and the line fits.
              muted
            />
          </>
        )}
      </View>
    </Modal>
  )
}

/** What §3.3's Info action would show, in the space available. */
function infoLine(entry: FileEntry): string {
  const parts = [entry.isFolder ? 'Folder' : entry.typeLabel, entry.sizeLabel, entry.modifiedLabel]
  return parts.filter(Boolean).join(' · ')
}

function Row({
  icon,
  label,
  onPress,
  destructive,
  muted,
}: {
  icon: 'download' | 'file-text' | 'alert' | 'search'
  label: string
  onPress: () => void
  destructive?: boolean
  muted?: boolean
}) {
  const theme = useTheme()
  const color = destructive
    ? theme.color['text-error']
    : muted
      ? theme.color['text-secondary']
      : theme.color['text-primary']

  return (
    <Pressable
      onPress={onPress}
      disabled={muted}
      style={[styles.action, { paddingHorizontal: theme.spacing['spacing-04'] }]}
    >
      <Icon name={icon} size={20} color={color} />
      <Text numberOfLines={1} style={[theme.text['text-body-compact-01'], styles.grow, { color }]}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { paddingTop: 4 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  grow: { flex: 1 },
})
