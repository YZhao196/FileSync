import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toaster'
import { testConnection } from '../core/client'
import { useApp, type ModuleState, type ThemeChoice } from '../state/store'
import { useAsync } from '../hooks/useAsync'
import { clearCache, subscribeCache, cacheStats } from '../lib/thumbCache'
import { compactBytes } from '../lib/format'
import {
  appInfo,
  getAutostart,
  getTrayEnabled,
  isNative,
  setAutostart,
  setTrayEnabled,
} from '../native/bridge'

export function Settings() {
  const {
    photoMode,
    fileMode,
    setPhotoMode,
    setFileMode,
    photoFolder,
    fileFolder,
    connection,
    credentials,
    setCredentials,
    connectionState,
    setConnectionState,
    theme,
    setTheme,
    resetConnection,
    backends,
    go,
    role,
    isHost,
  } = useApp()
  const { show } = useToast()

  const [testing, setTesting] = useState(false)

  // The version is read from the shell rather than kept as a constant here. A
  // second copy is a second thing to forget to bump, and the one on screen
  // would then disagree with the binary it is describing.
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    appInfo()
      .then((info) => setVersion(info?.version ?? null))
      .catch(() => setVersion(null))
  }, [])
  const [cached, setCached] = useState(cacheStats())

  const { data: status } = useAsync(() => backends.server.status(), [backends])
  const photosInApp = photoMode === 'inapp'
  const filesInApp = fileMode === 'inapp'

  // Re-read the cache figures whenever a clear happens, so the number on screen
  // is the number that was actually released.
  useEffect(() => {
    const sync = () => setCached(cacheStats())
    sync()
    return subscribeCache(sync)
  }, [])

  const runTest = async () => {
    setTesting(true)
    const res = await testConnection(connection, credentials)
    setConnectionState(res.overall)
    setTesting(false)
    show(res.message)
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '24px 32px', background: 'var(--surf2)' }}>
      <div style={{ maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <Group title="Server credentials">
          <CredField
            label="Immich API key"
            value={credentials.immichApiKey}
            onChange={(v) => setCredentials({ ...credentials, immichApiKey: v })}
            secret
          />
          <CredField
            label="Nextcloud user"
            value={credentials.nextcloudUser}
            onChange={(v) => setCredentials({ ...credentials, nextcloudUser: v })}
          />
          <CredField
            label="Nextcloud app password"
            value={credentials.nextcloudAppPassword}
            onChange={(v) => setCredentials({ ...credentials, nextcloudAppPassword: v })}
            secret
          />
          <CredField
            label="Agent token"
            value={credentials.agentToken}
            onChange={(v) => setCredentials({ ...credentials, agentToken: v })}
            secret
          />
          <div className="group__item" style={{ display: 'block' }}>
            <span className="hint">
              {isNative()
                ? "Stored in this computer's OS keychain — Windows Credential Manager, macOS Keychain, or libsecret. Never written to a plaintext file."
                : 'Held for this session only in a browser. The desktop build keeps them in the OS keychain.'}
            </span>
          </div>
        </Group>

        <Group title="Photos">
          <div className="group__item">
            <span>Photo viewer</span>
            <Segmented
              options={[
                { label: 'In-app', active: photosInApp, onSelect: () => setPhotoMode('inapp') },
                {
                  label: 'System viewer',
                  active: !photosInApp,
                  onSelect: () => chooseOsMode(setPhotoMode, isHost),
                },
              ]}
            />
          </div>
          {!photosInApp && isHost && (
            <div className="group__item">
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>Photos folder</span>
                <code style={{ fontSize: 11, color: 'var(--tx2)' }}>{photoFolder}</code>
              </span>
              <button className="btn btn--sm" onClick={() => go('timeline')}>
                Change location
              </button>
            </div>
          )}
        </Group>

        <Group title="Files">
          <div className="group__item">
            <span>File browser</span>
            <Segmented
              options={[
                { label: 'In-app', active: filesInApp, onSelect: () => setFileMode('inapp') },
                {
                  label: 'System explorer',
                  active: !filesInApp,
                  onSelect: () => chooseOsMode(setFileMode, isHost),
                },
              ]}
            />
          </div>
          {!filesInApp && isHost && (
            <div className="group__item">
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>Files folder</span>
                <code style={{ fontSize: 11, color: 'var(--tx2)' }}>{fileFolder}</code>
              </span>
              <button className="btn btn--sm" onClick={() => go('files')}>
                Change location
              </button>
            </div>
          )}
        </Group>

        <Group title="Server">
          <div className="group__item">
            <span>This device</span>
            <span style={{ fontSize: 12, color: isHost ? 'var(--ok)' : 'var(--tx2)' }}>
              {role === 'host' ? 'Storage server' : 'Client'}
            </span>
          </div>
          <div className="group__item">
            <span>Address</span>
            <code style={{ fontSize: 12, color: 'var(--tx2)', background: 'var(--surf2)', padding: '2px 8px', borderRadius: 3 }}>
              {connection.address || 'not set'}
            </code>
          </div>
          <div className="group__item group__item--action" onClick={runTest}>
            <span>Test connection</span>
            <span style={{ fontSize: 12, color: connectionState === 'healthy' ? 'var(--ok)' : 'var(--txm)' }}>
              {testing ? 'Testing…' : connectionState === 'healthy' ? '● Healthy' : '→'}
            </span>
          </div>
          {role === 'client' && (
            <div className="group__item group__item--action" onClick={() => go('replace-server')}>
              <span>Replace this server…</span>
              <span style={{ color: 'var(--txd)' }}>›</span>
            </div>
          )}
          <div
            className="group__item group__item--danger"
            onClick={() => {
              resetConnection()
              show('Disconnected')
            }}
          >
            <span>Disconnect</span>
          </div>
        </Group>

        <Group title="Appearance">
          <div className="group__item">
            <span>Theme</span>
            <Segmented
              options={(['system', 'light', 'dark'] as ThemeChoice[]).map((t) => ({
                label: t[0].toUpperCase() + t.slice(1),
                active: theme === t,
                onSelect: () => setTheme(t),
              }))}
            />
          </div>
        </Group>

        <Group title="Storage">
          <div className="group__item">
            <span>Thumbnail cache</span>
            <span style={{ fontSize: 13, color: 'var(--tx2)' }}>
              {cached.count === 0
                ? 'Empty'
                : `${cached.count} image${cached.count === 1 ? '' : 's'} · ${compactBytes(cached.bytes)}`}
            </span>
          </div>
          <div
            className="group__item group__item--danger"
            onClick={() => {
              clearCache()
              show('Cache cleared — visible thumbnails will reload')
            }}
          >
            <span>Clear cache</span>
          </div>
          <div className="group__item" style={{ display: 'block' }}>
            <span className="hint">
              This is the session cache. Nothing is kept on disk yet, so a restart starts cold and
              the cache cannot speed up a first load — see for-human.md.
            </span>
          </div>
        </Group>

        <Group title="Desktop">
          <LaunchAtLogin />
          <TrayToggle />
        </Group>

        <Group title="About">
          <div className="group__item">
            <span>Version</span>
            <code style={{ fontSize: 12, color: 'var(--tx2)' }}>
              {version ?? 'development build'} ·{' '}
              {status ? 'server reachable' : 'server unreachable'}
            </code>
          </div>
          <div className="group__item group__item--action" onClick={() => show('Licences: React (MIT), DM Sans & DM Mono (OFL)')}>
            <span style={{ color: 'var(--acc)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Open-source licences
              <Icon name="external" size={12} />
            </span>
          </div>
        </Group>
      </div>
    </div>
  )
}

/**
 * Choosing an OS viewer is a two-step flow on the host — pick it, then confirm
 * which folder that library lives in. A client has no folder of its own to
 * choose: the path belongs to the server, so it takes the mode directly.
 */
function chooseOsMode(setter: (m: ModuleState) => void, isHost: boolean) {
  setter(isHost ? 'native-pick' : 'native')
}

/**
 * Launch at login, read and written through the shell's autostart plugin.
 *
 * In a browser there is no such setting, and the row says so rather than
 * offering a switch that silently does nothing.
 */
function LaunchAtLogin() {
  const { show } = useToast()
  const [on, setOn] = useState<boolean | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!isNative()) return
    getAutostart().then(setOn)
  }, [])

  if (!isNative()) {
    return (
      <div className="group__item">
        <span>Launch at login</span>
        <span style={{ fontSize: 12, color: 'var(--txm)' }}>Needs the desktop app</span>
      </div>
    )
  }

  return (
    <div className="group__item">
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>Launch at login</span>
        <span className="hint">Start hidden in the tray when you sign in.</span>
      </span>
      <Segmented
        options={[
          {
            label: 'On',
            active: on === true,
            onSelect: async () => {
              if (pending) return
              setPending(true)
              const ok = await setAutostart(true)
              setOn(ok ? true : on)
              if (!ok) show('Could not change the login item')
              setPending(false)
            },
          },
          {
            label: 'Off',
            active: on === false,
            onSelect: async () => {
              if (pending) return
              setPending(true)
              const ok = await setAutostart(false)
              setOn(ok ? false : on)
              if (!ok) show('Could not change the login item')
              setPending(false)
            },
          },
        ]}
      />
    </div>
  )
}

