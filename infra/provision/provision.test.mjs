#!/usr/bin/env node
/**
 * Runs `provision.sh` against a sandbox and checks what it produced.
 *
 * This is the closest thing to executing the critical path that can happen
 * without a server. The script's absolute paths are rewritten into a scratch
 * root and every external command is stubbed, but the script itself runs for
 * real — its heredocs, its quoting, `set -e` behaviour, the `run` helper and
 * the step sequencing all execute. What it proves is that the *files* it writes
 * are right. What it cannot prove is that apt, docker or systemd do anything
 * with them, which is what the provisioning smoke test on a real machine is for.
 *
 * A dry run was done by hand once and its results written into the handover
 * notes. Being done by hand meant it could not be repeated, and it has been
 * stale since the first change after it. This is that run, committed.
 *
 * Same convention as the agent's tests: no runner, no dependencies, exit
 * non-zero on failure.
 *
 *     node infra/provision/provision.test.mjs
 *
 * Needs bash, and a POSIX environment to run it in.
 */

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'provision.sh')

/**
 * The real `mkdir`, by absolute path.
 *
 * A stub that calls `command mkdir "$@"` calls *itself*: `command` skips shell
 * functions, not PATH, and the stub is first on PATH. That recursed until the
 * stack ran out, which looked like the script failing on its second step.
 */
const REAL_MKDIR = spawnSync('bash', ['-c', 'command -v mkdir'], { encoding: 'utf8' }).stdout.trim()

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

/**
 * A path bash can actually use.
 *
 * On Windows the sandbox root comes back as `C:\Users\…`, and pasting that into
 * a shell script loses the backslashes — `C:Usersyongz…`, which fails as a
 * missing directory rather than as anything resembling the real problem. Node
 * needs the Windows form for its own filesystem calls and bash needs this one,
 * so the two are kept apart rather than reconciled.
 */
function shellPath(path) {
  if (process.platform !== 'win32') return path
  const converted = spawnSync('cygpath', ['-u', path], { encoding: 'utf8' })
  return converted.status === 0 ? converted.stdout.trim() : path.replace(/\\/g, '/')
}

/**
 * Every absolute path the script writes to, moved inside the sandbox.
 *
 * `/etc/os-release` is in the list because the script sources it by absolute
 * path — there is no environment variable to point that somewhere else, so the
 * copy is rewritten instead. The sandbox provides its own, claiming Debian, so
 * the preflight's distribution check is exercised rather than stubbed out.
 */
function rewrite(script, root) {
  const paths = [
    ['/etc/os-release', `${root}/etc/os-release`],
    ['/etc/debian_version', `${root}/etc/debian_version`],
    ['/var/log/filesynapse-provision.log', `${root}/var/log/filesynapse-provision.log`],
    ['/etc/filesynapse', `${root}/etc/filesynapse`],
    ['/usr/local/bin/filesynapse-', `${root}/usr/local/bin/filesynapse-`],
    ['/var/lib/filesynapse', `${root}/var/lib/filesynapse`],
    ['/etc/systemd/system', `${root}/etc/systemd/system`],
    ['/etc/apt/keyrings', `${root}/etc/apt/keyrings`],
    ['/etc/apt/sources.list.d', `${root}/etc/apt/sources.list.d`],
  ]

  let out = script
  for (const [from, to] of paths) out = out.split(from).join(to)
  return out
}

