import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toaster'
import type { Preflight, ProvisionEvent } from '../core/types'
import { compactBytes } from '../lib/format'
import { parentOf, sameRoot } from '../lib/paths'
import { pickFolder, preflight, provisionStatus, startProvision, type ProvisionRun } from '../native/bridge'
import { useApp } from '../state/store'

/**
 * "Set up this computer as your server" — PLAN.md §11's flagship, made real.
 *
 * The flow runs the machine check before anything is offered, because a
 * spectrum is only honest if the unavailable path says *why* rather than being
 * absent (PLAN.md §11: gated at runtime by preflight, never removed at build).
 *
 * Progress comes from polling the runner. The app talks to the shell through
 * `invoke` alone, so there is no event stream to subscribe to — see the note in
 * `native/bridge.ts`.
 */

type Step = 'check' | 'folders' | 'backup' | 'run' | 'done'

export function Provision() {
  const { credentials, setCredentials, setRole, go, connection, setAddress } = useApp()
  const { show } = useToast()

  const [step, setStep] = useState<Step>('check')
  const [check, setCheck] = useState<Preflight | null>(null)
  const [photosFolder, setPhotosFolder] = useState('/srv/photos')
  const [filesFolder, setFilesFolder] = useState('/srv/files')
  const [name, setName] = useState('filesynapse')

  const [b2Bucket, setB2Bucket] = useState('')
  const [b2KeyId, setB2KeyId] = useState('')
  const [b2AppKey, setB2AppKey] = useState('')
  const [resticPassword, setResticPassword] = useState('')

  const [run, setRun] = useState<ProvisionRun | null>(null)
  const pollRef = useRef<number | null>(null)

  useEffect(() => {
    preflight().then(setCheck)
  }, [])

  // Poll only while the runner says it is going, and stop on unmount so a
  // navigated-away screen does not keep asking.
  useEffect(() => {
    if (step !== 'run') return
    const tick = async () => {
      const status = await provisionStatus()
      setRun(status)
      if (status && !status.running) {
        if (pollRef.current) window.clearInterval(pollRef.current)
        pollRef.current = null
        if (!status.failed) {
          setRole('host')
          setStep('done')
        }
      }
    }
    void tick()
    pollRef.current = window.setInterval(tick, 700)
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [step, setRole])

  const begin = async () => {
    const started = await startProvision({
      photosFolder,
      filesFolder,
      tailscaleName: name.trim() || 'filesynapse',
      transfer: 'fresh',
      b2Bucket: b2Bucket.trim() || undefined,
      b2KeyId: b2KeyId.trim() || undefined,
      b2AppKey: b2AppKey.trim() || undefined,
      resticPassword: resticPassword || undefined,
    })
    if (!started) {
      show('Could not start provisioning — the desktop app is needed')
      return
    }
    setStep('run')
  }

  const backupConfigured = Boolean(b2Bucket.trim() && b2KeyId.trim() && b2AppKey.trim() && resticPassword)

  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: 'var(--surf2)', padding: '28px 32px 40px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn--sm" onClick={() => go('first-run')} aria-label="Back">
            <Icon name="back" size={13} />
          </button>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--tx)' }}>Set up this computer as your server</h1>
        </header>

        <StepBar current={step} />

        {step === 'check' && (
          <Panel title="Can this machine host?">
            {!check ? (
              <p style={p}>Checking…</p>
            ) : (
              <>
                <p style={p}>
                  Immich and Nextcloud are Linux containers, so the host needs a Linux environment
                  running Docker. Everything else is a preference.
                </p>

                <Facts check={check} />

                {check.blockers.length > 0 && (
                  <Notice tone="bad">
                    <strong>This machine cannot be the server.</strong>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {check.blockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </Notice>
                )}

                {check.warnings.length > 0 && (
                  <Notice tone="warn">
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {check.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </Notice>
                )}

                <Actions>
                  <button className="btn" onClick={() => go('first-run')}>
                    Connect to a server instead
                  </button>
                  <button
                    className="btn btn--primary"
                    disabled={!check.ok}
                    onClick={() => setStep('folders')}
                  >
                    Continue
                  </button>
                </Actions>
              </>
            )}
          </Panel>
        )}

        {step === 'folders' && (
          <Panel title="Where the libraries live">
            <p style={p}>
              Two folders, one per role. Different disks are strongly preferred — that is what keeps
              a drive failure to one role instead of both.
            </p>

            <FolderField
              label="Photos folder"
              hint="Immich manages this folder."
              value={photosFolder}
              onChange={setPhotosFolder}
              volumes={check?.volumes ?? []}
            />
            <FolderField
              label="Cloud storage folder"
              hint="Documents and project files."
              value={filesFolder}
              onChange={setFilesFolder}
              volumes={check?.volumes ?? []}
            />
            {sameRoot(photosFolder, filesFolder) && (
              <Notice tone="warn">
                Both folders sit under {parentOf(photosFolder)}. This works, but one disk failure
                would take both roles at once.
              </Notice>
            )}

            <div>
              <label className="field-label" htmlFor="ts-name">
                Tailscale name for this server
              </label>
              <input
                id="ts-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ marginTop: 6 }}
              />
              <div className="hint" style={{ marginTop: 6 }}>
                Your phones and laptops reach the server by this name. Nothing else needs changing
                later if the server is replaced.
              </div>
            </div>

            <Actions>
              <button className="btn" onClick={() => setStep('check')}>
                Back
              </button>
              <button
                className="btn btn--primary"
                disabled={!photosFolder.trim() || !filesFolder.trim() || photosFolder === filesFolder}
                onClick={() => setStep('backup')}
              >
                Continue
              </button>
            </Actions>
          </Panel>
        )}

        {step === 'backup' && (
          <Panel title="Off-site backup">
            <p style={p}>
              A nightly restic snapshot to Backblaze B2. This is the copy that survives the machine
              being lost, stolen or flooded, so it is worth setting up now rather than later.
            </p>

            <CredField label="Bucket name" value={b2Bucket} onChange={setB2Bucket} placeholder="my-filesynapse" />
            <CredField label="B2 key ID" value={b2KeyId} onChange={setB2KeyId} />
            <CredField label="B2 application key" value={b2AppKey} onChange={setB2AppKey} secret />
            <CredField
              label="restic repository password"
              value={resticPassword}
              onChange={setResticPassword}
              secret
              hint="Store this somewhere safe. Without it the backups cannot be restored — by anyone, including you."
            />

            {!backupConfigured && (
              <Notice tone="warn">
                Without these, the server is provisioned with no off-site copy. You can add it later
                by re-running provisioning, but the gap only closes from the day it is added.
              </Notice>
            )}

            <Actions>
              <button className="btn" onClick={() => setStep('folders')}>
                Back
              </button>
              <button className="btn btn--primary" onClick={begin}>
                {backupConfigured ? 'Provision this computer' : 'Provision without backup'}
              </button>
            </Actions>
          </Panel>
        )}

        {step === 'run' && (
          <Panel title="Provisioning">
            <p style={p}>
              Installing Docker, writing the stack, starting Immich and Nextcloud, joining
              Tailscale{backupConfigured ? ', and scheduling the nightly backup' : ''}. This takes
              several minutes and will ask for your password.
            </p>
            <EventList events={run?.events ?? []} />
            {run?.failed && (
              <Notice tone="bad">
                <strong>Provisioning failed.</strong> Nothing was rolled back — the log at
                /var/log/filesynapse-provision.log on the server says which step stopped.
              </Notice>
            )}
            <Actions>
              <button className="btn" onClick={() => go('server')}>
                Leave it running in the background
              </button>
            </Actions>
          </Panel>
        )}

        {step === 'done' && (
          <Panel title="This computer is the server">
            <p style={p}>
              Immich and Nextcloud are running, and everything on your network reaches them by{' '}
              <code style={code}>{name}</code>.
            </p>

            {run?.failed && (
              <Notice tone="bad">
                The run reported a failure — check /var/log/filesynapse-provision.log on the server
                before trusting this installation.
              </Notice>
            )}

            <StepList
              lines={[
                'Open Immich once and create the admin account — it has no users yet.',
                'Open Nextcloud once and create the admin account.',
                'Deploy the host agent so this app can show real status (for-human.md §2).',
                'Point your phone at Immich and let it upload.',
              ]}
            />

            <CredField
              label="Host agent token"
              value={credentials.agentToken}
              onChange={(v) => setCredentials({ ...credentials, agentToken: v })}
              secret
              hint="The AGENT_TOKEN you set when deploying the agent. Without it the status panel stays empty."
            />

            <Actions>
              <button
                className="btn btn--primary"
                onClick={() => {
                  // The three service URLs follow from the one name, so they are
                  // derived rather than asked for.
                  setAddress(name, {
                    immichUrl: `http://${name}:2283`,
                    nextcloudUrl: `http://${name}:8080`,
                    agentUrl: `http://${name}:8787`,
                  })
                  show('Address set — nothing else needs configuring here')
                  go('server')
                }}
              >
                Point this app at it
              </button>
              <button className="btn" onClick={() => go('server')}>
                Skip
              </button>
            </Actions>
            <p style={{ ...p, fontSize: 11, color: 'var(--txd)' }}>
              This app currently points at {connection.address || 'nothing'}. It can point at the new
              server now, or you can change it later in Settings.
            </p>
          </Panel>
        )}
      </div>
    </div>
  )
}

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'check', label: 'Check' },
  { id: 'folders', label: 'Folders' },
  { id: 'backup', label: 'Backup' },
  { id: 'run', label: 'Provision' },
  { id: 'done', label: 'Done' },
]

