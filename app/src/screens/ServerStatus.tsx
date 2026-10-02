import { useState } from 'react'
import { Button, Label, Stack } from '@primer/react'
import { Card } from '@primer/react/experimental'
import { carbonIcon, Icon } from '../components/Icon'
import { NeedsServer } from '../components/NeedsServer'
import { useToast } from '../components/Toaster'
import type { DriveUsage, ServiceState, ServiceStatus } from '../core/types'
import { useAsync } from '../hooks/useAsync'
import { compactBytes, formatClock, formatDate, formatUptime, percent, usedOverTotal } from '../lib/format'
import { openExternal } from '../native/bridge'
import { useApp } from '../state/store'

/**
 * Screen 2 — the main screen. In a lean app this is not one feature among
 * several; it is the app, and the tray icon summarises the same numbers.
 */
export function ServerStatus() {
  const { backends, connection, go, setPhotoMode, setFileMode, isLean } = useApp()
  const { show } = useToast()
  const { data: status, loading, error, reload } = useAsync(
    () => (backends ? backends.server.status() : Promise.resolve(null)),
    [backends],
  )
  const [backing, setBacking] = useState(false)

  // Nothing to report on without a server, and the panel is nothing but a
  // report. Placed after the hooks, which cannot be skipped, and before the
  // handlers below so they see a non-null `backends`.
  if (!backends) return <NeedsServer />

  const runBackup = async () => {
    if (backing) return
    setBacking(true)
    try {
      await backends.server.runBackup()
      show('Backup finished')
      reload()
    } catch (e) {
      show(e instanceof Error ? `Backup failed: ${e.message}` : 'Backup failed')
    } finally {
      setBacking(false)
    }
  }

  const restart = async (svc: ServiceStatus) => {
    try {
      await backends.server.restartService(svc.name)
      show(`${svc.name} restarted`)
      reload()
    } catch {
      show(`Could not restart ${svc.name} — see filesynapsetodo.md`)
    }
  }

  if (loading) return <Centered>Loading server status…</Centered>
  if (error) {
    return (
      <Centered>
        <span
          className="body-compact-01"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--spacing-02)',
            color: 'var(--text-error)',
            marginBottom: 'var(--spacing-04)',
          }}
        >
          <Icon name="alert" size={16} />
          {error}
        </span>
        <Button onClick={reload}>Retry</Button>
      </Centered>
    )
  }
  if (!status) return <Centered>No status available.</Centered>

  const healthy = status.services.every((s) => s.state === 'running')

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        // Clear the LeanCorner control when the sidebar is absent.
        padding: isLean ? '56px var(--spacing-05) var(--spacing-05)' : 'var(--spacing-05)',
        background: 'var(--background)',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-05)' }}>
        <Card as="section" aria-label="Services" padding="normal">
          <h2 className="heading-compact-02" style={{ color: 'var(--text-primary)' }}>
            Services
          </h2>
          <Stack direction="vertical" gap="condensed">
            {status.services.map((svc) => (
              <Stack key={svc.name} direction="horizontal" justify="space-between" align="center" gap="normal">
                <span className="body-compact-01" style={{ color: 'var(--text-primary)' }}>
                  {svc.name}
                </span>
                <Stack direction="horizontal" align="center" gap="condensed">
                  <ServiceStateLabel state={svc.state} />
                  <Button size="small" onClick={() => restart(svc)}>
                    Restart
                  </Button>
                </Stack>
              </Stack>
            ))}
          </Stack>
        </Card>

        <Card as="section" aria-label="Storage" padding="normal">
          <h2 className="heading-compact-02" style={{ color: 'var(--text-primary)' }}>
            Storage
          </h2>
          <Stack direction="vertical" gap="normal">
            {status.drives.map((d) => (
              <StorageBar key={d.label} drive={d} />
            ))}
          </Stack>
        </Card>

        <Card as="section" aria-label="Backup" padding="normal">
          <h2 className="heading-compact-02" style={{ color: 'var(--text-primary)' }}>
            Backup
          </h2>
          <Stack direction="vertical" gap="condensed">
            <StatRow label="Last run">
              {formatClock(status.backup.lastRunAt)}
              <Label variant={status.backup.lastRunOk ? 'success' : 'danger'}>
                {status.backup.lastRunOk ? 'Succeeded' : 'Failed'}
              </Label>
            </StatRow>
            <StatRow label="Next scheduled">{formatClock(status.backup.nextRunAt)}</StatRow>
            <StatRow label="Snapshots">{status.backup.snapshotCount}</StatRow>
            <StatRow label="Cloud total">{compactBytes(status.backup.cloudTotalBytes)}</StatRow>
          </Stack>
        </Card>

        <Stack direction="vertical" gap="condensed">
          <Card as="section" aria-label="Network" padding="normal">
            <h2 className="heading-compact-02" style={{ color: 'var(--text-primary)' }}>
              Network
            </h2>
            <Stack direction="vertical" gap="condensed">
              <StatRow label="Tailscale">
                <Label variant={status.network.tailscaleConnected ? 'success' : 'danger'}>
                  {status.network.tailscaleConnected ? 'Connected' : 'Disconnected'}
                </Label>
              </StatRow>
              <StatRow label="Device">{status.network.deviceName}</StatRow>
              <StatRow label="Tailnet IP">
                <span className="code-01">{status.network.tailscaleIp}</span>
              </StatRow>
            </Stack>
          </Card>

          <Card as="section" aria-label="Uptime" padding="normal">
            <h2 className="heading-compact-02" style={{ color: 'var(--text-primary)' }}>
              Uptime
            </h2>
            <Stack direction="vertical" gap="condensed">
              <StatRow label="Uptime">{formatUptime(status.uptimeSeconds)}</StatRow>
              <StatRow label="Last boot">{formatDate(status.lastBootAt)}</StatRow>
            </Stack>
          </Card>
        </Stack>
      </div>

      <Stack direction="horizontal" gap="condensed" wrap="wrap" style={{ marginTop: 'var(--spacing-06)' }}>
        <Button
          variant="primary"
          onClick={runBackup}
          disabled={backing}
          style={{ cursor: backing ? 'wait' : undefined }}
        >
          {backing ? 'Backing up…' : 'Back up now'}
        </Button>
        {/* Both run on the server box, so with no configured address there is
            nothing to open. They used to fall back to a hardcoded hostname,
            which was a placeholder pretending to be a default: the button
            appeared to work and opened a browser at a machine that may not
            exist. A control that cannot act is not a control. */}
        {connection.address && (
          <>
            <Button
              trailingVisual={carbonIcon('external')}
              onClick={async () => {
                const ok = await openExternal(`http://${connection.address}:9090`)
                if (!ok) show('Cockpit runs on the server — see filesynapsetodo.md')
              }}
            >
              Open logs
            </Button>
            <Button
              trailingVisual={carbonIcon('external')}
              onClick={async () => {
                const ok = await openExternal(`https://${connection.address}:9443`)
                if (!ok) show('Portainer runs on the server — see filesynapsetodo.md')
              }}
            >
              Containers
            </Button>
          </>
        )}
      </Stack>

      <div
        className="body-compact-01"
        style={{
          marginTop: 'var(--spacing-05)',
          padding: 'var(--spacing-04) var(--spacing-05)',
          border: '1px dashed var(--border-subtle-01)',
          borderRadius: 'var(--border-radius-medium)',
          color: 'var(--text-helper)',
        }}
      >
        <strong style={{ color: 'var(--text-secondary)' }}>Status source: the host agent</strong>
        {' — '}
        restic state, disk usage and container health are not exposed by Immich or
        Nextcloud, so they come from a small agent running on the server
        (<code className="code-01">infra/agent</code>). If this panel loaded, that agent is reachable.
        <Stack direction="horizontal" gap="condensed" wrap="wrap" style={{ marginTop: 'var(--spacing-03)' }}>
          <Button
            size="small"
            onClick={() => {
              setPhotoMode('choose')
              go('timeline')
            }}
          >
            Configure photos
          </Button>
          <Button
            size="small"
            onClick={() => {
              setFileMode('choose')
              go('files')
            }}
          >
            Configure files
          </Button>
          <Button size="small" onClick={() => go('settings')}>
            Settings
          </Button>
          {!healthy && (
            <span
              className="body-compact-01"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--spacing-02)',
                alignSelf: 'center',
                color: 'var(--text-error)',
              }}
            >
              <Icon name="alert" size={16} />A service is down.
            </span>
          )}
        </Stack>
      </div>
    </div>
  )
}

