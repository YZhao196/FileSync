/**
 * Settings — UI-MOBILE.md §4.
 *
 * Server and Account are real: they show where this device is pointed and let
 * you forget it. Storage & cache, Appearance and About are not built yet, and
 * they are absent rather than listed as dead rows — a settings screen full of
 * controls that do nothing teaches the reader to distrust the ones that do.
 *
 * The theme is fixed to `system` here because the Appearance picker does not
 * exist yet; `ThemeProvider` already accepts a preference, so wiring it is a
 * change to this screen and nothing else.
 */

import Constants from 'expo-constants'
import type { ReactNode } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { useSession } from '../../state/session'
import { useTheme } from '../../theme/ThemeProvider'

export function SettingsScreen() {
  const theme = useTheme()
  const { connection, credentials, disconnect } = useSession()

  function confirmDisconnect() {
    Alert.alert(
      'Disconnect?',
      'The server address and every stored credential will be removed from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => void disconnect(),
        },
      ],
    )
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.color.background }}
      contentContainerStyle={styles.content}
    >
      <Section title="Server">
        <Row label="Address" value={connection.address || 'Not connected'} />
        <Row
          label="Photos"
          value={connection.immichUrl ?? '—'}
        />
        <Row label="Files" value={connection.nextcloudUrl ?? '—'} />
      </Section>

      <Section title="Account">
        <Row label="Nextcloud user" value={credentials.nextcloudUser || 'Not signed in'} />
        <Row
          label="Immich key"
          // Never the key itself. Even a truncated secret on screen is one
          // screenshot away from being somewhere it should not be.
          value={credentials.immichApiKey ? 'Stored' : 'Not set'}
        />
      </Section>

      <Section title="About">
        <Row label="Version" value={Constants.expoConfig?.version ?? 'unknown'} />
      </Section>

      <Pressable
        onPress={confirmDisconnect}
        style={[styles.danger, { borderRadius: theme.radius.small }]}
      >
        <Text
          style={[theme.text['text-body-compact-01'], { color: theme.color['text-error'] }]}
        >
          Disconnect
        </Text>
      </Pressable>
    </ScrollView>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme()
  return (
    <View style={styles.section}>
      <Text
        style={[
          theme.text['text-label-01'],
          { color: theme.color['text-secondary'], textTransform: 'uppercase' },
        ]}
      >
        {title}
      </Text>
      <View
        style={{
          backgroundColor: theme.color['layer-01'],
          borderRadius: theme.radius.medium,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </View>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  const theme = useTheme()
  return (
    <View style={[styles.row, { paddingHorizontal: theme.spacing['spacing-04'] }]}>
      <Text
        style={[theme.text['text-body-compact-01'], styles.grow, { color: theme.color['text-primary'] }]}
      >
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={[theme.text['text-body-compact-01'], { color: theme.color['text-secondary'] }]}
      >
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 24 },
  section: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, minHeight: 44 },
  grow: { flex: 1 },
  danger: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
})
