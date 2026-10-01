#!/usr/bin/env node
/**
 * FileSynapse host agent.
 *
 * The status panel needs things Immich and Nextcloud know nothing about: restic
 * state, disk usage, container health, tailnet state. This is the source for
 * them, and it is the whole reason the desktop app can be useful.
 *
 * Design rule: every collector degrades on its own. A missing `docker`, an
 * absent `restic`, a bare `/proc` — each returns a sane empty value rather than
 * taking the endpoint down. A status panel that says "unknown" is useful; one
 * that returns 500 is not. It also means the agent runs on a laptop for
 * development, which is how its contract gets tested.
 *
 * No dependencies. Serve it from the compose stack so the host needs nothing
 * installed.
 */

import { createServer } from 'node:http'
import { execFile, spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { hostname, uptime as osUptime } from 'node:os'
import { promisify } from 'node:util'
import { createCaptionStore } from './captionStore.mjs'
import { parseServices, resolveContainer } from './containers.mjs'
import { createDecisions } from './decisions.mjs'

const exec = promisify(execFile)

const PORT = Number(process.env.AGENT_PORT ?? 8787)
const TOKEN = process.env.AGENT_TOKEN ?? ''
const PHOTOS_PATH = process.env.AGENT_PHOTOS_PATH ?? '/srv/photos'
const CLOUD_PATH = process.env.AGENT_CLOUD_PATH ?? '/srv/cloud'
const RESTIC_REPO = process.env.RESTIC_REPOSITORY ?? ''
/** Which containers to report on. See containers.mjs for why `immich` is named. */
const SERVICES = parseServices(process.env.AGENT_SERVICES)
/**
 * Where the backup timer records its own verdict. Written by
 * `infra/provision/provision.sh`; absent on a hand-built server, in which case
 * the agent falls back to inferring success from snapshot age.
 */
const BACKUP_STATUS_PATH =
  process.env.AGENT_BACKUP_STATUS ?? '/var/lib/filesynapse/last-backup'
/**
 * The backup wrapper provisioning installs. It dumps both databases before it
 * snapshots anything, so a run started from the app uses it when it is present.
 * Overridable for the same reason everything else here is: so the two paths can
 * be exercised without a server.
 */
const BACKUP_WRAPPER =
  process.env.AGENT_BACKUP_WRAPPER ?? '/usr/local/bin/filesynapse-backup'

/** How old a snapshot may be before an inferred run reads as not current. */
const BACKUP_CURRENT_MS = 36 * 3600 * 1000

/**
 * The optional decision pipeline. Every one of these defaults to empty, and an
 * empty URL means the routes report "unavailable" without contacting anything —
 * the same shape as the collectors above, where a panel saying so beats a 500.
 *
 * It is deliberately not provisioned automatically: Immich's own ML container
 * already does semantic search, so this is an option the user opts into rather
 * than something an install brings with it.
 */
const OLLAMA_URL = (process.env.AGENT_OLLAMA_URL ?? '').replace(/\/+$/, '')
const LAYLA_URL = (process.env.AGENT_LAYLA_URL ?? '').replace(/\/+$/, '')
const IMMICH_URL = (process.env.AGENT_IMMICH_URL ?? '').replace(/\/+$/, '')
const IMMICH_API_KEY = process.env.AGENT_IMMICH_API_KEY ?? ''
const VISION_MODEL = process.env.AGENT_VISION_MODEL ?? 'moondream'
const DECISION_BATCH = Number(process.env.AGENT_DECISION_BATCH ?? 8) || 8
const CAPTION_PATH =
  process.env.AGENT_CAPTION_PATH ?? '/var/lib/filesynapse/decisions/captions.json'

const captions = createCaptionStore({
  path: CAPTION_PATH,
  model: VISION_MODEL,
  onWarn: (msg) => console.warn(`[agent] ${msg}`),
})

const decisions = createDecisions({
  ollamaUrl: OLLAMA_URL,
  laylaUrl: LAYLA_URL,
  immichUrl: IMMICH_URL,
  immichApiKey: IMMICH_API_KEY,
  model: VISION_MODEL,
  captions,
  batch: DECISION_BATCH,
})

/* ── shell ─────────────────────────────────────────────────────────────── */

async function run(cmd, args, timeout = 8000) {
  try {
    const { stdout } = await exec(cmd, args, {
      timeout,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    })
    return { ok: true, out: stdout }
  } catch (err) {
    return { ok: false, err: err?.message ?? String(err) }
  }
}

/** Display names, so the app shows "MariaDB" rather than a naive capitalisation. */
const DISPLAY_NAMES = {
  immich: 'Immich',
  nextcloud: 'Nextcloud',
  mariadb: 'MariaDB',
  postgres: 'PostgreSQL',
  redis: 'Redis',
}

const label = (slug) =>
  DISPLAY_NAMES[slug] ?? (slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : slug)

/* ── collectors ────────────────────────────────────────────────────────── */

async function dockerStates() {
  const r = await run('docker', ['ps', '--format', '{{.Names}}\t{{.State}}'])
  if (!r.ok) return null
  const map = new Map()
  for (const line of r.out.split('\n')) {
    const [name, state] = line.split('\t')
    if (name?.trim()) map.set(name.trim().toLowerCase(), (state ?? '').trim().toLowerCase())
  }
  return map
}

function normalizeState(raw) {
  if (raw === 'running') return 'running'
  if (raw === 'restarting' || raw === 'created' || raw === 'paused') return 'starting'
  return 'stopped'
}

async function collectServices() {
  const states = await dockerStates()
  return SERVICES.map((svc) => {
    const key = resolveContainer(states, svc)
    return { name: label(svc.slug), state: key ? normalizeState(states.get(key)) : 'stopped' }
  })
}

async function collectDrives() {
  const out = []
  for (const [label, path] of [
    ['Photos drive', PHOTOS_PATH],
    ['Cloud drive', CLOUD_PATH],
  ]) {
    let used = 0
    let total = 0
    const r = await run('df', ['-B1', '-P', path])
    if (r.ok) {
      const line = r.out.trim().split('\n').pop() ?? ''
      const parts = line.split(/\s+/)
      const t = Number(parts[1])
      const u = Number(parts[2])
      if (Number.isFinite(t) && Number.isFinite(u)) {
        total = t
        used = u
      }
    }
    out.push({ label, usedBytes: used, totalBytes: total })
  }
  return out
}

async function collectBackup() {
  const empty = {
    lastRunAt: null,
    lastRunOk: false,
    nextRunAt: nextNightly(null),
    snapshotCount: 0,
    cloudTotalBytes: 0,
  }

  const verdict = await readBackupVerdict()

  const r = await run('restic', ['snapshots', '--json'], 20000)
  if (!r.ok) {
    // No restic: the status file is still worth reporting, since it is the
    // record of the last attempt rather than of the repository.
    return verdict
      ? { ...empty, lastRunAt: verdict.at, lastRunOk: verdict.ok }
      : empty
  }

  let snaps
  try {
    const parsed = JSON.parse(r.out)
    // Newer restic wraps the list; older returns a bare array.
    snaps = Array.isArray(parsed) ? parsed : (parsed.snapshots ?? [])
  } catch {
    return empty
  }
  if (!snaps.length) {
    return verdict ? { ...empty, lastRunAt: verdict.at, lastRunOk: verdict.ok } : empty
  }

  const times = snaps
    .map((s) => new Date(s.time).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a)

  const last = times[0] ?? null
  let cloudTotalBytes = 0
  const stats = await run('restic', ['stats', '--json'], 20000)
  if (stats.ok) {
    try {
      cloudTotalBytes = Number(JSON.parse(stats.out).total_size) || 0
    } catch {
      /* leave at zero */
    }
  }

  return {
    // The status file is the authority when it exists: it records what the
    // timer actually did, including a run that failed after writing a
    // snapshot's worth of data. Otherwise fall back to the newest snapshot.
    lastRunAt: verdict ? verdict.at : last ? new Date(last).toISOString() : null,
    lastRunOk: verdict
      ? verdict.ok
      : last !== null && Date.now() - last < BACKUP_CURRENT_MS,
    nextRunAt: nextNightly(last),
    snapshotCount: snaps.length,
    cloudTotalBytes,
  }
}

/**
 * Reads the backup timer's own verdict, where one has been written.
 *
 * restic's repository keeps no exit status, so without this `lastRunOk` has to
 * be *inferred* from snapshot age — which reads a run that failed after writing
 * nothing as indistinguishable from one that never started. The provisioning
 * script's timer writes `ok <iso>` or `failed <iso>` here, which turns the
 * inference into a fact. Absent the file, nothing changes.
 */
async function readBackupVerdict() {
  try {
    const raw = await readFile(BACKUP_STATUS_PATH, 'utf8')
    const [word, iso] = raw.trim().split(/\s+/)
    if (word !== 'ok' && word !== 'failed') return null
    const at = new Date(iso)
    if (Number.isNaN(at.getTime())) return null
    return { ok: word === 'ok', at: at.toISOString() }
  } catch {
    // No file, or unreadable — the inference path still works.
    return null
  }
}

function nextNightly(lastMs) {
  const base = lastMs ? new Date(lastMs) : new Date()
  const next = new Date(base)
  next.setDate(next.getDate() + 1)
  return next.toISOString()
}

async function collectNetwork() {
  const fallback = { tailscaleConnected: false, deviceName: hostname(), tailscaleIp: '' }
  const r = await run('tailscale', ['status', '--json'])
  if (!r.ok) return fallback
  try {
    const s = JSON.parse(r.out)
    const self = s.Self ?? {}
    return {
      tailscaleConnected: s.BackendState === 'Running',
      deviceName: self.HostName ?? hostname(),
      tailscaleIp: (self.TailscaleIPs ?? [])[0] ?? '',
    }
  } catch {
    return fallback
  }
}

async function collectUptime() {
  let seconds = osUptime()
  try {
    const raw = await readFile('/proc/uptime', 'utf8')
    const parsed = Number(raw.split(' ')[0])
    if (Number.isFinite(parsed)) seconds = parsed
  } catch {
    /* not Linux, or no /proc — os.uptime() stands */
  }
  return {
    uptimeSeconds: Math.round(seconds),
    lastBootAt: new Date(Date.now() - seconds * 1000).toISOString(),
  }
}

async function collectStatus() {
  const [services, drives, backup, network, uptime] = await Promise.all([
    collectServices(),
    collectDrives(),
    collectBackup(),
    collectNetwork(),
    collectUptime(),
  ])
  return { reachable: true, services, drives, backup, network, ...uptime }
}

/* ── actions ───────────────────────────────────────────────────────────── */

/**
 * Starts a command and returns at once, leaving it running.
 *
 * `spawn`, not the promisified `execFile` the rest of this file uses. The
 * previous version called `exec` here and had two bugs, both of which the app
 * could reach from its main screen:
 *
 *   - `exec` returns a Promise, so the `.unref()` on the next line threw
 *     synchronously. The `catch` swallowed it and returned false, so "Back up
 *     now" failed on every host, whether or not restic was installed.
 *   - That rejected Promise had no handler. On a host without restic it was an
 *     unhandled rejection, which kills the process — so the whole agent died,
 *     not just the backup, and every later request failed.
 *
 * A missing binary arrives asynchronously as an `error` event, so a listener is
 * required even here, where the child is never awaited.
 */
function runDetached(cmd, args) {
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', (e) => console.error(`[agent] ${cmd} could not start: ${e.message}`))
    child.unref()
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e?.message ?? String(e) }
  }
}