function StepBar({ current }: { current: Step }) {
  const index = STEPS.findIndex((s) => s.id === current)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      {STEPS.map((s, i) => (
        <span key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {i > 0 && <span style={{ color: 'var(--txd)' }}>›</span>}
          <span
            style={{
              color: i === index ? 'var(--acc)' : i < index ? 'var(--tx2)' : 'var(--txd)',
              fontWeight: i === index ? 600 : 400,
            }}
          >
            {s.label}
          </span>
        </span>
      ))}
    </div>
  )
}

function Facts({ check }: { check: Preflight }) {
  const rows: Array<[string, string, boolean | null]> = [
    ['Operating system', check.platform, check.isLinux],
    ['Docker', check.dockerVersion ?? 'not found', check.hasDocker],
    ['Compose plugin', check.composeVersion ?? 'not found', check.hasCompose],
    ['Administrator rights', check.isRoot ? 'yes' : 'will prompt', null],
  ]

  return (
    <div className="group">
      {rows.map(([label, value, ok]) => (
        <div key={label} className="group__item">
          <span>{label}</span>
          <span
            style={{
              fontSize: 12,
              color: ok === null ? 'var(--tx2)' : ok ? 'var(--ok)' : 'var(--danger)',
            }}
          >
            {value}
          </span>
        </div>
      ))}
      {check.volumes.length > 0 && (
        <div className="group__item" style={{ display: 'block' }}>
          <span className="hint">
            Drives: {check.volumes.map((v) => `${v.mount} (${compactBytes(v.freeBytes)} free)`).join(' · ')}
          </span>
        </div>
      )}
    </div>
  )
}

