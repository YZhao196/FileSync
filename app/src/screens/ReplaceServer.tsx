import { useState } from 'react'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toaster'
import { testConnection } from '../core/client'
import type { BackupStatus } from '../core/types'
import { useAsync } from '../hooks/useAsync'
import { isBackupCurrent } from '../lib/backup'
import { formatClock } from '../lib/format'
import { sameRoot } from '../lib/paths'
import { pickFolder } from '../native/bridge'
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

  const backup = status?.backup
  const cloudHealthy = isBackupCurrent(backup)

  const runTest = async () => {
    setTesting(true)
    const res = await testConnection(connection, credentials)
    setTesting(false)
    setSourceOk(res.overall === 'healthy')
    show(res.message)
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        background: 'var(--surf2)',
        padding: '28px 32px 40px',
      }}
    >
      <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn--sm" onClick={() => go('settings')} aria-label="Back to settings">
            <Icon name="back" size={13} />
          </button>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--tx)' }}>Replace your server</h1>
        </header>

        <StepBar current={step} />

        {step === 'source' && (
          <Panel title="The server being replaced">
            <p style={p}>
              This machine will take over from the server below. It is provisioned under a temporary
              name first, and only adopts the real one once the copy has been verified — so the
              server you are using now stays up throughout.
            </p>
            <div className="group">
              <div className="group__item">
                <span>Current server</span>
                <code style={code}>{connection.address || 'not set'}</code>
              </div>
              <div className="group__item group__item--action" onClick={runTest}>
                <span>Test connection</span>
                <span style={{ fontSize: 12, color: sourceOk ? 'var(--ok)' : 'var(--txm)' }}>
                  {testing ? 'Testing…' : sourceOk ? '● Reachable' : 'Test'}
                </span>
              </div>
            </div>
            <CloudNotice backup={backup} healthy={cloudHealthy} />
            <Actions>
              <button className="btn btn--primary" onClick={() => setStep('folders')}>
                Continue
              </button>
            </Actions>
          </Panel>
        )}

        {step === 'folders' && (
          <Panel title="Where the libraries live on this machine">
            <p style={p}>
              Two folders, one per role. Different disks are strongly preferred — that is what keeps
              a drive failure to one role instead of both — but it is a recommendation, not a
              requirement.
            </p>
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
              <button className="btn" onClick={() => setStep('source')}>
                Back
              </button>
              <button className="btn btn--primary" onClick={() => setStep('route')}>
                Continue
              </button>
            </Actions>
          </Panel>
        )}

        {step === 'route' && (
          <Panel title="How the data comes across">
            <p style={p}>Both routes are over the network. Pick by what you need to trust.</p>

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

            <Actions>
              <button className="btn" onClick={() => setStep('folders')}>
                Back
              </button>
              <button className="btn btn--primary" onClick={() => setStep('provision')}>
                Continue
              </button>
            </Actions>
          </Panel>
        )}

        {step === 'provision' && (
          <Panel title="Provision">
            <p style={p}>
              These are the steps this machine will run, under a temporary Tailscale name so the
              current server keeps answering:
            </p>
            <StepList
              lines={[
                'Checking Docker',
                `Creating photos folder at ${photoFolder}`,
                `Creating cloud folder at ${fileFolder}`,
                'Writing mount configuration',
                transfer === 'sync'
                  ? 'Syncing from the current server'
                  : 'Restoring the latest restic snapshot',
                'Starting Immich',
                'Starting Nextcloud',
                'Configuring Tailscale on a temporary name',
                'Scheduling nightly backup',
              ]}
            />

            <Notice tone="info">
              <strong>Not implemented.</strong> Provisioning is the outstanding item in
              for-human.md — this screen documents the flow, it does not run it. Once it exists, the
              transfer and verification happen before anything is switched over.
            </Notice>

            <Actions>
              <button className="btn" onClick={() => setStep('route')}>
                Back
              </button>
              <button
                className="btn btn--primary"
                onClick={() => {
                  setRole('host')
                  setStep('handover')
                }}
              >
                Mark this PC as the server
              </button>
            </Actions>
            <p style={{ ...p, fontSize: 11, color: 'var(--txd)', marginTop: -4 }}>
              That button only updates the app's own role — no provisioning has run.
            </p>
          </Panel>
        )}

        {step === 'handover' && (
          <Panel title="What happens to the old machine">
            <p style={p}>
              The copy is across, but the old machine still holds everything. Decide its fate only
              after the new server has been verified and has completed its own backup — until then
              it is a real second copy, not a spare.
            </p>

            <StepList
              lines={[
                'Verify the copy — file counts and spot-checks',
                'Run a backup from this machine, and test a restore',
                'Swap the Tailscale name over to this machine',
              ]}
            />
            <Notice tone="warn">
              The name swap must come before either option below. Two machines cannot hold one
              Tailscale name, and swapping early cuts you off from the working server.
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
              <button className="btn" onClick={() => setStep('provision')}>
                Back
              </button>
              <button className="btn btn--primary" onClick={() => go('server')}>
                Done
              </button>
            </Actions>
          </Panel>
        )}
      </div>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      {STEPS.map((s, i) => {
        const active = i === index
        const done = index >= 0 && i < index
        return (
          <span key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {i > 0 && <span style={{ color: 'var(--txd)' }}>›</span>}
            <span
              style={{
                color: active ? 'var(--acc)' : done ? 'var(--tx2)' : 'var(--txd)',
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
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--tx)' }}>{title}</h2>
      {children}
    </section>
  )
}

function StepList({ lines }: { lines: string[] }) {
  return (
    <ol
      style={{
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        fontFamily: "'DM Mono', monospace",
        fontSize: 12,
      }}
    >
      {lines.map((line) => (
        <li key={line} style={{ display: 'flex', gap: 8, color: 'var(--tx2)' }}>
          <span style={{ color: 'var(--txd)' }}>○</span>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span className="field-label">{label}</span>
      <span className="hint">{hint}</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input"
          value={value}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        />
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
    </div>
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
        gap: 10,
        padding: 14,
        border: `1px solid ${selected && !disabled ? 'var(--acc)' : 'var(--bd)'}`,
        background: selected && !disabled ? 'var(--accbg)' : 'var(--surf)',
        borderRadius: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span
        style={{
          width: 15,
          height: 15,
          borderRadius: '50%',
          border: `1.5px solid ${selected && !disabled ? 'var(--acc)' : 'var(--bd)'}`,
          flexShrink: 0,
          marginTop: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected && !disabled && (
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--acc)' }} />
        )}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <strong style={{ fontSize: 13, color: 'var(--tx)' }}>{title}</strong>
        <span style={{ fontSize: 12, color: 'var(--tx2)', lineHeight: 1.5 }}>{detail}</span>
      </span>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'info' | 'warn'; children: React.ReactNode }) {
  const warn = tone === 'warn'
  return (
    <div
      style={{
        fontSize: 12,
        lineHeight: 1.55,
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--bd)',
        background: warn ? 'var(--warnbg)' : 'var(--surf)',
        color: warn ? 'var(--warn)' : 'var(--tx2)',
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
  background: 'var(--surf2)',
  padding: '2px 8px',
  borderRadius: 3,
}
