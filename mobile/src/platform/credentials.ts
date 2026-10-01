/**
 * Credentials, in the OS keystore.
 *
 * The desktop counterpart is `app/src/native/bridge.ts`, which stores the same
 * values through a Rust keyring command. Mobile cannot use that — there is no
 * Tauri here — so this is `expo-secure-store`, which is the iOS Keychain and the
 * Android Keystore. Note that on Android "secure" means the value is encrypted
 * at rest and NOT that it survives a reinstall; a user who reinstalls signs in
 * again, which is the behaviour the spec's Sign out/Disconnect assumes anyway.
 *
 * The semantics are deliberately the desktop's: many small named entries rather
 * than one JSON blob, so clearing one credential does not rewrite the others,
 * and an empty value **deletes** rather than storing an empty string. A user who
 * blanks out an API key should end up with no key, not with a key that is ''.
 *
 * `agentToken` is not stored. UI-MOBILE.md has no server-status screen, so the
 * mobile client never talks to the host agent, and keeping a credential for a
 * service nothing calls would be a secret held for no reason. The shared
 * `Credentials` type still carries the field, so reads return it empty.
 */

import * as SecureStore from 'expo-secure-store'

import type { Credentials } from '../core/types'

/**
 * Named per credential, and namespaced so they are identifiable in a device's
 * keychain listing — the desktop's are `immichApiKey.filesynapse` and friends
 * for the same reason.
 */
const KEYS = {
  immichApiKey: 'filesynapse.immichApiKey',
  nextcloudUser: 'filesynapse.nextcloudUser',
  nextcloudAppPassword: 'filesynapse.nextcloudAppPassword',
} as const

type StoredField = keyof typeof KEYS

const STORED = Object.keys(KEYS) as StoredField[]

export async function loadCredentials(): Promise<Credentials> {
  const entries = await Promise.all(
    STORED.map(async (field) => [field, (await SecureStore.getItemAsync(KEYS[field])) ?? ''] as const),
  )

  return {
    // Never stored on mobile, and never sent anywhere — see the file header.
    agentToken: '',
    ...Object.fromEntries(entries),
  } as Credentials
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  await Promise.all(
    STORED.map(async (field) => {
      const value = creds[field]
      if (value) {
        await SecureStore.setItemAsync(KEYS[field], value)
      } else {
        await SecureStore.deleteItemAsync(KEYS[field])
      }
    }),
  )
}

/** Settings → Disconnect. Leaves nothing behind for the next person holding the device. */
export async function clearCredentials(): Promise<void> {
  await Promise.all(STORED.map((field) => SecureStore.deleteItemAsync(KEYS[field])))
}