/** A stub that records it was called and exits with the given status. */
function stub(dir, name, body = 'exit 0') {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/bash\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

const SANDBOX_COMMANDS = {
  // Root, or the preflight refuses before anything runs.
  id: 'if [ "$1" = "-u" ]; then echo 0; fi',
  'apt-get': 'exit 0',
  // The host architecture, used to build the Docker repository line.
  dpkg: 'echo amd64',
  systemctl: 'exit 0',
  install: 'exit 0',
  chown: 'exit 0',
  // Stands in for a package the script installs itself — `apt-get install jq`
  // runs earlier, and this `apt-get` stub does nothing. Without it the
  // trusted-names step dies on a missing command, and the harness would report
  // that as the script being broken rather than as itself being incomplete.
  jq: 'case "$*" in *Self.DNSName*) echo "filesynapse.tailnet.test." ;; esac; exit 0',
  // Writes the file when asked for one. The script fetches Immich's compose
  // with `curl -o … .new` and then moves it into place, so a stub that only
  // exits 0 makes the *move* fail and the step fail with it — which is a
  // failure of this harness, not of the script, and would be reported as one.
  curl: `out=""
prev=""
for arg in "$@"; do
  [ "$prev" = "-o" ] && out="$arg"
  prev="$arg"
done
if [ -n "$out" ]; then printf '%s\\n' "name: immich" > "$out"; fi
exit 0`,
  sleep: 'exit 0',
  // Reports Nextcloud as running, so the trusted-domain step takes its real
  // path rather than the skip. `exec` answers `occ`, since that step reads its
  // output back.
  docker: `case "$1" in
    ps) printf '%s\\n' immich_server immich_postgres nextcloud nextcloud-db agent ;;
    exec) echo '{"system":{"trusted_domains":["filesynapse"],"overwritehost":"filesynapse"}}' ;;
  esac
  exit 0`,
  // Present, so the install step is skipped; joined, so the join is skipped.
  tailscale: `case "$1" in
    status) [ "$2" = "--json" ] && echo '{"Self":{"DNSName":"filesynapse.tailnet.test.","TailscaleIPs":["100.64.0.1"]}}' ;;
    ip) echo 100.64.0.1 ;;
  esac
  exit 0`,
}

/**
 * Builds a sandbox and runs the script in it once.
 *
 * `stubs` overrides individual commands, which is how the failure case is
 * exercised: one stub is made to exit non-zero in the middle of a step body.
 */
function sandbox({ overrides = {}, env = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'filesynapse-provision-'))
  // Node writes here; the script is told about this form of it.
  const shellRoot = shellPath(root)
  const bin = join(root, 'bin')

  for (const dir of ['etc', 'var/log', 'usr/local/bin', 'etc/systemd/system', 'etc/filesynapse']) {
    mkdirSync(join(root, dir), { recursive: true })
  }

  writeFileSync(
    join(root, 'etc/os-release'),
    'ID=debian\nVERSION_CODENAME=bookworm\nPRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\n',
  )
  writeFileSync(join(root, 'etc/debian_version'), '12.5\n')

  mkdirSync(bin, { recursive: true })
  for (const [name, body] of Object.entries({ ...SANDBOX_COMMANDS, ...overrides })) {
    stub(bin, name, body)
  }

  // The agent files the app would have written before running the script. They
  // have to exist *first*: the deploy step skips itself when AGENT_DIR is empty
  // or absent, so seeding them afterwards tested the skip while looking like it
  // tested the deploy.
  const agentFiles = join(root, 'agent-files')
  mkdirSync(agentFiles, { recursive: true })
  for (const name of ['Dockerfile', 'docker-compose.yml', 'agent.mjs']) {
    writeFileSync(join(agentFiles, name), `// ${name}\n`)
  }

  const scriptPath = join(root, 'provision.sh')
  writeFileSync(scriptPath, rewrite(readFileSync(SCRIPT, 'utf8'), shellRoot))

  const sandboxEnv = {
    ...process.env,
    PATH: `${shellPath(bin)}:${process.env.PATH}`,
    STACK_DIR: `${shellRoot}/opt/filesynapse`,
    PHOTOS_DIR: `${shellRoot}/srv/photos`,
    FILES_DIR: `${shellRoot}/srv/cloud`,
    TAILSCALE_NAME: 'filesynapse',
    AGENT_DIR: `${shellRoot}/agent-files`,
    B2_BUCKET: 'a-bucket',
    B2_KEY_ID: 'a-key-id',
    B2_APP_KEY: 'an-app-key',
    RESTIC_PASSWORD: 'a-restic-password',
    BACKUP_HOUR: '3',
    ...env,
  }

  // Output goes to files rather than pipes, and that is not a preference.
  //
  // With a pipe, `spawnSync` waited forever even after the script had exited:
  // the step bodies are `bash -c` children, and a pipe is only closed once
  // *every* process holding it has gone. One that outlives its parent — which
  // is exactly what a backgrounded command does — leaves the reader waiting for
  // an EOF that never comes. A file has no such notion.
  const outPath = join(root, 'stdout.log')
  const errPath = join(root, 'stderr.log')
  const outFd = openSync(outPath, 'w')
  const errFd = openSync(errPath, 'w')

  const result = spawnSync('bash', [shellPath(scriptPath)], {
    cwd: root,
    env: sandboxEnv,
    stdio: ['ignore', outFd, errFd],
    encoding: 'utf8',
  })

  closeSync(outFd)
  closeSync(errFd)
  result.stdout = readFileSync(outPath, 'utf8')
  result.stderr = readFileSync(errPath, 'utf8')

  return { root, shellRoot, bin, result, scriptPath, env: sandboxEnv }
}

