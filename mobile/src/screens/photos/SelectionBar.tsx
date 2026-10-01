/**
 * The multi-select action bar — UI-MOBILE.md §2.3.
 *
 * Sits at the bottom of the timeline while anything is selected, replacing the
 * tab bar's space with the actions that only make sense in that mode. The
 * count is in the label rather than a separate header so the two cannot
 * disagree about how many things are about to be deleted.
 */

import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'

import { Icon } from '../../components/Icon'
import type { PhotoId } from '../../core/types'
import { useTheme } from '../../theme/ThemeProvider'
import type { PhotoActions } from './usePhotoActions'

export function SelectionBar({
  ids,
  actions,
  onCancel,
  onAddToAlbum,
}: {
  ids: PhotoId[]
  actions: PhotoActions
  onCancel: () => void
  onAddToAlbum: () => void
}) {
  const theme = useTheme()
  const count = ids.length

  function confirmDelete() {
    Alert.alert(
      `Move ${count === 1 ? 'this photo' : `${count} photos`} to trash?`,
      'They go to the server’s trash and can be restored in Immich for the retention period.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move to trash',
          style: 'destructive',
          onPress: () => {
            void actions.remove(ids)
            onCancel()
          },
        },
      ],
    )
  }

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.color['layer-01'],
          borderTopColor: theme.color['border-subtle-00'],
          paddingBottom: theme.spacing['spacing-04'],
        },
      ]}
    >
      <Text
        style={[
          theme.text['text-label-01'],
          styles.count,
          { color: theme.color['text-primary'] },
        ]}
      >
        {count} selected
      </Text>

      {/* No bulk Download, matching the desktop's decision rather than
          forgetting it: several files means several save dialogs, one after
          another, which is worse than not offering it. The single-photo
          download in the viewer is the supported path. */}
      <View style={styles.actions}>
        <Action icon="external" label="Share" onPress={() => void actions.share(ids)} />
        <Action icon="folder" label="Album" onPress={onAddToAlbum} />
        <Action
          icon="star"
          label="Favourite"
          onPress={() => void actions.favouriteMany(ids)}
        />
        <Action icon="close" label="Cancel" onPress={onCancel} />
        <Action icon="alert" label="Delete" onPress={confirmDelete} destructive />
      </View>
    </View>
  )
}

function Action({
  icon,
  label,
  onPress,
  destructive,
}: {
  icon: 'external' | 'download' | 'folder' | 'close' | 'alert' | 'star'
  label: string
  onPress: () => void
  destructive?: boolean
}) {
  const theme = useTheme()
  const color = destructive ? theme.color['text-error'] : theme.color['text-primary']
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} style={styles.action}>
      <Icon name={icon} size={20} color={color} />
      <Text style={[theme.text['text-helper-text-01'], { color }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: 1, paddingTop: 12 },
  count: { paddingHorizontal: 16, paddingBottom: 8 },
  actions: { flexDirection: 'row', justifyContent: 'space-around' },
  action: { alignItems: 'center', gap: 4, minWidth: 56, minHeight: 44 },
})
