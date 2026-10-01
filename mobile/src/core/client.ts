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
 *     `import.meta.env.DEV` — but not an equivalent guarantee. See `USING_MOCK`
 *     below: Metro bundles the mock into a release build where Vite removes it.
 *     It is unreachable, not absent.
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
 * ## This is not the desktop's guarantee, and the difference is real
 *
 * The desktop selects its mock with `import.meta.env.DEV`, which Vite replaces
 * with the literal `false` — so Rollup drops the branch *and the mock module
 * with it*. A release installer contains no mock code at all. That was checked
 * against the built bundle rather than assumed.
 *
 * Metro does not do that. `expo export --platform android` was checked too, and
 * the production bundle **does** contain `createMockBackends` and the mock's
 * placeholder text; the `__DEV__` identifier survives into the bundle rather
 * than being folded to `false`, and Metro resolves static imports eagerly, so
 * there is no dead branch left for the minifier to remove.
 *
 * So on mobile the mock **ships but cannot run**: `__DEV__` is false in a
 * release bundle, so the branch below is never taken and no fabricated data can
 * reach a screen. The project's rule — "no path by which a user sees fabricated
 * data" — still holds. What does not hold is the stronger claim the desktop can
 * make, that the code is not there.
 *
 * The honest fix is a build-time transform that strips it, and it is worth
 * doing: the mock carries sample albums and photos that have no business in a
 * shipped app. It is recorded rather than attempted here because getting it
 * wrong is a build-config change that fails at packaging time, not at test
 * time. Until then, this comment says what is true instead of what was assumed.
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