/**
 * The tray icon toggle. PLAN.md §11 calls the tray the reason this app runs at
 * all — three numbers visible without opening anything — so it gets a switch
 * rather than being silently always on.
 */
function TrayToggle() {
  const { show } = useToast()
  const [on, setOn] = useState<boolean | null>(null)

  useEffect(() => {
    if (!isNative()) return
    getTrayEnabled().then(setOn)
  }, [])

  if (!isNative()) {
    return (
      <div className="group__item">
        <span>Tray icon</span>
        <span style={{ fontSize: 12, color: 'var(--txm)' }}>Needs the desktop app</span>
      </div>
    )
  }

  return (
    <div className="group__item">
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>Tray icon</span>
        <span className="hint">Shows backup state without opening the window.</span>
      </span>
      <Segmented
        options={[
          {
            label: 'Show',
            active: on === true,
            onSelect: async () => {
              const ok = await setTrayEnabled(true)
              setOn(ok ? true : on)
              if (!ok) show('Could not show the tray icon')
            },
          },
          {
            label: 'Hide',
            active: on === false,
            onSelect: async () => {
              const ok = await setTrayEnabled(false)
              setOn(ok ? false : on)
              if (!ok) show('Could not hide the tray icon')
            },
          },
        ]}
      />
    </div>
  )
}

function CredField({
  label,
  value,
  onChange,
  secret,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  secret?: boolean
}) {
  return (
    <div className="group__item" style={{ display: 'block' }}>
      <label className="field-label" style={{ display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <input
        className="input"
        type={secret ? 'password' : 'text'}
        value={value}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="section-title">{title}</h2>
      <div className="group">{children}</div>
    </section>
  )
}

function Segmented({
  options,
}: {
  options: ReadonlyArray<{ label: string; active: boolean; onSelect: () => void }>
}) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button
          key={o.label}
          className={`seg__opt${o.active ? ' seg__opt--active' : ''}`}
          onClick={o.onSelect}
          aria-pressed={o.active}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