function read(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/* ── A clean run ────────────────────────────────────────────────────────── */

console.log('\na first run, on a sandbox')

const first = sandbox()

const stack = join(first.root, 'opt/filesynapse')
const nextcloud = join(stack, 'nextcloud')
const immich = join(stack, 'immich')

// The step log, not stderr, is where a failure explains itself: each step emits
// `name<TAB>state<TAB>detail`, so the last line says which one stopped.
check(
  'the script exits 0',
  first.result.status === 0,
  `${JSON.stringify(first.result.stdout?.split('\n').filter(Boolean).slice(-3))} | stderr: ${first.result.stderr?.trim().slice(-200)}`,
)

// Whether or not Docker was installed, its daemon has to be started.
// "docker --version" answers without one, so a machine where Docker is present
// and stopped passes every earlier check and then fails at the first
// `docker compose up` with "Cannot connect to the Docker daemon".
check(
  'it makes sure the Docker daemon is running, not merely installed',
  first.result.stdout?.includes('Make sure Docker is running') === true,
)

// The contract between this script and the app, which nothing else checks.
//
// `emit` writes `step<TAB>state<TAB>detail`; `parse_line` in
// `app/src-tauri/src/provision.rs` reads it back and drives the whole progress
// list the user watches. They are two halves of one agreement written in two
// languages, and a change to either that the other did not follow would show up
// as a step that silently never appears.
//
// The Rust half is tested against the same contract. This is the half that
// says the script still writes it.
const STATES = new Set(['start', 'ok', 'skipped', 'failed'])
const emitted = (first.result.stdout ?? '').split('\n').filter(Boolean)
const malformed = emitted.filter((line) => {
  const [step, state] = line.split('\t')
  return !step?.trim() || !state || !STATES.has(state.trim())
})

check('it emitted some steps at all', emitted.length > 0)
check(
  'every line it emitted is a step the app can parse',
  malformed.length === 0,
  malformed.slice(0, 3).join(' | '),
)

const compose = read(join(nextcloud, 'docker-compose.yml'))
check('the Nextcloud compose is written', compose !== null)
check(
  'it names the tailnet as a trusted domain',
  compose?.includes('NEXTCLOUD_TRUSTED_DOMAINS'),
)
check(
  'it has no backticks, which would be command substitution in the step body',
  compose !== null && !compose.includes('`'),
  'a backtick here runs a command at provision time',
)
check('its compose variables survive unexpanded', compose?.includes('${DB_PASSWORD}'))
check('the database waits for a healthcheck', compose?.includes('condition: service_healthy'))

const nextcloudEnv = read(join(nextcloud, '.env'))
check('the Nextcloud .env is written', nextcloudEnv !== null)
check('it carries a generated database password', /^DB_PASSWORD=[0-9a-f]{48}$/m.test(nextcloudEnv ?? ''))

const immichEnv = read(join(immich, '.env'))
check('the Immich .env is written', immichEnv !== null)
check('it points at the photos folder', immichEnv?.includes(first.shellRoot) === true)

// Immich's compose is *fetched* at provision time, so the contract between what
// this writes and what that file interpolates can drift without anything here
// noticing — and the failure is a stack that starts and cannot reach its own
// database.
//
// Checked against the real file: `docker/docker-compose.yml` at v3.2.4, the
// tag `releases/latest` resolved to on 2026-10-01. It interpolates
// UPLOAD_LOCATION, DB_DATA_LOCATION, DB_PASSWORD, DB_USERNAME and
// DB_DATABASE_NAME — all of them written below — plus IMMICH_VERSION, which
// carries a `:-release` default and need not be set.
const IMMICH_REQUIRED = [
  'UPLOAD_LOCATION',
  'DB_DATA_LOCATION',
  'DB_PASSWORD',
  'DB_USERNAME',
  'DB_DATABASE_NAME',
]
const immichKeys = new Set(
  (immichEnv ?? '')
    .split('\n')
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => line.split('=')[0].trim()),
)
const missing = IMMICH_REQUIRED.filter((key) => !immichKeys.has(key))
check(
  "every variable Immich's compose interpolates is written",
  missing.length === 0,
  `missing: ${missing.join(', ')} — the stack would start and not reach its database`,
)

