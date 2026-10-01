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

/* ── Cleanup ────────────────────────────────────────────────────────────── */

for (const s of [first, control, failsMidBody]) {
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
