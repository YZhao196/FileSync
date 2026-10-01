import { useEffect, useState } from 'react'
import { Button, FormControl, Heading, IconButton, Stack, TextInput } from '@primer/react'
import { InlineMessage } from '@primer/react/experimental'
import { EventList } from '../components/EventList'
import { carbonIcon, Icon } from '../components/Icon'
import { useToast } from '../components/Toaster'
import { testConnection } from '../core/client'
import type { BackupStatus, Preflight } from '../core/types'
import { useAsync } from '../hooks/useAsync'
import { isBackupCurrent } from '../lib/backup'
import { formatClock } from '../lib/format'
import { sameRoot } from '../lib/paths'
import {
  pickFolder,
  preflight,
  provisionStatus,
  startProvision,
  type ProvisionRun,
} from '../native/bridge'
import { useApp } from '../state/store'

/**
 * Moving the server role to this machine, software-first.
 *
 * Nothing physical moves: the data crosses the network, and because Immich API
 * keys and Nextcloud app passwords live in those databases, carrying the data
 * across carries the credentials — so phones and laptops keep working without
 * being re-paired.
 *
 * The one thing that must not be duplicated is the Tailscale name. This machine
 * is provisioned under a temporary name and only takes over once verified, so
 * the working server is never cut off before the replacement is proven.
 */

type Step = 'source' | 'folders' | 'route' | 'provision' | 'handover'
type Transfer = 'sync' | 'restore'
type Disposition = 'keep' | 'wipe'

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'source', label: 'Source' },
  { id: 'folders', label: 'Folders' },
  { id: 'route', label: 'Transfer' },
  { id: 'provision', label: 'Provision' },
  { id: 'handover', label: 'Old machine' },
]

