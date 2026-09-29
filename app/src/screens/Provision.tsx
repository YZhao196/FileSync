import { useEffect, useRef, useState } from 'react'
import { Button, FormControl, Heading, IconButton, Stack, TextInput } from '@primer/react'
import { InlineMessage } from '@primer/react/experimental'
import { EventList } from '../components/EventList'
import { carbonIcon, Icon } from '../components/Icon'
import { useToast } from '../components/Toaster'
import type { Preflight } from '../core/types'
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
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        background: 'var(--background)',
        padding: 'var(--spacing-06) var(--spacing-07) var(--spacing-08)',
      }}
    >
      <Stack direction="vertical" gap="spacious" style={{ maxWidth: 560, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-04)' }}>
          <IconButton
            icon={carbonIcon('back')}
            aria-label="Back"
            size="small"
            onClick={() => go('first-run')}
          />
          <Heading as="h1" variant="medium">
            Set up this computer as your server
          </Heading>
        </header>

        <StepBar current={step} />

        {step === 'check' && (
          <Panel title="Can this machine host?">
            {!check ? (
              <Body>Checking…</Body>
            ) : (
              <>
                <Body>
                  Immich and Nextcloud are Linux containers, so the host needs a Linux environment
                  running Docker. Everything else is a preference.
                </Body>

                <Facts check={check} />

                {check.blockers.length > 0 && (
                  <Notice tone="bad">
                    <strong>This machine cannot be the server.</strong>
                    <ul style={{ margin: 'var(--spacing-02) 0 0', paddingLeft: 'var(--spacing-05)' }}>
                      {check.blockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </Notice>
                )}

                {check.warnings.length > 0 && (
                  <Notice tone="warn">
                    <ul style={{ margin: 0, paddingLeft: 'var(--spacing-05)' }}>
                      {check.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </Notice>
                )}

                <Actions>
                  <Button variant="default" onClick={() => go('first-run')}>
                    Connect to a server instead
                  </Button>
                  <Button variant="primary" disabled={!check.ok} onClick={() => setStep('folders')}>
                    Continue
                  </Button>
                </Actions>
              </>
            )}
          </Panel>
        )}

        {step === 'folders' && (
          <Panel title="Where the libraries live">
            <Body>
              Two folders, one per role. Different disks are strongly preferred — that is what keeps
              a drive failure to one role instead of both.
            </Body>

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

            <FormControl id="ts-name">
              <FormControl.Label>Tailscale name for this server</FormControl.Label>
              <TextInput block value={name} onChange={(e) => setName(e.target.value)} />
              <FormControl.Caption>
                Your phones and laptops reach the server by this name. Nothing else needs changing
                later if the server is replaced.
              </FormControl.Caption>
            </FormControl>

            <Actions>
              <Button variant="default" onClick={() => setStep('check')}>
                Back
              </Button>
              <Button
                variant="primary"
                disabled={!photosFolder.trim() || !filesFolder.trim() || photosFolder === filesFolder}
                onClick={() => setStep('backup')}
              >
                Continue
              </Button>
            </Actions>
          </Panel>
        )}

        {step === 'backup' && (
          <Panel title="Off-site backup">
            <Body>
              A nightly restic snapshot to Backblaze B2. This is the copy that survives the machine
              being lost, stolen or flooded, so it is worth setting up now rather than later.
            </Body>

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
              <Button variant="default" onClick={() => setStep('folders')}>
                Back
              </Button>
              <Button variant="primary" onClick={begin}>
                {backupConfigured ? 'Provision this computer' : 'Provision without backup'}
              </Button>
            </Actions>
          </Panel>
        )}

        {step === 'run' && (
          <Panel title="Provisioning">
            <Body>
              Installing Docker, writing the stack, starting Immich and Nextcloud, joining
              Tailscale{backupConfigured ? ', and scheduling the nightly backup' : ''}. This takes
              several minutes and will ask for your password.
            </Body>
            <EventList events={run?.events ?? []} />
            {run?.failed && (
              <Notice tone="bad">
                <strong>Provisioning failed.</strong> Nothing was rolled back — the log at
                /var/log/filesynapse-provision.log on the server says which step stopped.
              </Notice>
            )}
            <Actions>
              <Button variant="default" onClick={() => go('server')}>
                Leave it running in the background
              </Button>
            </Actions>
          </Panel>
        )}

        {step === 'done' && (
          <Panel title="This computer is the server">
            <Body>
              Immich and Nextcloud are running, and everything on your network reaches them by{' '}
              <code className="code-01">{name}</code>.
            </Body>

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
              <Button
                variant="primary"
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
              </Button>
              <Button variant="default" onClick={() => go('server')}>
                Skip
              </Button>
            </Actions>
            <Footnote>
              This app currently points at {connection.address || 'nothing'}. It can point at the new
              server now, or you can change it later in Settings.
            </Footnote>
          </Panel>
        )}
      </Stack>
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
    <div
      className="label-01"
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-03)' }}
    >
      {STEPS.map((s, i) => (
        <span key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-03)' }}>
          {i > 0 && <span style={{ color: 'var(--text-helper)' }}>›</span>}
          <span
            style={{
              color:
                i === index
                  ? 'var(--text-primary)'
                  : i < index
                    ? 'var(--text-secondary)'
                    : 'var(--text-helper)',
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
    <Rows>
      {rows.map(([label, value, ok], i) => (
        <Row
          key={label}
          label={label}
          last={i === rows.length - 1 && check.volumes.length === 0}
          value={
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--spacing-02)',
                color:
                  ok === null
                    ? 'var(--text-secondary)'
                    : ok
                      ? 'var(--support-success)'
                      : 'var(--support-error)',
              }}
            >
              {ok !== null && <Icon name={ok ? 'check' : 'alert'} filled />}
              {value}
            </span>
          }
        />
      ))}
      {check.volumes.length > 0 && (
        <div style={{ padding: 'var(--spacing-04) var(--spacing-05)' }}>
          <span className="helper-text-01" style={{ color: 'var(--text-helper)' }}>
            Drives:{' '}
            {check.volumes.map((v) => `${v.mount} (${compactBytes(v.freeBytes)} free)`).join(' · ')}
          </span>
        </div>
      )}
    </Rows>
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
    <FormControl>
      <FormControl.Label>{label}</FormControl.Label>
      <div style={{ display: 'flex', gap: 'var(--spacing-03)', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TextInput block value={value} onChange={(e) => onChange(e.target.value)} />
        </div>
        <Button
          variant="default"
          onClick={async () => {
            const picked = await pickFolder(value)
            if (picked) onChange(picked)
          }}
        >
          Browse
        </Button>
      </div>
      <FormControl.Caption>{hint}</FormControl.Caption>
      {free && (
        <span className="helper-text-01" style={{ color: 'var(--text-helper)' }}>
          {free.mount} has {compactBytes(free.freeBytes)} free
        </span>
      )}
    </FormControl>
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
    <FormControl>
      <FormControl.Label>{label}</FormControl.Label>
      <TextInput
        block
        type={secret ? 'password' : 'text'}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <FormControl.Caption>{hint}</FormControl.Caption>}
    </FormControl>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-05)' }}>
      <Heading as="h2" variant="small">
        {title}
      </Heading>
      {children}
    </section>
  )
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <p className="body-01" style={{ color: 'var(--text-secondary)' }}>
      {children}
    </p>
  )
}