/** Whether a path exists — used to prefer the backup wrapper when it is there. */
async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function restartService(name) {
  const slug = name.toLowerCase()
  // Resolved through the same table the status panel uses, so the button
  // restarts the container the tile is describing. Matching by substring here
  // alone is how "restart Immich" could have restarted immich-machine-learning.
  const configured = SERVICES.find((s) => s.slug === slug) ?? { slug, container: null }
  const states = await dockerStates()
  const key = resolveContainer(states, configured)
  if (!key) return { ok: false, reason: `no container matching "${name}"` }
  const r = await run('docker', ['restart', key], 60000)
  return r.ok ? { ok: true } : { ok: false, reason: r.err }
}

/* ── http ──────────────────────────────────────────────────────────────── */

/**
 * The agent had no request-body reader — every route before these was bodyless.
 * Bounded, because this listens on the tailnet and an unbounded read hands free
 * memory to whoever asks. An unparseable or oversized body resolves to `null`,
 * which the routes treat as "no ids" rather than as an error.
 */
function readJson(req, limitBytes = 64 * 1024) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limitBytes) {
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

/** Ids come from the client, so they are treated as untrusted input. */
function readIds(body) {
  if (!Array.isArray(body?.ids)) return []
  return body.ids.filter((id) => typeof id === 'string' && id).slice(0, 500)
}

function authorized(req) {
  if (!TOKEN) return true // no token configured: assume a trusted network
  const header = req.headers.authorization ?? ''
  return header === `Bearer ${TOKEN}`
}

function send(res, code, body) {
  const payload = JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (url.pathname === '/health') {
    return send(res, 200, { ok: true })
  }

  if (!authorized(req)) {
    return send(res, 401, { error: 'unauthorized' })
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return send(res, 200, await collectStatus())
    }

    if (req.method === 'POST' && url.pathname === '/api/backup') {
      // Prefer the wrapper that provisioning installs.
      //
      // It dumps Immich's PostgreSQL and Nextcloud's MariaDB before it snapshots
      // anything, and writes the verdict file the status panel reads. Invoking
      // restic directly — as this used to — backs up the two folders and neither
      // database, and still reports success. That is a backup which restores a
      // pile of files no application knows about, and it is worse than no backup
      // because it is trusted.
      //
      // The direct call remains for a server built by hand, where no wrapper
      // exists. It is the lesser of the two, and it says so in the log.
      const wrapper = BACKUP_WRAPPER
      const usingWrapper = await exists(wrapper)

      if (!usingWrapper) {
        // Checked before claiming to have started anything: a 202 for a command
        // that cannot run is a lie the app reports as "Backup finished".
        const probe = await run('restic', ['version'], 5000)
        if (!probe.ok) {
          return send(res, 503, { error: 'restic is not installed on this host' })
        }
        console.error(
          '[agent] no backup wrapper found — running restic directly, so the databases are NOT included',
        )
      }

      const started = usingWrapper
        ? runDetached(wrapper, [])
        : runDetached('restic', [
            '-r',
            RESTIC_REPO || 'b2:filesynapse-backup:/',
            'backup',
            PHOTOS_PATH,
            CLOUD_PATH,
            '--exclude-caches',
          ])

      return started.ok
        ? send(res, 202, { started: true, includesDatabases: usingWrapper })
        : send(res, 500, { error: started.reason ?? 'could not start the backup' })
    }

    const restart = url.pathname.match(/^\/api\/services\/([^/]+)\/restart$/)
    if (req.method === 'POST' && restart) {
      const result = await restartService(decodeURIComponent(restart[1]))
      return result.ok
        ? send(res, 202, { restarted: true })
        : send(res, 404, { error: result.reason })
    }

    /* The optional decision pipeline. Every failure it can model — a stopped
       model, one that was never pulled, an unreachable Immich — comes back as
       200 with `ok: false` and a reason, so the app can say something specific
       instead of showing a failure that reads as the server being broken. */
    if (req.method === 'GET' && url.pathname === '/api/decisions/status') {
      return send(res, 200, await decisions.status())
    }

    if (req.method === 'POST' && url.pathname === '/api/decisions/score') {
      return send(res, 200, await decisions.scoreIds(readIds(await readJson(req))))
    }

    if (req.method === 'POST' && url.pathname === '/api/decisions/albums') {
      const body = await readJson(req)
      const albums = Array.isArray(body?.albums)
        ? body.albums.filter((a) => typeof a === 'string' && a).slice(0, 200)
        : []
      return send(res, 200, await decisions.suggestAlbums(readIds(body), albums))
    }

    if (req.method === 'POST' && url.pathname === '/api/decisions/cache/clear') {
      return send(res, 200, { cleared: await decisions.clearCache() })
    }

    send(res, 404, { error: 'not found' })
  } catch (err) {
    send(res, 500, { error: err?.message ?? 'agent error' })
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[agent] listening on :${PORT}`)
  console.log(
    `[agent] photos=${PHOTOS_PATH} cloud=${CLOUD_PATH} ` +
      `services=${SERVICES.map((s) => (s.container ? `${s.slug}=${s.container}` : s.slug)).join(',')}`,
  )
  console.log(
    `[agent] decisions=${OLLAMA_URL ? VISION_MODEL : 'off'}@${OLLAMA_URL || '-'} ` +
      `layla=${LAYLA_URL || 'off'} captions=${CAPTION_PATH}`,
  )
  if (!TOKEN) console.warn('[agent] AGENT_TOKEN is unset — the API is unauthenticated')
})