export function ReplaceServer() {
  const {
    connection,
    credentials,
    backends,
    photoFolder,
    fileFolder,
    setPhotoFolder,
    setFileFolder,
    setRole,
    go,
  } = useApp()
  const { show } = useToast()

  const { data: status } = useAsync(() => backends.server.status(), [backends])

  const [step, setStep] = useState<Step>('source')
  const [testing, setTesting] = useState(false)
  const [sourceOk, setSourceOk] = useState(false)
  const [transfer, setTransfer] = useState<Transfer>('sync')
  const [disposition, setDisposition] = useState<Disposition>('keep')

  /**
   * Only needed by the restore route, and only asked for then.
   *
   * Restoring means reading the old machine's Backblaze repository, which needs
   * the credentials that wrote it. Provisioning writes them to
   * /etc/filesynapse/backup.env, and `restic restore` reads that file — so a
   * restore chosen without them would fail at the last step, after the transfer
   * route had already been decided and explained to the user.
   */
  const [b2Bucket, setB2Bucket] = useState('')
  const [b2KeyId, setB2KeyId] = useState('')
  const [b2AppKey, setB2AppKey] = useState('')
  const [resticPassword, setResticPassword] = useState('')

  const backupReady = Boolean(
    b2Bucket.trim() && b2KeyId.trim() && b2AppKey.trim() && resticPassword,
  )

  const [check, setCheck] = useState<Preflight | null>(null)
  const [run, setRun] = useState<ProvisionRun | null>(null)
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)

  const backup = status?.backup
  const cloudHealthy = isBackupCurrent(backup)

  useEffect(() => {
    preflight().then(setCheck)
  }, [])

  /**
   * Poll only while the runner is going.
   *
   * Keyed on `running` rather than on the run itself, so each poll does not tear
   * down and rebuild the interval and turn a 700ms poll into a tighter one.
   */
  useEffect(() => {
    if (!running) return
    const tick = async () => {
      const next = await provisionStatus()
      if (!next) return
      setRun(next)
      if (!next.running) {
        setRunning(false)
        if (!next.failed) {
          setRole('host')
          setStep('handover')
        }
      }
    }
    void tick()
    const id = window.setInterval(tick, 700)
    return () => window.clearInterval(id)
  }, [running, setRole])

  const runTest = async () => {
    setTesting(true)
    const res = await testConnection(connection, credentials)
    setTesting(false)
    setSourceOk(res.overall === 'healthy')
    show(res.message)
  }

  const beginReplace = async () => {
    setStarting(true)
    const started = await startProvision({
      photosFolder: photoFolder,
      filesFolder: fileFolder,
      // The real name, so the services are configured for the name this machine
      // will answer to once the copy is verified — NEXTCLOUD_TRUSTED_DOMAINS in
      // particular, which would reject the real name if it were set to the
      // temporary one.
      tailscaleName: connection.address || 'filesynapse',
      // …but it joins the tailnet under a temporary name, so the working server
      // keeps answering until then. The handover step is where the name moves.
      tailscaleTempName: `${connection.address || 'filesynapse'}-new`,
      transfer,
      sourceAddress: connection.address || undefined,
      // Only the restore route needs these: it reads the old machine's
      // repository rather than the old machine. Sync ignores them.
      b2Bucket: transfer === 'restore' ? b2Bucket.trim() || undefined : undefined,
      b2KeyId: transfer === 'restore' ? b2KeyId.trim() || undefined : undefined,
      b2AppKey: transfer === 'restore' ? b2AppKey.trim() || undefined : undefined,
      resticPassword: transfer === 'restore' ? resticPassword || undefined : undefined,
    })
    setStarting(false)
    if (!started) {
      show('Could not start provisioning — this needs the desktop app, run on the machine becoming the server')
      return
    }
    setRunning(true)
  }

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
            aria-label="Back to settings"
            size="small"
            onClick={() => go('settings')}
          />
          <Heading as="h1" variant="medium">
            Replace your server
          </Heading>
        </header>

        <StepBar current={step} />

        {step === 'source' && (
          <Panel title="The server being replaced">
            <Body>
              This machine will take over from the server below. It is provisioned under a temporary
              name first, and only adopts the real one once the copy has been verified — so the
              server you are using now stays up throughout.
            </Body>
            <Rows>
              <Row label="Current server" value={<code className="code-01">{connection.address || 'not set'}</code>} />
              <Row
                label="Test connection"
                last
                onAction={runTest}
                value={
                  testing ? (
                    <span style={{ color: 'var(--text-secondary)' }}>Testing…</span>
                  ) : sourceOk ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 'var(--spacing-02)',
                        color: 'var(--support-success)',
                      }}
                    >
                      <Icon name="check" filled />
                      Reachable
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-secondary)' }}>Test</span>
                  )
                }
              />
            </Rows>
            <CloudNotice backup={backup} healthy={cloudHealthy} />
            <Actions>
              <Button variant="primary" onClick={() => setStep('folders')}>
                Continue
              </Button>
            </Actions>
          </Panel>
        )}

        {step === 'folders' && (
          <Panel title="Where the libraries live on this machine">
            <Body>
              Two folders, one per role. Different disks are strongly preferred — that is what keeps
              a drive failure to one role instead of both — but it is a recommendation, not a
              requirement.
            </Body>
            <FolderField
              label="Photos folder"
              hint="Immich will manage this folder."
              value={photoFolder}
              onChange={setPhotoFolder}
            />
            <FolderField
              label="Cloud storage folder"
              hint="Documents and project files."
              value={fileFolder}
              onChange={setFileFolder}
            />
            {sameRoot(photoFolder, fileFolder) && (
              <Notice tone="warn">
                Both folders sit under the same path. This works, but a single disk failure would
                take both roles at once.
              </Notice>
            )}
            <Actions>
              <Button variant="default" onClick={() => setStep('source')}>
                Back
              </Button>
              <Button variant="primary" onClick={() => setStep('route')}>
                Continue
              </Button>
            </Actions>
          </Panel>
        )}

        {step === 'route' && (
          <Panel title="How the data comes across">
            <Body>Both routes are over the network. Pick by what you need to trust.</Body>

            {!cloudHealthy && backup && (
              <Notice tone="warn">
                Cloud backup is not current — the last successful run was{' '}
                {formatClock(backup.lastRunAt)}. Restoring from it is not offered, because the old
                machine may be the only up-to-date copy of your data. It must stay alive until the
                transfer has finished and been verified.
              </Notice>
            )}

            <RouteCard
              selected={transfer === 'sync'}
              onSelect={() => setTransfer('sync')}
              title="Sync from the old server"
              detail="Fast on the same network, and copies the current state exactly. Needs the old server to stay up and healthy until the copy finishes."
            />
            <RouteCard
              selected={transfer === 'restore'}
              onSelect={() => setTransfer('restore')}
              disabled={!cloudHealthy}
              title="Restore from the latest backup"
              detail={
                cloudHealthy
                  ? `Works even if the old server is already dead, and restores a known-good snapshot${
                      backup ? ` (${formatClock(backup.lastRunAt)})` : ''
                    }. Slower, bounded by download speed, and loses anything since that backup.`
                  : 'Unavailable while the cloud backup is stale or unreachable.'
              }
            />

            {transfer === 'restore' && (
              <>
                <Body>
                  Restoring reads the backup repository itself rather than the old
                  machine, so it needs the credentials that wrote it — the same
                  values the old server was given when it was set up.
                </Body>
                <TextField
                  label="Bucket name"
                  value={b2Bucket}
                  onChange={setB2Bucket}
                  placeholder="my-filesynapse"
                />
                <TextField label="B2 key ID" value={b2KeyId} onChange={setB2KeyId} />
                <TextField label="B2 application key" value={b2AppKey} onChange={setB2AppKey} secret />
                <TextField
                  label="restic password"
                  value={resticPassword}
                  onChange={setResticPassword}
                  secret
                />
                <Footnote>
                  Without these the restore fails at its last step, after the
                  machine has already been configured.
                </Footnote>
              </>
            )}

            <Actions>
              <Button variant="default" onClick={() => setStep('folders')}>
                Back
              </Button>
              <Button
                variant="primary"
                onClick={() => setStep('provision')}
                disabled={transfer === 'restore' && !backupReady}
              >
                Continue
              </Button>
            </Actions>
          </Panel>
        )}

        {step === 'provision' && (
          <Panel title="Provision">
            {run ? (
              <>
                <Body>
                  Running on this machine under a temporary Tailscale name, so the server you are
                  using now keeps answering.
                </Body>
                <EventList events={run.events} />
                {run.failed && (
                  <Notice tone="warn">
                    The run stopped at the step above. This machine has not taken over and the old
                    server is untouched — the detail is in
                    /var/log/filesynapse-provision.log on this machine.
                  </Notice>
                )}
              </>
            ) : (
              <>
                <Body>
                  These are the steps this machine will run, under a temporary Tailscale name so the
                  current server keeps answering:
                </Body>
                <StepList
                  lines={[
                    'Checking Docker',
                    `Creating photos folder at ${photoFolder}`,
                    `Creating cloud folder at ${fileFolder}`,
                    "Fetching Immich's own compose, and writing Nextcloud's",
                    transfer === 'sync'
                      ? 'Syncing from the current server'
                      : 'Restoring the latest restic snapshot',
                    'Starting Immich',
                    'Starting Nextcloud',
                    'Configuring Tailscale on a temporary name',
                    'Scheduling nightly backup',
                  ]}
                />

                {/* The unavailable path says why rather than being absent, the
                    same rule the "set up this computer" screen follows. */}
                {check && !check.ok ? (
                  <Notice tone="warn">
                    <strong>This machine cannot be provisioned.</strong>{' '}
                    {check.blockers.join(' ')}
                  </Notice>
                ) : (
                  <Notice tone="info">
                    Provisioning runs on <strong>this</strong> machine, the one becoming the server,
                    and needs the desktop app — a browser cannot install packages. The old server
                    stays up and serving until the copy is verified and the name is swapped.
                  </Notice>
                )}
              </>
            )}

            <Actions>
              <Button variant="default" onClick={() => setStep('route')} disabled={running}>
                Back
              </Button>
              {!run && !(check && !check.ok) && (
                <Button variant="primary" onClick={() => void beginReplace()} disabled={starting}>
                  {starting ? 'Starting…' : 'Start provisioning'}
                </Button>
              )}
              {run && !running && (
                <Button
                  variant="primary"
                  onClick={() => (run.failed ? setRun(null) : setStep('handover'))}
                >
                  {run.failed ? 'Try again' : 'Continue'}
                </Button>
              )}
            </Actions>
            <Footnote>
              {run
                ? running
                  ? 'Running. The transfer is the long part — this can take a while.'
                  : run.failed
                    ? 'Nothing was switched over.'
                    : 'Finished. The old server has still not been touched.'
                : 'Nothing runs until you start it.'}
            </Footnote>
          </Panel>
        )}

        {step === 'handover' && (
          <Panel title="What happens to the old machine">
            <Body>
              The copy is across, but the old machine still holds everything. Decide its fate only
              after the new server has been verified and has completed its own backup — until then
              it is a real second copy, not a spare.
            </Body>

            <StepList
              lines={[
                'Verify the copy — file counts and spot-checks',
                'Run a backup from this machine, and test a restore',
                'Release the name on the old machine, then claim it here',
              ]}
            />
            <Notice tone="warn">
              This machine joined the tailnet as{' '}
              <code className="code-01">{`${connection.address || 'filesynapse'}-new`}</code>, so the
              server you are replacing kept answering. The swap is deliberately left to you, because
              it must not happen until the copy is verified: two machines cannot hold one name, and
              swapping early cuts you off from the working one. On the old machine run{' '}
              <code className="code-01">sudo tailscale down</code>, then on this one{' '}
              <code className="code-01">
                sudo tailscale up --hostname {connection.address || 'filesynapse'}
              </code>
              . Your phones and laptops then reach this machine at the name they already use, with
              nothing to reconfigure.
            </Notice>

            <RouteCard
              selected={disposition === 'keep'}
              onSelect={() => setDisposition('keep')}
              title="Keep it as a second backup target"
              detail="It stops serving photos and files, and becomes a second restic destination alongside Backblaze — a copy on hardware you already own, that costs nothing extra and does not depend on your internet connection. This is the strongest option available to you."
            />
            <RouteCard
              selected={disposition === 'wipe'}
              onSelect={() => setDisposition('wipe')}
              title="Wipe its photos and files storage"
              detail="Frees both drives so the machine can be repurposed or disposed of."
            />

            {disposition === 'wipe' && !cloudHealthy && (
              <Notice tone="warn">
                Backblaze was last confirmed {formatClock(backup?.lastRunAt ?? null)}, so wiping now
                would leave a <strong>single copy</strong> of everything until this machine completes
                its first backup. Let that finish first, or keep the old machine instead.
              </Notice>
            )}

            <Actions>
              <Button variant="default" onClick={() => setStep('provision')}>
                Back
              </Button>
              <Button variant="primary" onClick={() => go('server')}>
                Done
              </Button>
            </Actions>
          </Panel>
        )}
      </Stack>
    </div>
  )
}