function EventList({ events }: { events: ProvisionEvent[] }) {
  if (!events.length) return <p style={p}>Starting…</p>
  return (
    <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
      {events.map((e, i) => (
        <li key={`${e.step}-${i}`} style={{ display: 'flex', gap: 8, color: e.state === 'failed' ? 'var(--danger)' : 'var(--tx2)' }}>
          <span aria-hidden="true">
            {e.state === 'ok' ? '✓' : e.state === 'failed' ? '✕' : e.state === 'start' ? '◌' : '–'}
          </span>
          <span>
            {e.step}
            {e.detail ? ` — ${e.detail}` : ''}
          </span>
        </li>
      ))}
    </ol>
  )
}

function FolderField({
  label,
  hint,
  value,
  onChange,
  volumes,
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  volumes: Preflight['volumes']
}) {
  const free = volumes.find((v) => value.startsWith(v.mount))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span className="field-label">{label}</span>
      <span className="hint">{hint}</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="input" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} />
        <button
          className="btn"
          style={{ whiteSpace: 'nowrap' }}
          onClick={async () => {
            const picked = await pickFolder(value)
            if (picked) onChange(picked)
          }}
        >
          Browse…
        </button>
      </div>
      {free && (
        <span className="hint">
          {free.mount} has {compactBytes(free.freeBytes)} free
        </span>
      )}
    </div>
  )
}

function CredField({
  label,
  value,
  onChange,
  secret,
  placeholder,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  secret?: boolean
  placeholder?: string
  hint?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label className="field-label" htmlFor={`cred-${label}`}>
        {label}
      </label>
      <input
        id={`cred-${label}`}
        className="input"
        type={secret ? 'password' : 'text'}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--tx)' }}>{title}</h2>
      {children}
    </section>
  )
}

function StepList({ lines }: { lines: string[] }) {
  return (
    <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
      {lines.map((line) => (
        <li key={line} style={{ display: 'flex', gap: 8, color: 'var(--tx2)' }}>
          <span style={{ color: 'var(--txd)' }}>○</span>
          {line}
        </li>
      ))}
    </ol>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'bad'; children: React.ReactNode }) {
  const bad = tone === 'bad'
  return (
    <div
      style={{
        fontSize: 12,
        lineHeight: 1.55,
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--bd)',
        background: bad ? 'var(--dangerbg)' : 'var(--warnbg)',
        color: bad ? 'var(--danger)' : 'var(--warn)',
      }}
    >
      {children}
    </div>
  )
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</div>
}

const p: React.CSSProperties = { fontSize: 13, color: 'var(--tx2)', lineHeight: 1.55 }
const code: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--tx2)',
  background: 'var(--surf)',
  padding: '2px 8px',
  borderRadius: 3,
}
