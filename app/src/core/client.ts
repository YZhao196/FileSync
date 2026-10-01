/**
 * Chooses the backend implementation and runs the connection test the First Run
 * screen depends on.
 *
 * The test reports *which* part failed rather than a generic error — a typo in
 * one URL should not read as "the server is down" (UI-MOBILE.md §1).
 */

import { nativeFetch } from '../native/bridge'
import type { Backends } from './backends'
import { createMockBackends } from './mock'
import { basicAuth, createLiveBackends } from './remote'
import type {
  Connection,
  ConnectionState,
  Credentials,
  ProbeResult,
  TestResult,
} from './types'

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

export const DEFAULT_PORTS = {
  immich: 2283,
  nextcloud: 8080,
  agent: 8787,
} as const

export const EMPTY_CREDENTIALS: Credentials = {
  immichApiKey: '',
  nextcloudUser: '',
  nextcloudAppPassword: '',
  agentToken: '',
}

/**
 * One address in, three endpoints out. Ports match PLAN.md §6/§11 — everything
 * rides Tailscale, so plain http on the tailnet is expected.
 */
export function deriveConnection(address: string): Connection {
  const empty: Connection = {
    address: '',
    immichUrl: null,
    nextcloudUrl: null,
    agentUrl: null,
  }

  const trimmed = address.trim()
  if (!trimmed) return empty

  // The scheme must be decided before any trailing-slash cleanup: "http://"
  // stripped to "http:" no longer reads as a scheme and would get prefixed,
  // yielding a nonsense host.
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return empty
  }
  if (!url.hostname) return empty

  const proto = url.protocol === 'https:' ? 'https' : 'http'
  return {
    address: trimmed.replace(/\/+$/, ''),
    immichUrl: `${proto}://${url.hostname}:${DEFAULT_PORTS.immich}`,
    nextcloudUrl: `${proto}://${url.hostname}:${DEFAULT_PORTS.nextcloud}`,
    agentUrl: `${proto}://${url.hostname}:${DEFAULT_PORTS.agent}`,
  }
}

export function createBackends(conn: Connection, creds: Credentials): Backends {
  // `import.meta.env.DEV` is written inline rather than through the exported
  // constant above: Vite substitutes it with the literal `false`, which lets
  // Rollup drop this branch — and, with it, the whole mock module — from a
  // production build. Behind an exported binding the branch survives and the
  // mock's sample data ships inside the installer.
  return import.meta.env.DEV ? createMockBackends() : createLiveBackends(conn, creds)
}

/* ── Connection test ───────────────────────────────────────────────────── */

async function probe(url: string | null, init: RequestInit): Promise<ProbeResult> {
  if (!url) return 'skipped'
  try {
    const res = await nativeFetch(url, {
      method: (init.method as string | undefined) ?? 'GET',
      headers: init.headers as Record<string, string> | undefined,
      body: init.body as string | undefined,
    })
    if (res.status === 401 || res.status === 403) return 'auth-failed'
    return res.ok || res.status === 207 ? 'ok' : 'unreachable'
  } catch {
    return 'unreachable'
  }
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

/** Exported for testing — the wording here is the whole point of the probe. */
export function describeConnection(
  photos: ProbeResult,
  files: ProbeResult,
  agent: ProbeResult,
  overall: ConnectionState,
): string {
  if (overall === 'healthy') return 'Connected to photos, files and the server agent.'

  const broken: string[] = []
  if (photos !== 'ok') broken.push(`photos (${label(photos)})`)
  if (files !== 'ok') broken.push(`files (${label(files)})`)
  if (agent !== 'ok') broken.push(`server agent (${label(agent)})`)

  if (overall === 'auth-failed' && broken.length === 0) {
    return 'Server found, but the credentials were rejected.'
  }
  if (broken.length === 3) {
    return "Couldn't reach your server. Is Tailscale connected on this device?"
  }
  return `Reached some of your server. Not working: ${broken.join(', ')}.`
}

function label(p: ProbeResult): string {
  return p === 'auth-failed' ? 'credentials rejected' : 'unreachable'
}