function CloudNotice({ backup, healthy }: { backup: BackupStatus | undefined; healthy: boolean }) {
  if (!backup) return null
  return (
    <Notice tone={healthy ? 'info' : 'warn'}>
      {healthy ? (
        <>
          Cloud backup is current — last run {formatClock(backup.lastRunAt)}, {backup.snapshotCount}{' '}
          snapshots. Both transfer routes are available, and the old machine becomes a spare once the
          copy is verified.
        </>
      ) : (
        <>
          Cloud backup is not current — last successful run {formatClock(backup.lastRunAt)}. Treat the
          old machine as the only up-to-date copy until the transfer is verified.
        </>
      )}
    </Notice>
  )
}

function StepBar({ current }: { current: Step }) {
  const index = STEPS.findIndex((s) => s.id === current)
  return (
    <div
      className="label-01"
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-03)' }}
    >
      {STEPS.map((s, i) => {
        const active = i === index
        const done = index >= 0 && i < index
        return (
          <span key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-03)' }}>
            {i > 0 && <span style={{ color: 'var(--text-helper)' }}>›</span>}
            <span
              style={{
                color: active
                  ? 'var(--text-primary)'
                  : done
                    ? 'var(--text-secondary)'
                    : 'var(--text-helper)',
                fontWeight: active ? 600 : 400,
              }}
            >
              {s.label}
            </span>
          </span>
        )
      })}
    </div>
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
    <p className="helper-text-01" style={{ color: 'var(--text-helper)', marginTop: 'calc(var(--spacing-02) * -1)' }}>
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

