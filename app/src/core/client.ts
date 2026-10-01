/**
 * Chooses the backend implementation and runs the connection test the First Run
 * screen depends on.
 *
 * The test reports *which* part failed rather than a generic error — a typo in
 * one URL should not read as "the server is down" (UI-MOBILE.md §1).
 *
 * The parts that are not desktop-specific — the ports, `deriveConnection`, and
 * the wording of a failed probe — live in `./connection.ts`, which the mobile
 * client shares. What is left here is the half that genuinely differs: how a
 * build knows it is a development build, and which backends that selects. They
 * are re-exported below so this file remains the single import for callers.
 */

import type { Backends } from './backends'
import { describeConnection, probe } from './connection'
import { createMockBackends } from './mock'
import { basicAuth, createLiveBackends } from './remote'
import type { Connection, ConnectionState, Credentials, TestResult } from './types'

export {
  DEFAULT_PORTS,
  EMPTY_CREDENTIALS,
  deriveConnection,
  describeConnection,
} from './connection'

/**
 * Development builds talk to a mock backend so the app can be worked on with no
 * server anywhere. A shipped build never does: `import.meta.env.DEV` is
 * statically false, so this is `false`, the branch is dead code, and there is no
 * path by which a user sees fabricated data.
 *
 * The mock is a test double. It is not a product feature and is not reachable
 * from the app the installer produces.
 */
export const USING_MOCK: boolean = import.meta.env.DEV

export function createBackends(conn: Connection, creds: Credentials): Backends {
  // `import.meta.env.DEV` is written inline rather than through the exported
  // constant above: Vite substitutes it with the literal `false`, which lets
  // Rollup drop this branch — and, with it, the whole mock module — from a
  // production build. Behind an exported binding the branch survives and the
  // mock's sample data ships inside the installer.
  return import.meta.env.DEV ? createMockBackends() : createLiveBackends(conn, creds)
}

export async function testConnection(
  conn: Connection,
  creds: Credentials,
): Promise<TestResult> {
  if (USING_MOCK) {
    // Nothing to reach in a development build; report healthy so the flow can
    // still be walked end to end.
    await new Promise((r) => setTimeout(r, 300))
    return {
      photos: 'ok',
      files: 'ok',
      agent: 'ok',
      overall: 'healthy',
      message: 'Development build — no server is being contacted.',
    }
  }

  const [photos, files, agent] = await Promise.all([
    probe(conn.immichUrl && `${conn.immichUrl}/api/server/ping`, {
      headers: { 'x-api-key': creds.immichApiKey },
    }),
    probe(conn.nextcloudUrl && `${conn.nextcloudUrl}/remote.php/dav/files/${encodeURIComponent(creds.nextcloudUser)}/`, {
      method: 'PROPFIND',
      headers: {
        // Through `basicAuth`, not `btoa`: a username or password with any
        // non-Latin1 character made the raw call throw, so the connection test
        // failed on a character instead of reporting what it found.
        authorization: basicAuth(creds.nextcloudUser, creds.nextcloudAppPassword),
        depth: '0',
      },
    }),
    probe(conn.agentUrl && `${conn.agentUrl}/api/status`, {
      headers: { authorization: `Bearer ${creds.agentToken}` },
    }),
  ])

  const results = [photos, files, agent]
  const overall: ConnectionState = results.every((r) => r === 'ok')
    ? 'healthy'
    : results.some((r) => r === 'auth-failed')
      ? 'auth-failed'
      : results.every((r) => r === 'unreachable')
        ? 'unreachable'
        : 'unreachable'

  return {
    photos,
    files,
    agent,
    overall,
    message: describeConnection(photos, files, agent, overall),
  }
}
