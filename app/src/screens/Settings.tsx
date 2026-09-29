import { useEffect, useState } from 'react'
import { Button, FormControl, Label, SegmentedControl, TextInput, ToggleSwitch } from '@primer/react'
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

const THEMES: ThemeChoice[] = ['system', 'light', 'dark']

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
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        padding: 'var(--spacing-06) var(--spacing-07)',
        background: 'var(--background)',
      }}
    >
      <div style={{ maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 'var(--spacing-07)' }}>
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
          <Row last block>
            <span className="helper-text-01" style={{ color: 'var(--text-helper)' }}>
              {isNative()
                ? "Stored in this computer's OS keychain — Windows Credential Manager, macOS Keychain, or libsecret. Never written to a plaintext file."
                : 'Held for this session only in a browser. The desktop build keeps them in the OS keychain.'}
            </span>
          </Row>
        </Group>

        <Group title="Photos">
          <Row last={!( !photosInApp && isHost )}>
            <span>Photo viewer</span>
            <SegmentedControl
              aria-label="Photo viewer"
              size="small"
              onChange={(index) => (index === 0 ? setPhotoMode('inapp') : chooseOsMode(setPhotoMode, isHost))}
            >
              <SegmentedControl.Button selected={photosInApp}>In-app</SegmentedControl.Button>
              <SegmentedControl.Button selected={!photosInApp}>System viewer</SegmentedControl.Button>
            </SegmentedControl>
          </Row>
          {!photosInApp && isHost && (
            <Row last>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-01)' }}>
                <span>Photos folder</span>
                <code className="code-01" style={{ color: 'var(--text-secondary)' }}>
                  {photoFolder}
                </code>
              </span>
              <Button size="small" onClick={() => go('timeline')}>
                Change location
              </Button>
            </Row>
          )}
        </Group>

        <Group title="Files">
          <Row last={!( !filesInApp && isHost )}>
            <span>File browser</span>
            <SegmentedControl
              aria-label="File browser"
              size="small"
              onChange={(index) => (index === 0 ? setFileMode('inapp') : chooseOsMode(setFileMode, isHost))}
            >
              <SegmentedControl.Button selected={filesInApp}>In-app</SegmentedControl.Button>
              <SegmentedControl.Button selected={!filesInApp}>System explorer</SegmentedControl.Button>
            </SegmentedControl>
          </Row>
          {!filesInApp && isHost && (
            <Row last>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-01)' }}>
                <span>Files folder</span>
                <code className="code-01" style={{ color: 'var(--text-secondary)' }}>
                  {fileFolder}
                </code>
              </span>
              <Button size="small" onClick={() => go('files')}>
                Change location
              </Button>
            </Row>
          )}
        </Group>

        <Group title="Server">
          <Row>
            <span>This device</span>
            <span style={{ color: isHost ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              {role === 'host' ? 'Storage server' : 'Client'}
            </span>
          </Row>
          <Row>
            <span>Address</span>
            <code
              className="code-01"
              style={{
                color: 'var(--text-secondary)',
                background: 'var(--field-02)',
                padding: 'var(--spacing-01) var(--spacing-03)',
                borderRadius: 'var(--border-radius-small)',
              }}
            >
              {connection.address || 'not set'}
            </code>
          </Row>
          <Row interactive onClick={runTest}>
            <span>Test connection</span>
            {testing ? (
              <span style={{ color: 'var(--text-secondary)' }}>Testing…</span>
            ) : connectionState === 'healthy' ? (
              <Label variant="success">Healthy</Label>
            ) : (
              <span style={{ color: 'var(--text-placeholder)' }}>→</span>
            )}
          </Row>
          {role === 'client' && (
            <Row interactive onClick={() => go('replace-server')}>
              <span>Replace this server…</span>
              <span style={{ color: 'var(--text-placeholder)' }}>›</span>
            </Row>
          )}
          <Row
            last
            interactive
            danger
            onClick={() => {
              resetConnection()
              show('Disconnected')
            }}
          >
            <span>Disconnect</span>
          </Row>
        </Group>

        <Group title="Appearance">
          <Row last>
            <span>Theme</span>
            <SegmentedControl
              aria-label="Theme"
              size="small"
              onChange={(index) => setTheme(THEMES[index])}
            >
              {THEMES.map((t) => (
                <SegmentedControl.Button key={t} selected={theme === t}>
                  {t[0].toUpperCase() + t.slice(1)}
                </SegmentedControl.Button>
              ))}
            </SegmentedControl>
          </Row>
        </Group>

        <Group title="Storage">
          <Row>
            <span>Thumbnail cache</span>
            <span style={{ color: 'var(--text-secondary)' }}>
              {cached.count === 0
                ? 'Empty'
                : `${cached.count} image${cached.count === 1 ? '' : 's'} · ${compactBytes(cached.bytes)}`}
            </span>
          </Row>
          <Row
            interactive
            danger
            onClick={() => {
              clearCache()
              show('Cache cleared — visible thumbnails will reload')
            }}
          >
            <span>Clear cache</span>
          </Row>
          <Row last block>
            <span className="helper-text-01" style={{ color: 'var(--text-helper)' }}>
              This is the session cache. Nothing is kept on disk yet, so a restart starts cold and
              the cache cannot speed up a first load — see for-human.md.
            </span>
          </Row>
        </Group>

        <Group title="Desktop">
          <LaunchAtLogin />
          <TrayToggle />
        </Group>

        <Group title="About">
          <Row>
            <span>Version</span>
            <code className="code-01" style={{ color: 'var(--text-secondary)' }}>
              {version ?? 'development build'} ·{' '}
              {status ? 'server reachable' : 'server unreachable'}
            </code>
          </Row>
          <Row last interactive onClick={() => show('Licences: React (MIT), DM Sans & DM Mono (OFL)')}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--spacing-02)',
                color: 'var(--link-primary)',
              }}
            >
              Open-source licences
              <Icon name="external" size={16} />
            </span>
          </Row>
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
      <Row>
        <span>Launch at login</span>
        <span className="helper-text-01" style={{ color: 'var(--text-helper)' }}>
          Needs the desktop app
        </span>
      </Row>
    )
  }

  return (
    <Row>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-01)' }}>
        <span id="launch-at-login">Launch at login</span>
        <span className="helper-text-01" style={{ color: 'var(--text-helper)' }}>
          Start hidden in the tray when you sign in.
        </span>
      </span>
      <ToggleSwitch
        aria-labelledby="launch-at-login"
        checked={on === true}
        loading={pending}
        onChange={async (checked) => {
          if (pending) return
          setPending(true)
          const ok = await setAutostart(checked)
          setOn(ok ? checked : on)
          if (!ok) show('Could not change the login item')
          setPending(false)
        }}
      />
    </Row>
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
      <Row last>
        <span>Tray icon</span>
        <span className="helper-text-01" style={{ color: 'var(--text-helper)' }}>
          Needs the desktop app
        </span>
      </Row>
    )
  }

  return (
    <Row last>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-01)' }}>
        <span id="tray-icon">Tray icon</span>
        <span className="helper-text-01" style={{ color: 'var(--text-helper)' }}>
          Shows backup state without opening the window.
        </span>
      </span>
      <ToggleSwitch
        aria-labelledby="tray-icon"
        checked={on === true}
        onChange={async (checked) => {
          const ok = await setTrayEnabled(checked)
          setOn(ok ? checked : on)
          if (!ok) show(checked ? 'Could not show the tray icon' : 'Could not hide the tray icon')
        }}
      />
    </Row>
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
    <div style={{ padding: 'var(--spacing-04) var(--spacing-05)', borderBottom: '1px solid var(--border-subtle-01)' }}>
      <FormControl>
        <FormControl.Label>{label}</FormControl.Label>
        <TextInput
          type={secret ? 'password' : 'text'}
          value={value}
          aria-label={label}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          block
        />
      </FormControl>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-03)' }}>
      <h2 className="heading-compact-02" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h2>
      <div
        style={{
          border: '1px solid var(--border-subtle-01)',
          borderRadius: 'var(--border-radius-medium)',
          overflow: 'hidden',
          background: 'var(--layer-01)',
        }}
      >
        {children}
      </div>
    </section>
  )
}

/** One settings row: a name, a control, and a hairline under all but the last. */
function Row({
  children,
  last,
  interactive,
  danger,
  block,
  onClick,
}: {
  children: React.ReactNode
  last?: boolean
  interactive?: boolean
  danger?: boolean
  block?: boolean
  onClick?: () => void
}) {
  return (
    <div
      className={`body-compact-01${interactive ? ' hoverable' : ''}`}
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: block ? 'column' : 'row',
        alignItems: block ? 'stretch' : 'center',
        justifyContent: 'space-between',
        gap: 'var(--spacing-05)',
        padding: 'var(--spacing-04) var(--spacing-05)',
        borderBottom: last ? undefined : '1px solid var(--border-subtle-01)',
        color: danger ? 'var(--text-error)' : 'var(--text-primary)',
        cursor: interactive ? 'pointer' : undefined,
      }}
    >
      {children}
    </div>
  )
}