function FolderField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
}) {
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
    </FormControl>
  )
}

function TextField({
  label,
  value,
  onChange,
  secret,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  secret?: boolean
  placeholder?: string
}) {
  return (
    <FormControl>
      <FormControl.Label>{label}</FormControl.Label>
      <TextInput
        block
        type={secret ? 'password' : 'text'}
        value={value}
        aria-label={label}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormControl>
  )
}

function RouteCard({
  selected,
  onSelect,
  title,
  detail,
  disabled,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  detail: string
  disabled?: boolean
}) {
  const on = selected && !disabled
  return (
    <div
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onSelect()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onSelect()
        }
      }}
      style={{
        display: 'flex',
        gap: 'var(--spacing-04)',
        padding: 'var(--spacing-05)',
        border: `1px solid ${on ? 'var(--border-interactive)' : 'var(--border-subtle-01)'}`,
        background: on ? 'var(--background-selected)' : 'var(--layer-01)',
        borderRadius: 'var(--border-radius-medium)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          border: `1px solid ${on ? 'var(--interactive)' : 'var(--border-strong-01)'}`,
          flexShrink: 0,
          marginTop: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {on && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--interactive)' }} />}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-02)' }}>
        <span className="heading-compact-01" style={{ color: 'var(--text-primary)' }}>
          {title}
        </span>
        <span className="body-compact-01" style={{ color: 'var(--text-secondary)' }}>
          {detail}
        </span>
      </span>
    </div>
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
  onAction,
  last,
}: {
  label: string
  value: React.ReactNode
  onAction?: () => void
  last?: boolean
}) {
  return (
    <div
      onClick={onAction}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--spacing-04)',
        padding: 'var(--spacing-04) var(--spacing-05)',
        borderBottom: last ? 'none' : '1px solid var(--border-subtle-01)',
        cursor: onAction ? 'pointer' : undefined,
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

function Notice({ tone, children }: { tone: 'info' | 'warn'; children: React.ReactNode }) {
  // `InlineMessage` lays its icon and body out as two grid cells, so its body
  // must be a single element — loose text nodes would each become their own
  // cell and push the copy into a sliver.
  return (
    <InlineMessage variant={tone === 'warn' ? 'warning' : undefined}>
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