/** The service word is the meaning; `Label`'s hue only supports it. */
function ServiceStateLabel({ state }: { state: ServiceState }) {
  const variant = state === 'running' ? 'success' : state === 'starting' ? 'attention' : 'danger'
  return <Label variant={variant}>{state}</Label>
}

/** A label/value line; the value keeps its own inline layout for icon or label. */
function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack direction="horizontal" justify="space-between" align="center" gap="normal">
      <span className="body-compact-01" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </span>
      <span
        className="body-compact-01"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-03)', color: 'var(--text-primary)' }}
      >
        {children}
      </span>
    </Stack>
  )
}

function StorageBar({ drive }: { drive: DriveUsage }) {
  const pct = percent(drive.usedBytes, drive.totalBytes)
  const tone =
    pct >= 95 ? 'var(--support-error)' : pct >= 85 ? 'var(--support-warning)' : 'var(--background-brand)'

  return (
    <div>
      <Stack direction="horizontal" justify="space-between" align="baseline" style={{ marginBottom: 'var(--spacing-02)' }}>
        <span className="body-compact-01" style={{ color: 'var(--text-primary)' }}>
          {drive.label}
        </span>
        <span className="label-01" style={{ color: 'var(--text-secondary)' }}>
          {usedOverTotal(drive.usedBytes, drive.totalBytes)}
        </span>
      </Stack>
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={drive.label}
        style={{ height: 6, background: 'var(--layer-accent-01)', borderRadius: 'var(--border-radius-small)', overflow: 'hidden' }}
      >
        <div style={{ height: '100%', width: `${pct}%`, background: tone, borderRadius: 'var(--border-radius-small)' }} />
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="body-compact-01"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-helper)',
        gap: 'var(--spacing-02)',
      }}
    >
      {children}
    </div>
  )
}
