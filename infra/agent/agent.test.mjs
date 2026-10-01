#!/usr/bin/env node
/**
 * The agent's HTTP contract — the routes the desktop app depends on.
 *
 * Run with `node infra/agent/agent.test.mjs`. Same convention as the other
 * tests here: no runner, no dependencies, exit non-zero on failure. The agent
 * is spawned as a child on an ephemeral port rather than imported, because it
 * starts listening at module scope and a test that imports it would be testing
 * a second copy of it.
 *
 * This file exists because the route surface had no coverage, and two bugs were
 * living in it — both reachable from the app's main screen:
 *
 *   - `POST /api/backup` answered 500 on every host, because the detached runner
 *     called the promisified `execFile` and then `.unref()`ed the Promise.
 *   - The rejection that followed had no handler, so on a host without restic it
 *     became an unhandled rejection and **killed the agent**. The app lost the
 *     whole status panel, not just the backup.
 *
 * Both are asserted below, the second one directly: after a failed backup the
 * agent must still answer.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AGENT = join(dirname(fileURLToPath(import.meta.url)), 'agent.mjs')
const TOKEN = 'test-token-for-the-contract-test'

const failures = []
let checks = 0

function check(name, condition, detail = '') {
  checks += 1
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
    failures.push(name)
  }
}

/** A port nothing is listening on. Bound and released, which is the only
 *  portable way to ask the OS — and port 8787 in particular is often taken. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function waitForHealth(port, child, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`agent exited early (${child.exitCode})`)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error('agent did not become healthy in time')
}

function startAgent(port, env) {
  const child = spawn(process.execPath, [AGENT], {
    env: { ...process.env, AGENT_PORT: String(port), AGENT_TOKEN: TOKEN, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.resume()
  child.stderr.resume()
  return child
}

const get = (port, path, token = TOKEN) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })

const post = (port, path) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}` },
  })

/** The status object must satisfy `ServerStatus` in app/src/core/types.ts. */
function assertStatusShape(body) {
  const isStr = (v) => typeof v === 'string'
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
  const isBool = (v) => typeof v === 'boolean'

  check('status.reachable is a boolean', isBool(body.reachable))
  check(
    'status.services is [{name, state}]',
    Array.isArray(body.services) &&
      body.services.every((s) => isStr(s.name) && ['running', 'stopped', 'starting'].includes(s.state)),
    JSON.stringify(body.services?.[0]),
  )
  check(
    'status.drives is [{label, usedBytes, totalBytes}]',
    Array.isArray(body.drives) &&
      body.drives.every((d) => isStr(d.label) && isNum(d.usedBytes) && isNum(d.totalBytes)),
  )
  const b = body.backup ?? {}
  check(
    'status.backup has every field',
    Object.hasOwn(b, 'lastRunAt') &&
      isBool(b.lastRunOk) &&
      isStr(b.nextRunAt) &&
      isNum(b.snapshotCount) &&
      isNum(b.cloudTotalBytes),
  )
  const n = body.network ?? {}
  check('status.network has every field', isBool(n.tailscaleConnected) && isStr(n.deviceName) && isStr(n.tailscaleIp))
  check('status.uptimeSeconds is a number', isNum(body.uptimeSeconds))
  check('status.lastBootAt is a string', isStr(body.lastBootAt))
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'filesynapse-agent-test-'))
  const verdictFile = join(dir, 'last-backup')
  const port = await freePort()

  // Point the wrapper at a path that does not exist, so the direct-restic path
  // is the one exercised. `node` itself stands in as a spawnable executable.
  const child = startAgent(port, {
    AGENT_BACKUP_STATUS: verdictFile,
    AGENT_BACKUP_WRAPPER: join(dir, 'no-such-wrapper'),
  })

  try {
    await waitForHealth(port, child)

    console.log('\nauth boundary')
    const health = await fetch(`http://127.0.0.1:${port}/health`)
    check('/health is 200 and ok', health.status === 200 && (await health.json()).ok === true)
    check('/api/status with no token is 401', (await get(port, '/api/status', null)).status === 401)
    check('/api/status with a wrong token is 401', (await get(port, '/api/status', 'wrong')).status === 401)

    console.log('\nthe status contract')
    const statusRes = await get(port, '/api/status')
    check('/api/status with the token is 200', statusRes.status === 200)
    assertStatusShape(await statusRes.json())

    console.log('\nthe verdict file')
    // Absent: the inference applies, and there is nothing to infer from here.
    let body = await (await get(port, '/api/status')).json()
    check('no verdict file means lastRunOk is false', body.backup.lastRunOk === false)

    await writeFile(verdictFile, 'ok 2026-09-30T21:30:00+10:00\n')
    body = await (await get(port, '/api/status')).json()
    check('an ok verdict is believed', body.backup.lastRunOk === true)
    check(
      'and its timestamp becomes lastRunAt',
      body.backup.lastRunAt === '2026-09-30T11:30:00.000Z',
      body.backup.lastRunAt,
    )

    await writeFile(verdictFile, 'failed 2026-09-30T21:45:00+10:00\n')
    body = await (await get(port, '/api/status')).json()
    check('a failed verdict is believed', body.backup.lastRunOk === false)

    await writeFile(verdictFile, 'garbage\n')
    body = await (await get(port, '/api/status')).json()
    check('a garbled verdict is ignored rather than trusted', body.backup.lastRunOk === false)

    console.log('\nbackup, with neither restic nor a wrapper available')
    const backup = await post(port, '/api/backup')
    check('answers 503 rather than claiming to have started', backup.status === 503, `got ${backup.status}`)
    // The regression that mattered: this used to take the whole agent down.
    const after = await get(port, '/api/status')
    check('the agent is still alive afterwards', after.status === 200, `got ${after.status}`)

    console.log('\nbackup, with a wrapper present')
    const port2 = await freePort()
    const withWrapper = startAgent(port2, {
      AGENT_BACKUP_STATUS: verdictFile,
      // A real executable, so spawn succeeds on every platform. What is under
      // test is that the wrapper is preferred and reported as such — not what it
      // does, which is the provisioning script's job and its own test.
      AGENT_BACKUP_WRAPPER: process.execPath,
    })
    try {
      await waitForHealth(port2, withWrapper)
      const res = await post(port2, '/api/backup')
      check('answers 202 when the wrapper is present', res.status === 202, `got ${res.status}`)
      const payload = await res.json()
      check(
        'and reports that the databases are included',
        payload.includesDatabases === true,
        JSON.stringify(payload),
      )
    } finally {
      withWrapper.kill()
    }
  } finally {
    child.kill()
    await rm(dir, { recursive: true, force: true })
  }

  console.log(`\n${checks - failures.length}/${checks} checks passed`)
  if (failures.length) {
    console.log(`failed: ${failures.join(', ')}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
