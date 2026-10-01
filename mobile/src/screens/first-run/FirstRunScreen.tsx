/**
 * First Run: connect to the server — UI-MOBILE.md §1.
 *
 * Not skippable, per the spec: there is nothing to show without a server. That
 * is also structurally true here rather than enforced with a flag — the root
 * navigator renders this screen precisely when there is no address, so there is
 * no state in which a tab bar exists without one.
 *
 * The validation is the spec's table, and each row is reported as itself
 * rather than collapsed into "couldn't connect". A phone that can reach Immich
 * but not Nextcloud has a Nextcloud problem, and saying "can't reach your
 * server" sends the reader to the wrong device.
 *
 * QR pairing is §1's "Later" and is not here. Neither is the Advanced section
 * for split Immich/Nextcloud addresses — `deriveConnection` currently derives
 * all three endpoints from one host, so offering the fields would promise
 * something the connection model cannot yet express.
 */

import { useState, type ComponentProps } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { Icon } from '../../components/Icon'
import { deriveConnection, EMPTY_CREDENTIALS, testConnection } from '../../core/client'
import type { Credentials, TestResult } from '../../core/types'
import { useSession } from '../../state/session'
import { useTheme } from '../../theme/ThemeProvider'

export function FirstRunScreen() {
  const theme = useTheme()
  const { connect, setCredentials } = useSession()

  const [address, setAddress] = useState('')
  const [creds, setCreds] = useState<Credentials>(EMPTY_CREDENTIALS)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const canTest = address.trim() !== '' && !testing
  const canContinue = result !== null && result.overall !== 'unreachable'

  async function runTest() {
    setTesting(true)
    setResult(null)
    try {
      // Credentials are saved before the probe so the probe uses the ones on
      // screen rather than the ones that happened to be stored.
      await setCredentials(creds)
      setResult(await testConnection(deriveConnection(address), creds))
    } finally {
      setTesting(false)
    }
  }

  async function finish() {
    await setCredentials(creds)
    await connect(address.trim())
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.color.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[theme.text['text-heading-04'], { color: theme.color['text-primary'] }]}>
          Connect to your server
        </Text>

        <Field
          label="Server address"
          value={address}
          onChangeText={setAddress}
          placeholder="filesynapse"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={[theme.text['text-helper-text-01'], { color: theme.color['text-helper'] }]}>
          Your server must be reachable over Tailscale.
        </Text>

        <Field
          label="Immich API key"
          value={creds.immichApiKey}
          onChangeText={(v) => setCreds((c) => ({ ...c, immichApiKey: v }))}
          placeholder="Account Settings → API Keys"
          secureTextEntry
        />
        <Field
          label="Nextcloud username"
          value={creds.nextcloudUser}
          onChangeText={(v) => setCreds((c) => ({ ...c, nextcloudUser: v }))}
          autoCapitalize="none"
        />
        <Field
          label="Nextcloud app password"
          value={creds.nextcloudAppPassword}
          onChangeText={(v) => setCreds((c) => ({ ...c, nextcloudAppPassword: v }))}
          placeholder="Personal settings → Security"
          secureTextEntry
        />

        {result && (
          <View style={styles.result}>
            <Icon
              name={result.overall === 'healthy' ? 'check' : 'alert'}
              size={16}
              variant="filled"
              color={
                result.overall === 'healthy'
                  ? theme.color['support-success']
                  : theme.color['support-error']
              }
            />
            <Text
              style={[
                theme.text['text-body-compact-01'],
                styles.grow,
                { color: theme.color['text-primary'] },
              ]}
            >
              {result.message}
            </Text>
          </View>
        )}

        <Button
          label={testing ? 'Testing…' : 'Test connection'}
          onPress={() => void runTest()}
          disabled={!canTest}
          busy={testing}
        />
        <Button
          label="Continue"
          primary
          onPress={() => void finish()}
          disabled={!canContinue}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Field({
  label,
  ...input
}: { label: string } & ComponentProps<typeof TextInput>) {
  const theme = useTheme()
  return (
    <View style={styles.field}>
      <Text style={[theme.text['text-label-01'], { color: theme.color['text-secondary'] }]}>
        {label}
      </Text>
      <TextInput
        {...input}
        placeholderTextColor={theme.color['text-placeholder']}
        style={[
          theme.text['text-body-compact-01'],
          styles.input,
          {
            color: theme.color['text-primary'],
            backgroundColor: theme.color['field-01'],
            borderBottomColor: theme.color['border-strong-01'],
            borderRadius: theme.radius.small,
          },
        ]}
      />
    </View>
  )
}

function Button({
  label,
  onPress,
  primary,
  disabled,
  busy,
}: {
  label: string
  onPress: () => void
  primary?: boolean
  disabled?: boolean
  busy?: boolean
}) {
  const theme = useTheme()
  const background = disabled
    ? theme.color['button-disabled']
    : primary
      ? theme.color['button-primary']
      : theme.color['button-secondary']

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, { backgroundColor: background, borderRadius: theme.radius.small }]}
    >
      {busy && <ActivityIndicator size="small" color={theme.color['text-on-color']} />}
      <Text
        style={[
          theme.text['text-body-compact-01'],
          { color: disabled ? theme.color['text-disabled'] : theme.color['text-on-color'] },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 24, gap: 12 },
  field: { gap: 4 },
  input: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  result: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8 },
  grow: { flex: 1 },
  button: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
  },
})
