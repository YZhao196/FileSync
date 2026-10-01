/**
 * Mobile's half of the backend selection — the counterpart of the desktop's
 * `client.ts`, which cannot be shared because it selects its backend with
 * `import.meta.env.DEV`, a Vite construct Metro cannot even parse.
 *
 * Everything that *can* be shared is: the ports, `deriveConnection` and the
 * probe itself come from `./connection`, a byte-identical copy of the desktop's
 * file. What differs, and why:
 *
 *   - **The mock is selected with `__DEV__`**, React Native's equivalent of
 *     `import.meta.env.DEV`. It is a compile-time constant, so the production
 *     bundle drops the branch and the mock with it.
 *   - **There is no agent.** UI-MOBILE.md has no server-status screen, so this
 *     probes photos and files only. The shared `describeConnection` is
 *     therefore not used: it is written for three endpoints and names the agent
 *     in its wording, and reusing it would have the phone talk about a service
 *     it never contacts.
 */

import type { Backends } from './backends'
import { deriveConnection, probe } from './connection'
import { createMockBackends } from './mock'
import { basicAuth, createLiveBackends } from './remote'
import type { Connection, ConnectionState, Credentials, ProbeResult, TestResult } from './types'

export { DEFAULT_PORTS, EMPTY_CREDENTIALS, deriveConnection } from './connection'

/**
 * True in a development build, false in any shipped one.
 *
 * `__DEV__` is substituted at build time, which is what lets the minifier drop
 * `createMockBackends` and its sample data from a release bundle — the same
 * guarantee the desktop gets from `import.meta.env.DEV`, and the reason this is
 * written inline below rather than through this constant.
 */
export const USING_MOCK: boolean = __DEV__

export function createBackends(conn: Connection, creds: Credentials): Backends {
  return __DEV__ ? createMockBackends() : createLiveBackends(conn, creds)
}

/**
 * UI-MOBILE.md §1's validation table, as wording.
 *
 * Two endpoints, not three, so the shared version cannot be reused — see the
 * file header. The cases are the spec's, and they are specific on purpose: the
 * point of the screen is to say *which* half failed, because "can't reach your
 * server" when only Nextcloud is misconfigured sends someone looking in the
 * wrong place.
 */
export function describeMobileConnection(photos: ProbeResult, files: ProbeResult): string {
  const photosOk = photos === 'ok'
  const filesOk = files === 'ok'

  if (photosOk && filesOk) return 'Connected to photos and files.'
  if (photos === 'auth-failed' || files === 'auth-failed') {
    return 'Server found, but the credentials were rejected.'
  }
  if (photosOk && !filesOk) {
    return "Connected to photos, but couldn't reach your files — check the Nextcloud address."
  }
  if (filesOk && !photosOk) {
    return "Connected to files, but couldn't reach your photos — check the Immich address."
  }
  return "Couldn't reach your server. Is Tailscale connected on this device?"
}

export async function testConnection(
  conn: Connection,
  creds: Credentials,
): Promise<TestResult> {
  if (USING_MOCK) {
    await new Promise((r) => setTimeout(r, 300))
    return {
      photos: 'ok',
      files: 'ok',
      agent: 'skipped',
      overall: 'healthy',
      message: 'Development build — no server is being contacted.',
    }
  }

  const [photos, files] = await Promise.all([
    probe(conn.immichUrl && `${conn.immichUrl}/api/server/ping`, {
      headers: { 'x-api-key': creds.immichApiKey },
    }),
    probe(
      conn.nextcloudUrl &&
        `${conn.nextcloudUrl}/remote.php/dav/files/${encodeURIComponent(creds.nextcloudUser)}/`,
      {
        method: 'PROPFIND',
        headers: {
          authorization: basicAuth(creds.nextcloudUser, creds.nextcloudAppPassword),
          depth: '0',
        },
      },
    ),
  ])

  const overall: ConnectionState =
    photos === 'ok' && files === 'ok'
      ? 'healthy'
      : photos === 'auth-failed' || files === 'auth-failed'
        ? 'auth-failed'
        : 'unreachable'

  return {
    photos,
    files,
    // The agent is not a mobile concept; `skipped` is the honest value and it
    // keeps the shared `TestResult` shape intact.
    agent: 'skipped',
    overall,
    message: describeMobileConnection(photos, files),
  }
}
