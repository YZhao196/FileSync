/**
 * Previewing a file — UI-MOBILE.md §3.2.
 *
 * Images, plain text and code render inline. Everything else says so and offers
 * Download, which is the spec's rule: "No preview — download to open" beats a
 * broken frame, and PDF and video need renderers this does not yet carry.
 *
 * The spec adds that previews are "generated server-side by Nextcloud. The
 * phone never decodes a file to display it." That is true of thumbnails and not
 * of this: Nextcloud's preview endpoint returns rendered images, but it needs
 * the same authenticated request as everything else, and this fetches the
 * original instead because it is the call the client already has. A large image
 * is therefore downloaded in full to show a preview of it. Correct, wasteful,
 * and the thing to fix when the thumbnail cache arrives.
 *
 * UNVERIFIED: rendering a `data:` URI that carries a text/plain payload. Some
 * platforms refuse data URIs for anything but images. The text path below keeps
 * the string and renders it in a `<Text>`, which sidesteps that entirely.
 */

import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { Icon } from '../../components/Icon'
import type { FileEntry } from '../../core/types'
import { blobToDataUri } from '../../platform/blob'
import { useSession } from '../../state/session'
import { useTheme } from '../../theme/ThemeProvider'

type Loaded =
  | { kind: 'loading' }
  | { kind: 'image'; uri: string }
  | { kind: 'text'; body: string }
  | { kind: 'none'; reason: string }
  | { kind: 'error'; message: string }

export function FilePreview({ entry, onClose }: { entry: FileEntry; onClose: () => void }) {
  const theme = useTheme()
  const { backends } = useSession()
  const [state, setState] = useState<Loaded>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function load() {
      const mime = entry.mime ?? ''
      const isImage = mime.startsWith('image/')
      const isText = mime.startsWith('text/') || mime === 'application/json'

      if (!isImage && !isText) {
        setState({
          kind: 'none',
          reason: `No preview for ${entry.typeLabel || 'this file'} — download it to open.`,
        })
        return
      }

      try {
        const blob = await backends.files.download(entry.path)
        if (cancelled) return

        if (isImage) {
          const uri = await blobToDataUri(blob)
          if (!cancelled) setState(uri ? { kind: 'image', uri } : { kind: 'error', message: 'Empty file.' })
          return
        }

        const body = await blob.text()
        if (!cancelled) setState({ kind: 'text', body })
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Could not load this file.',
          })
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [backends, entry])

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.flex, { backgroundColor: theme.color['background-inverse'] }]}>
        <View style={[styles.header, { paddingTop: theme.spacing['spacing-06'] }]}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close preview">
            <Icon name="close" size={20} color={theme.color['text-inverse']} />
          </Pressable>
          <Text
            numberOfLines={1}
            style={[
              theme.text['text-body-compact-01'],
              styles.grow,
              { color: theme.color['text-inverse'] },
            ]}
          >
            {entry.name}
          </Text>
        </View>

        {state.kind === 'loading' && (
          <View style={styles.centred}>
            <ActivityIndicator color={theme.color['text-inverse']} />
          </View>
        )}

        {(state.kind === 'none' || state.kind === 'error') && (
          <View style={styles.centred}>
            <Text
              style={[
                theme.text['text-body-01'],
                { color: theme.color['text-inverse'], textAlign: 'center', padding: 32 },
              ]}
            >
              {state.kind === 'none' ? state.reason : state.message}
            </Text>
          </View>
        )}

        {state.kind === 'text' && (
          <ScrollView contentContainerStyle={{ padding: theme.spacing['spacing-04'] }}>
            <Text
              selectable
              style={[
                theme.text['text-code-02'],
                { color: theme.color['text-inverse'] },
              ]}
            >
              {state.body}
            </Text>
          </ScrollView>
        )}

        {state.kind === 'image' && (
          // `contain` rather than `cover`: a preview that crops is not a
          // preview of the file, it is a preview of part of it.
          <Image source={{ uri: state.uri }} resizeMode="contain" style={styles.image} />
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  grow: { flex: 1 },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { flex: 1 },
})