const dump = read(join(first.root, 'usr/local/bin/filesynapse-dump'))
const backup = read(join(first.root, 'usr/local/bin/filesynapse-backup'))
check('the dump script is written', dump !== null)
check('the backup wrapper is written', backup !== null)
check(
  'the wrapper refuses to report ok when the dump fails',
  backup?.includes('if ! ') === true && backup?.includes('filesynapse-dump'),
)
check('retention is present', backup?.includes('--keep-daily 7 --prune') === true)
check(
  'the Postgres data directory is excluded from the snapshot',
  backup?.includes('--exclude') === true,
)

const timer = read(join(first.root, 'etc/systemd/system/filesynapse-backup.timer'))
check('the nightly timer is written', timer !== null)
check('it fires at the configured hour', timer?.includes('OnCalendar=*-*-* 3:00:00') === true)

const backupEnv = read(join(first.root, 'etc/filesynapse/backup.env'))
check('the Backblaze credentials are written where restic expects them', backupEnv !== null)
check('they are the values that were passed in', backupEnv?.includes('a-key-id') === true)

const agentEnv = read(join(stack, 'agent/.env'))
check('the agent gets a token', /^AGENT_TOKEN=[0-9a-f]{64}$/m.test(agentEnv ?? ''))
check('and the host library paths, so it measures the right disk', agentEnv?.includes(first.shellRoot) === true)
check('and restic access, so it reports snapshot state', agentEnv?.includes('a-key-id') === true)

check("the agent files were copied", read(join(stack, "agent/Dockerfile")) !== null)

/* ── The generated scripts are valid shell ──────────────────────────────── */

console.log('\nwhat it generated is valid shell')

for (const [name, body] of [
  ['filesynapse-dump', dump],
  ['filesynapse-backup', backup],
]) {
  if (body === null) {
    check(`${name} parses as bash`, false, 'not written')
    continue
  }
  const file = join(first.root, `${name}.check`)
  writeFileSync(file, body)
  const parsed = spawnSync('bash', ['-n', file], { encoding: 'utf8' })
  check(`${name} parses as bash`, parsed.status === 0, parsed.stderr?.slice(0, 200))
}

/* ── The replace-server route ───────────────────────────────────────────── */

console.log('\nreplacing a server — where the transfer has to happen')

// A restore writes back everything the snapshot holds, and that includes
// `$STACK_DIR` — both .env files — while Immich's PostgreSQL data directory is
// deliberately excluded. So the database a fresh machine starts with was
// initialised from the passwords provisioning generated, and restoring
// afterwards would overwrite those .env files with the snapshot's older ones
// while the databases kept the new. Neither application could reach its own
// database, and the error reads like corruption rather than like the order of
// two steps.
//
// The order is therefore the fix, and this is what stops it being undone.
const replacing = sandbox({
  overrides: {
    ssh: 'exit 0',
    rsync: 'exit 0',
  },
  env: { TRANSFER: 'sync', SOURCE_ADDRESS: 'old-server' },
})

