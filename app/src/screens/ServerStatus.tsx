import { useState } from 'react'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toaster'
import type { DriveUsage, ServiceStatus } from '../core/types'
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
  const { data: status, loading, error, reload } = useAsync(() => backends.server.status(), [backends])
  const [backing, setBacking] = useState(false)

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
      show(`Could not restart ${svc.name} — see for-human.md`)
    }
  }

  if (loading) return <Centered>Loading server status…</Centered>
  if (error) {
    return (
      <Centered>
        <div style={{ color: 'var(--danger)', marginBottom: 10 }}>{error}</div>
        <button className="btn" onClick={reload}>
          Retry
        </button>
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
        padding: isLean ? '56px 20px 20px' : 20,
        background: 'var(--surf2)',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <section className="card" style={{ padding: 18 }}>
          <div className="card__label">Services</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {status.services.map((svc) => (
              <div key={svc.name} className="row">
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--tx)' }}>
                  <span className={svc.state === 'running' ? 'dot dot--ok' : 'dot dot--bad'}>●</span>
                  {svc.name}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 11,
                      color: svc.state === 'running' ? 'var(--ok)' : 'var(--danger)',
                    }}
                  >
                    {svc.state}
                  </span>
                  <button className="btn btn--xs btn" onClick={() => restart(svc)}>
                    Restart
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="card" style={{ padding: 18 }}>
          <div className="card__label">Storage</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {status.drives.map((d) => (
              <StorageBar key={d.label} drive={d} />
            ))}
          </div>
        </section>

        <section className="card" style={{ padding: 18 }}>
          <div className="card__label">Backup</div>
          <div className="statlist">
            <div className="row">
              <span style={{ color: 'var(--tx2)' }}>Last run</span>
              <span style={{ color: 'var(--tx)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {formatClock(status.backup.lastRunAt)}
                <Icon
                  name={status.backup.lastRunOk ? 'check' : 'alert'}
                  size={12}
                  style={{ color: status.backup.lastRunOk ? 'var(--ok)' : 'var(--danger)' }}
                />
              </span>
            </div>
            <div className="row">
              <span style={{ color: 'var(--tx2)' }}>Next scheduled</span>
              <span style={{ color: 'var(--tx)' }}>{formatClock(status.backup.nextRunAt)}</span>
            </div>
            <div className="row">
              <span style={{ color: 'var(--tx2)' }}>Snapshots</span>
              <span style={{ color: 'var(--tx)' }}>{status.backup.snapshotCount}</span>
            </div>
            <div className="row">
              <span style={{ color: 'var(--tx2)' }}>Cloud total</span>
              <span style={{ color: 'var(--tx)' }}>{compactBytes(status.backup.cloudTotalBytes)}</span>
            </div>
          </div>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section className="card" style={{ padding: '16px 18px' }}>
            <div className="card__label">Network</div>
            <div className="statlist" style={{ gap: 7 }}>
              <div className="row">
                <span style={{ color: 'var(--tx2)' }}>Tailscale</span>
                <span
                  style={{
                    color: status.network.tailscaleConnected ? 'var(--ok)' : 'var(--danger)',
                    fontWeight: 500,
                    fontSize: 13,
                  }}
                >
                  ● {status.network.tailscaleConnected ? 'connected' : 'disconnected'}
                </span>
              </div>
              <div className="row">
                <span style={{ color: 'var(--tx2)' }}>Device</span>
                <span style={{ color: 'var(--tx)' }}>{status.network.deviceName}</span>
              </div>
              <div className="row">
                <span style={{ color: 'var(--tx2)' }}>Tailnet IP</span>
                <code style={{ fontSize: 12, color: 'var(--tx)' }}>{status.network.tailscaleIp}</code>
              </div>
            </div>
          </section>

          <section className="card" style={{ padding: '16px 18px' }}>
            <div className="card__label">Uptime</div>
            <div className="statlist" style={{ gap: 7 }}>
              <div className="row">
                <span style={{ color: 'var(--tx2)' }}>Uptime</span>
                <span style={{ color: 'var(--tx)' }}>{formatUptime(status.uptimeSeconds)}</span>
              </div>
              <div className="row">
                <span style={{ color: 'var(--tx2)' }}>Last boot</span>
                <span style={{ color: 'var(--tx)' }}>{formatDate(status.lastBootAt)}</span>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <button
          className="btn btn--primary"
          onClick={runBackup}
          disabled={backing}
          style={{ cursor: backing ? 'wait' : undefined }}
        >
          {backing ? 'Backing up…' : 'Back up now'}
        </button>
        <button
          className="btn"
          onClick={async () => {
            const ok = await openExternal(`http://${connection.address || 'espnas'}:9090`)
            if (!ok) show('Cockpit runs on the server — see for-human.md')
          }}
        >
          Open logs
          <Icon name="external" size={12} />
        </button>
        <button
          className="btn"
          onClick={async () => {
            const ok = await openExternal(`https://${connection.address || 'espnas'}:9443`)
            if (!ok) show('Portainer runs on the server — see for-human.md')
          }}
        >
          Containers
          <Icon name="external" size={12} />
        </button>
      </div>

      <div
        style={{
          marginTop: 16,
          padding: '12px 14px',
          border: '1px dashed var(--bd)',
          borderRadius: 8,
          fontSize: 12,
          color: 'var(--txm)',
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: 'var(--tx2)' }}>Status source: the host agent</strong>
        {' — '}
        restic state, disk usage and container health are not exposed by Immich or
        Nextcloud, so they come from a small agent running on the server
        (<code>infra/agent</code>). If this panel loaded, that agent is reachable.
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn--xs btn"
            onClick={() => {
              setPhotoMode('choose')
              go('timeline')
            }}
          >
            Configure photos
          </button>
          <button
            className="btn btn--xs btn"
            onClick={() => {
              setFileMode('choose')
              go('files')
            }}
          >
            Configure files
          </button>
          <button className="btn btn--xs btn" onClick={() => go('settings')}>
            Settings
          </button>
          {!healthy && <span style={{ color: 'var(--danger)', alignSelf: 'center' }}>A service is down.</span>}
        </div>
      </div>
    </div>
  )
}

function StorageBar({ drive }: { drive: DriveUsage }) {
  const pct = percent(drive.usedBytes, drive.totalBytes)
  const tone = pct >= 95 ? 'var(--danger)' : pct >= 85 ? 'var(--warn)' : 'var(--acc)'

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: 'var(--tx)' }}>{drive.label}</span>
        <span style={{ fontSize: 12, color: 'var(--tx2)' }}>
          {usedOverTotal(drive.usedBytes, drive.totalBytes)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={drive.label}
        style={{ height: 6, background: 'var(--skeleton)', borderRadius: 3, overflow: 'hidden' }}
      >
        <div style={{ height: '100%', width: `${pct}%`, background: tone, borderRadius: 3 }} />
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--txm)',
        fontSize: 13,
        gap: 4,
      }}
    >
      {children}
    </div>
  )
}
