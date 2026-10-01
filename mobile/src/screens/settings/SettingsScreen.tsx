/**
 * Settings — UI-MOBILE.md §4.
 *
 * All four sections. Server and Account are real; Storage & cache reports the
 * cache directory and empties it; Appearance is the System/Light/Dark picker,
 * persisted; About shows the version.
 *
 * **Licences is a line rather than a screen.** §4 lists "open-source licences"
 * under About, and the honest version is that the app bundles Carbon icons
 * (Apache-2.0), IBM Plex (OFL) and React Native's own tree — the last of which
 * is large enough that the right thing is a generated attribution file, not a
 * hand-written list that is wrong by the second dependency. Saying so is better
 * than a screen that lists three of two hundred packages.
 */

import Constants from 'expo-constants'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { cacheBytes, clearCache } from '../../platform/cache'
import { usePreferences } from '../../state/preferences'
import { useSession } from '../../state/session'
import type { ThemePreference } from '../../theme/ThemeProvider'
import { useTheme } from '../../theme/ThemeProvider'

const THEMES: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function SettingsScreen() {
  const theme = useTheme()
  const { connection, credentials, disconnect } = useSession()
  const { theme: preference, setTheme } = usePreferences()

  const [bytes, setBytes] = useState<number | null | 'loading'>('loading')

  const measure = useCallback(() => {
    setBytes('loading')
    void cacheBytes().then(setBytes)
  }, [])

  useEffect(measure, [measure])

  function confirmDisconnect() {
    Alert.alert(
      'Disconnect?',
      'The server address and every stored credential will be removed from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => void disconnect() },
      ],
    )
  }

  function confirmClearCache() {
    Alert.alert('Clear the cache?', 'Thumbnails and downloads are removed. Nothing is lost — they re-download.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => void clearCache().then(measure),
      },
    ])
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.color.background }}
      contentContainerStyle={styles.content}
    >
      <Section title="Server">
        <Row label="Address" value={connection.address || 'Not connected'} />
        <Row label="Photos" value={connection.immichUrl ?? '—'} />
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

      <Section title="Storage & cache">
        <Row
          label="Cache"
          value={
            bytes === 'loading'
              ? 'Measuring…'
              : bytes === null
                ? 'Unavailable'
                : formatBytes(bytes)
          }
        />
        <Pressable
          onPress={confirmClearCache}
          style={[styles.action, { paddingHorizontal: theme.spacing['spacing-04'] }]}
        >
          <Text style={[theme.text['text-body-compact-01'], { color: theme.color['link-primary'] }]}>
            Clear cache
          </Text>
        </Pressable>
      </Section>

      <Section title="Appearance">
        <View style={[styles.themes, { padding: theme.spacing['spacing-03'] }]}>
          {THEMES.map((option) => {
            const active = option.value === preference
            return (
              <Pressable
                key={option.value}
                onPress={() => void setTheme(option.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.theme,
                  {
                    backgroundColor: active
                      ? theme.color['background-selected']
                      : theme.color['layer-02'],
                    borderColor: active
                      ? theme.color['border-interactive']
                      : theme.color['border-subtle-01'],
                    borderRadius: theme.radius.small,
                  },
                ]}
              >
                <Text
                  style={[
                    theme.text['text-body-compact-01'],
                    { color: active ? theme.color['text-primary'] : theme.color['text-secondary'] },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </Section>

      <Section title="About">
        <Row label="Version" value={Constants.expoConfig?.version ?? 'unknown'} />
        <Plain>
          Carbon icons (Apache-2.0) and IBM Plex (OFL) are bundled. The full
          attribution list belongs in a generated file rather than here — it is
          every package in the tree, not the three worth naming.
        </Plain>
      </Section>

      <Pressable
        onPress={confirmDisconnect}
        style={[styles.danger, { borderRadius: theme.radius.small }]}
      >
        <Text style={[theme.text['text-body-compact-01'], { color: theme.color['text-error'] }]}>
          Disconnect
        </Text>
      </Pressable>
    </ScrollView>
  )
}

/** Megabytes and up; kilobytes would be noise on a thumbnail cache. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
        style={[
          theme.text['text-body-compact-01'],
          styles.grow,
          { color: theme.color['text-primary'] },
        ]}
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

function Plain({ children }: { children: ReactNode }) {
  const theme = useTheme()
  return (
    <Text
      style={[
        theme.text['text-helper-text-01'],
        { color: theme.color['text-secondary'], padding: theme.spacing['spacing-04'] },
      ]}
    >
      {children}
    </Text>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 24 },
  section: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, minHeight: 44 },
  grow: { flex: 1 },
  action: { justifyContent: 'center', minHeight: 44 },
  themes: { flexDirection: 'row', gap: 8 },
  theme: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  danger: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
})