const events = (replacing.result.stdout ?? '')
  .split('\n')
  .filter(Boolean)
  .map((line) => line.split('\t')[0])

const at = (name) => events.findIndex((step) => step === name)
check('the replace run completes', replacing.result.status === 0, replacing.result.stdout?.slice(-200))
check('it copies from the old server', at('Sync from the old server') >= 0)
check('it starts Immich', at('Start Immich') >= 0)
check(
  'the copy happens before the stacks start, so a restore cannot overwrite their credentials',
  at('Sync from the old server') < at('Start Immich'),
  `order was: ${events.join(' → ')}`,
)
check(
  'and the files are chowned after the copy, not before it',
  at('Sync from the old server') < at('Set files ownership'),
  `order was: ${events.join(' → ')}`,
)

/* ── The backup scripts, actually executed ──────────────────────────────── */

console.log('\nthe backup path — the code that decides whether data is safe')

/**
 * Runs the generated `filesynapse-backup` and reports what it decided.
 *
 * These two scripts are the most consequential thing this project writes. A
 * snapshot that silently omits the databases restores a pile of files no
 * application knows about, and a dump that stopped halfway is worse than none
 * because it looks restorable. Both failure modes are the script's trailer
 * checks noticing — so the checks are worth running rather than reading.
 *
 * `dumpOutput` chooses what the database containers appear to produce:
 *   good      both dumps complete, with the trailers the script greps for
 *   truncated a dump that stops halfway, with no trailer
 *   refused   the database container no longer exists
 */
function runBackup(root, shellRoot, { dumpOutput = 'good', resticOk = true } = {}) {
  const bin = join(root, `backup-bin-${dumpOutput}-${resticOk}`)
  mkdirSync(bin, { recursive: true })

  const dockerBody = {
    good: `if [ "$1" = "exec" ]; then
             case "$*" in
               *pg_dumpall*) echo "PostgreSQL database dump complete" ;;
               *mariadb-dump*) echo "Dump completed" ;;
             esac
           fi
           exit 0`,
    // Exits 0 — the container is fine — but produces a dump that stops partway.
    // `docker exec` succeeding is what makes this the dangerous case: nothing
    // has said "error", and only the trailer reveals the dump is unusable.
    truncated: `if [ "$1" = "exec" ]; then
                  case "$*" in
                    *pg_dumpall*) echo "-- PostgreSQL database dump" ;;
                    *mariadb-dump*) echo "-- MariaDB dump" ;;
                  esac
                fi
                exit 0`,
    refused: `if [ "$1" = "exec" ]; then exit 1; fi; exit 0`,
  }[dumpOutput]

  stub(bin, 'docker', dockerBody)
  stub(bin, 'restic', resticOk ? 'exit 0' : 'exit 1')

  const result = spawnSync('bash', [shellPath(join(root, 'usr/local/bin/filesynapse-backup'))], {
    cwd: root,
    env: { ...process.env, PATH: `${shellPath(bin)}:${process.env.PATH}` },
    encoding: 'utf8',
  })

  const verdict = read(join(root, 'var/lib/filesynapse/last-backup'))
  const dumps = join(root, 'var/lib/filesynapse/dumps')

  return {
    status: result.status,
    verdict: verdict?.trim().split(/\s+/)[0] ?? null,
    wroteImmichDump: read(join(dumps, 'immich.sql')) !== null,
    wroteNextcloudDump: read(join(dumps, 'nextcloud.sql')) !== null,
  }
}

const goodDump = runBackup(first.root, first.shellRoot)
check('a clean run writes an ok verdict', goodDump.verdict === 'ok', String(goodDump.verdict))
check('it exits 0', goodDump.status === 0)
check('it wrote both database dumps', goodDump.wroteImmichDump && goodDump.wroteNextcloudDump)