function Footnote({ children }: { children: React.ReactNode }) {
  return (
    <p className="helper-text-01" style={{ color: 'var(--text-helper)' }}>
      {children}
    </p>
  )
}

function StepList({ lines }: { lines: string[] }) {
  return (
    <ol
      className="code-02"
      style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-03)' }}
    >
      {lines.map((line) => (
        <li key={line} style={{ display: 'flex', gap: 'var(--spacing-03)', color: 'var(--text-secondary)' }}>
          <span aria-hidden="true" style={{ color: 'var(--text-helper)' }}>
            ○
          </span>
          {line}
        </li>
      ))}
    </ol>
  )
}

function Rows({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid var(--border-subtle-01)',
        borderRadius: 'var(--border-radius-medium)',
        background: 'var(--layer-01)',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  )
}

function Row({
  label,
  value,
  last,
}: {
  label: string
  value: React.ReactNode
  last?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--spacing-04)',
        padding: 'var(--spacing-04) var(--spacing-05)',
        borderBottom: last ? 'none' : '1px solid var(--border-subtle-01)',
      }}
    >
      <span className="body-compact-01" style={{ color: 'var(--text-primary)' }}>
        {label}
      </span>
      <span className="body-compact-01" style={{ color: 'var(--text-secondary)' }}>
        {value}
      </span>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'bad'; children: React.ReactNode }) {
  // `InlineMessage` lays its icon and body out as two grid cells, so its body
  // must be a single element — loose text nodes would each become their own
  // cell and push the copy into a sliver.
  return (
    <InlineMessage variant={tone === 'bad' ? 'critical' : 'warning'}>
      <div>{children}</div>
    </InlineMessage>
  )
}

function Actions({ children }: { children: React.ReactNode }) {
  return (
    <Stack direction="horizontal" gap="condensed" wrap="wrap" align="center">
      {children}
    </Stack>
  )
}
