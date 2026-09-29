import { useAsync } from '../hooks/useAsync'
import { formatClock } from '../lib/format'
import { modShortcut } from '../lib/platform'
import { useApp, type Screen } from '../state/store'
import { Icon } from './Icon'

function NavItem({
  screen,
  label,
  trailing,
  disabled,
}: {
  screen: Screen
  label: string
  trailing?: React.ReactNode
  disabled?: boolean
}) {
  const { screen: current, go } = useApp()
  const active = current === screen

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-current={active ? 'page' : undefined}
      onClick={() => !disabled && go(screen)}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          go(screen)
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 10px',
        borderRadius: 6,
        fontSize: 13,
        lineHeight: '20px',
        cursor: disabled ? 'default' : 'pointer',
        userSelect: 'none',
        background: active ? 'var(--accbg)' : 'transparent',
        color: disabled ? 'var(--txd)' : active ? 'var(--acc)' : 'var(--tx)',
        fontWeight: active ? 600 : 400,
      }}
    >
      <span>{label}</span>
      {trailing}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: 'var(--txm)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        padding: '2px 0 5px',
      }}
    >
      {children}
    </div>
  )
}

export function Sidebar() {
  const { photoMode, fileMode, go, backends, isLean, setSearchOpen } = useApp()
  const { data: status } = useAsync(() => backends.server.status(), [backends])

  const showPhotoSection = photoMode === 'choose' || photoMode === 'inapp'
  const showFileSection = fileMode === 'choose' || fileMode === 'inapp'

  const immich = status?.services.find((s) => s.name === 'Immich')

  // With nothing to browse there is nothing to navigate — the status panel is
  // the whole app, and a 224px column would only duplicate it. Settings moves
  // to a corner control instead (see LeanCorner).
  if (isLean) return null

  return (
    <nav
      aria-label="Sections"
      style={{
        width: 224,
        borderRight: '1px solid var(--bd)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflowY: 'auto',
        background: 'var(--surf)',
      }}
    >
      {photoMode === 'inapp' && (
        <div style={{ padding: '12px 12px 6px' }}>
          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Open search"
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'var(--surf2)',
              border: '1px solid var(--bd)',
              borderRadius: 8,
              padding: '6px 10px',
              gap: 6,
              width: '100%',
              cursor: 'pointer',
            }}
          >
            <Icon name="search" size={12} style={{ color: 'var(--txm)' }} />
            <span style={{ flex: 1, fontSize: 13, color: 'var(--txm)', textAlign: 'left' }}>Search…</span>
            <kbd style={{ fontSize: 9, color: 'var(--txd)', padding: '2px 5px', whiteSpace: 'nowrap' }}>
              {modShortcut('K')}
            </kbd>
          </button>
        </div>
      )}

      {showPhotoSection && (
        <div style={{ padding: '6px 12px 2px' }}>
          <SectionLabel>Photos</SectionLabel>
          {photoMode === 'choose' && (
            <NavItem
              screen="timeline"
              label="Setting up"
              trailing={<span style={{ fontSize: 9, color: 'var(--warn)' }}>●</span>}
            />
          )}
          {photoMode === 'inapp' && (
            <>
              <NavItem screen="timeline" label="Timeline" />
              <NavItem screen="albums" label="Albums" />
            </>
          )}
        </div>
      )}

      {showFileSection && (
        <div style={{ padding: '6px 12px 2px' }}>
          <SectionLabel>Files</SectionLabel>
          {fileMode === 'choose' && (
            <NavItem
              screen="files"
              label="Setting up"
              trailing={<span style={{ fontSize: 9, color: 'var(--warn)' }}>●</span>}
            />
          )}
          {fileMode === 'inapp' && <NavItem screen="files" label="Browser" />}
        </div>
      )}

      <div style={{ padding: '6px 12px 2px' }}>
        <SectionLabel>Server</SectionLabel>
        <div
          style={{
            margin: '4px 0 6px',
            background: 'var(--surf2)',
            borderRadius: 6,
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
          }}
        >
          <div className="row">
            <span style={{ fontSize: 12, color: 'var(--tx2)' }}>Tailscale</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: status?.network.tailscaleConnected ? 'var(--ok)' : 'var(--danger)',
              }}
            >
              ● {status?.network.tailscaleConnected ? 'connected' : 'off'}
            </span>
          </div>
          <div className="row">
            <span style={{ fontSize: 12, color: 'var(--tx2)' }}>Immich</span>
            <span style={{ fontSize: 11, color: immich?.state === 'running' ? 'var(--ok)' : 'var(--txm)' }}>
              {immich?.state ?? '—'}
            </span>
          </div>
          <div className="row">
            <span style={{ fontSize: 12, color: 'var(--tx2)' }}>Last backup</span>
            <span style={{ fontSize: 11, color: 'var(--tx)' }}>{formatClock(status?.backup.lastRunAt ?? null)}</span>
          </div>
          <div style={{ height: 1, background: 'var(--bd)' }} />
          <div
            role="button"
            tabIndex={0}
            onClick={() => go('server')}
            onKeyDown={(e) => e.key === 'Enter' && go('server')}
            style={{ fontSize: 12, color: 'var(--acc)', cursor: 'pointer' }}
          >
            Full status →
          </div>
        </div>
      </div>

      <div style={{ marginTop: 'auto', borderTop: '1px solid var(--bd)', padding: '8px 12px' }}>
        <NavItem screen="settings" label="Settings" />
      </div>
    </nav>
  )
}