// The dangerous one. `docker exec` succeeded, so nothing reported an error, and
// the only thing standing between this and a backup that restores nothing is
// the trailer check.
const halfDump = runBackup(first.root, first.shellRoot, { dumpOutput: 'truncated' })
check(
  'a dump with no completion trailer is refused, not snapshotted',
  halfDump.verdict === 'failed',
  `verdict was ${halfDump.verdict}`,
)
check('and the run exits non-zero so the timer records a failure', halfDump.status !== 0)

const refused = runBackup(first.root, first.shellRoot, { dumpOutput: 'refused' })
check('a database container that is gone is refused', refused.verdict === 'failed', String(refused.verdict))

const noRepo = runBackup(first.root, first.shellRoot, { resticOk: false })
check(
  'an unreachable repository is reported rather than claiming success',
  noRepo.verdict === 'failed',
  `verdict was ${noRepo.verdict}`,
)

/* ── Running it twice ───────────────────────────────────────────────────── */

console.log('\na second run — the thing anyone would do next')

// The same sandbox, run again. This is the case that used to break the server:
// both database passwords were regenerated and written over the ones the
// databases had already been initialised with.
const passwordsBefore = {
  nextcloud: nextcloudEnv?.match(/^DB_PASSWORD=(.*)$/m)?.[1],
  immich: immichEnv?.match(/^DB_PASSWORD=(.*)$/m)?.[1],
}

const second = spawnSync('bash', [shellPath(first.scriptPath)], {
  cwd: first.root,
  // The same environment as the first run, which is what a person pressing the
  // button again would produce.
  env: first.env,
  encoding: 'utf8',
})

check('it exits 0 again', second.status === 0, second.stderr?.slice(-300))

const nextcloudAfter = read(join(nextcloud, '.env'))
const immichAfter = read(join(immich, '.env'))
check(
  "Nextcloud's database password is unchanged, so its database still accepts it",
  nextcloudAfter?.match(/^DB_PASSWORD=(.*)$/m)?.[1] === passwordsBefore.nextcloud,
)
check(
  "Immich's database password is unchanged",
  immichAfter?.match(/^DB_PASSWORD=(.*)$/m)?.[1] === passwordsBefore.immich,
)
check(
  'and the agent keeps the token the app was already given',
  read(join(stack, 'agent/.env'))?.match(/^AGENT_TOKEN=(.*)$/m)?.[1] ===
    agentEnv?.match(/^AGENT_TOKEN=(.*)$/m)?.[1],
)

/* ── A step that fails ──────────────────────────────────────────────────── */

console.log('\na step whose middle command fails')

// The bug this guards: step bodies run in a child shell, which does not inherit
// `set -e`. Before the `run` helper, a body of several commands reported success
// as long as its *last* one succeeded — so a failed write in the middle went
// green and the run ended with a success summary.
//
// First the control: with `mkdir` passed through untouched, the sandbox still
// passes. Without this, a failure below would prove nothing — it could be the
// override breaking everything rather than the failing command being noticed.
const control = sandbox({ overrides: { mkdir: `"${REAL_MKDIR}" "$@"` } })
check(
  'the sandbox still passes with mkdir overridden but working',
  control.result.status === 0,
  control.result.stdout?.split('\n').filter(Boolean).slice(-2).join(' | '),
)

// Now make `mkdir` fail for the Immich stack only. That is the first command of
// several multi-command step bodies, which then have more commands after it —
// exactly the shape that used to report success.
const failsMidBody = sandbox({
  overrides: {
    mkdir: `for arg in "$@"; do case "$arg" in *immich*) exit 1 ;; esac; done; "${REAL_MKDIR}" "$@"`,
  },
})

check(
  'a failing command inside a step body stops the run',
  failsMidBody.result.status !== 0,
  'the run reported success with a failed command in the middle of a step',
)
check(
  'and it names the step that failed rather than stopping silently',
  failsMidBody.result.stdout?.includes('\tfailed\t') === true,
  failsMidBody.result.stdout?.slice(-200),
)

/* ── verify.sh ──────────────────────────────────────────────────────────── */

console.log('\nverify.sh — the thing somebody runs when the server is already wrong')

/**
 * Runs `verify.sh` against a described server and reports what it concluded.
 *
 * It is the tool a person reaches for when something is broken, and it had no
 * automated test at all — its parsing was checked once by hand and never
 * captured, which is the same mistake as the dry run being done by hand. The
 * logic worth pinning is the trusted-domains comparison, because it is the one
 * check nothing else in the project can make.
 */
function runVerify(root, shellRoot, { trusts = true, docker = true, reachable = true } = {}) {
  const bin = join(root, `verify-bin-${trusts}-${docker}-${reachable}`)
  mkdirSync(bin, { recursive: true })

  const domains = trusts
    ? '["filesynapse","filesynapse.tailnet.test","100.64.0.1"]'
    : '["filesynapse"]'

  if (docker) {
    stub(
      bin,
      'docker',
      `case "$1" in
         ps) printf '%s\\n' immich_server immich_postgres nextcloud nextcloud-db agent ;;
         exec) echo '{"system":{"trusted_domains":${domains},"overwritehost":"filesynapse"}}' ;;
       esac
       exit 0`,
    )
  }
  stub(bin, 'curl', reachable ? 'exit 0' : 'exit 1')
  stub(
    bin,
    'tailscale',
    `if [ "$1" = "status" ] && [ "$2" = "--json" ]; then
       echo '{"Self":{"DNSName":"filesynapse.tailnet.test.","TailscaleIPs":["100.64.0.1"]}}'
     fi
     exit 0`,
  )
  stub(bin, 'systemctl', 'echo filesynapse-backup.timer')

  const result = spawnSync('bash', [shellPath(join(HERE, 'verify.sh'))], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${shellPath(bin)}:${process.env.PATH}`,
      STACK_DIR: `${shellRoot}/opt/filesynapse`,
      PHOTOS_DIR: `${shellRoot}/srv/photos`,
      FILES_DIR: `${shellRoot}/srv/cloud`,
      WAIT_TRIES: '1',
    },
    encoding: 'utf8',
  })

  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

const healthy = runVerify(first.root, first.shellRoot)
check('a working server passes', healthy.status === 0, healthy.output.slice(-300))
check(
  'and it confirms the tailnet name specifically',
  healthy.output.includes('trusts the tailnet name'),
)
check(
  'and prints the host by its value, not as a JSON fragment',
  healthy.output.includes('(filesynapse)') && !healthy.output.includes('"overwritehost"'),
)

// The check the script exists for. Nextcloud is up and answering; the only
// thing wrong is that it does not recognise the name it is being reached by.
const untrusted = runVerify(first.root, first.shellRoot, { trusts: false })
check(
  'a server that does not trust its own tailnet name fails',
  untrusted.status !== 0,
  'it reported success for a server that would answer "Access through untrusted domain"',
)
check(
  'and it names the name it refused',
  untrusted.output.includes('filesynapse.tailnet.test'),
)

check('no docker is reported as the blocker it is', runVerify(first.root, first.shellRoot, {
  docker: false,
}).status !== 0)

// A server where nothing is listening. Everything is "running" as far as docker
// is concerned, which is the state that makes this worth checking at all.
check(
  'services that never answer are not reported as working',
  runVerify(first.root, first.shellRoot, { reachable: false }).status !== 0,
)

/* ── Cleanup ────────────────────────────────────────────────────────────── */

for (const s of [first, control, failsMidBody, replacing]) {
  try {
    rmSync(s.root, { recursive: true, force: true })
  } catch {
    /* nothing depends on the sandbox being gone */
  }
}

console.log(`\n${checks - failures.length}/${checks} checks passed`)
if (failures.length) {
  console.log(`failed: ${failures.join(', ')}`)
  process.exit(1)
}
