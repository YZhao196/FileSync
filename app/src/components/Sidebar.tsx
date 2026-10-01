import { Button, NavList, Stack } from '@primer/react'
// The indicators below read the status the backup watcher already polls rather
// than fetching their own — see `serverStatus` in the store. Fetching here meant
// once per mount, which for a window that lives in the tray is once per launch:
// the sidebar could show "Immich running" for days while the tray beside it
// said otherwise. UI-DESKTOP.md asks for this "at a glance", and a glance is
// only worth taking if it is current.
import { formatClock } from '../lib/format'
import { modShortcut } from '../lib/platform'
import { useApp, type Screen } from '../state/store'
import { carbonIcon, Icon } from './Icon'

/**
 * A navigation entry, built on BuildNexus `NavList.Item`.
 *
 * Rendered as a real `button` (`as="button"`) because navigation here is a
 * state change via `go()`, not an address the browser can follow — so the item
 * keeps the original `role="button"` semantics and its Enter/Space handling,
 * now provided by the element itself rather than hand-rolled keydown code.
 */
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
    <NavList.Item
      as="button"
      type="button"
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      onClick={() => !disabled && go(screen)}
    >
      {label}
      {trailing && <NavList.TrailingVisual>{trailing}</NavList.TrailingVisual>}
    </NavList.Item>
  )
}

/** The warning mark a "setting up" item carries. Status never relies on colour
 *  alone, so the glyph sits beside the item's own word. */
function SetupMark() {
  return <Icon name="alert" filled size={16} style={{ color: 'var(--support-warning)' }} />
}

export function Sidebar() {
  const { photoMode, fileMode, go, isLean, setSearchOpen, serverStatus: status } = useApp()

  const showPhotoSection = photoMode === 'choose' || photoMode === 'inapp'
  const showFileSection = fileMode === 'choose' || fileMode === 'inapp'

  const immich = status?.services.find((s) => s.name === 'Immich')

  // With nothing to browse there is nothing to navigate — the status panel is
  // the whole app, and a 224px column would only duplicate it. Settings moves
  // to a corner control instead (see LeanCorner).
  if (isLean) return null

  const tailscaleUp = status?.network.tailscaleConnected ?? false
  const immichRunning = immich?.state === 'running'

  return (
    <div
      style={{
        width: 224,
        borderRight: '1px solid var(--border-subtle-01)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflowY: 'auto',
        background: 'var(--layer-01)',
      }}
    >
      {photoMode === 'inapp' && (
        <div style={{ padding: 'var(--spacing-03)' }}>
          <Button
            block
            variant="default"
            alignContent="start"
            leadingVisual={carbonIcon('search')}
            trailingVisual={
              <kbd className="label-01" style={{ color: 'var(--text-placeholder)' }}>
                {modShortcut('K')}
              </kbd>
            }
            onClick={() => setSearchOpen(true)}
            aria-label="Open search"
          >
            Search
          </Button>
        </div>
      )}

      <NavList aria-label="Sections">
        {showPhotoSection && (
          <NavList.Group title="Photos" hideDivider>
            {photoMode === 'choose' && (
              <NavItem screen="timeline" label="Setting up" trailing={<SetupMark />} />
            )}
            {photoMode === 'inapp' && (
              <>
                <NavItem screen="timeline" label="Timeline" />
                <NavItem screen="albums" label="Albums" />
              </>
            )}
          </NavList.Group>
        )}

        {showFileSection && (
          <NavList.Group title="Files" hideDivider>
            {fileMode === 'choose' && (
              <NavItem screen="files" label="Setting up" trailing={<SetupMark />} />
            )}
            {fileMode === 'inapp' && <NavItem screen="files" label="Browser" />}
          </NavList.Group>
        )}
      </NavList>

      <div style={{ padding: 'var(--spacing-02) var(--spacing-03) var(--spacing-03)' }}>
        <div
          className="label-01"
          style={{
            color: 'var(--text-secondary)',
            fontWeight: 600,
            padding: 'var(--spacing-02) 0',
          }}
        >
          Server
        </div>
        <div
          style={{
            background: 'var(--layer-02)',
            borderRadius: 'var(--border-radius-medium)',
            padding: 'var(--spacing-04)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-03)',
          }}
        >
          <Stack direction="horizontal" justify="space-between" align="center">
            <span className="label-01" style={{ color: 'var(--text-secondary)' }}>
              Tailscale
            </span>
            <Stack
              direction="horizontal"
              align="center"
              gap="condensed"
              style={{ color: tailscaleUp ? 'var(--support-success)' : 'var(--support-error)' }}
            >
              <Icon name={tailscaleUp ? 'check' : 'alert'} filled size={16} />
              <span className="body-compact-01">{tailscaleUp ? 'connected' : 'off'}</span>
            </Stack>
          </Stack>

          <Stack direction="horizontal" justify="space-between" align="center">
            <span className="label-01" style={{ color: 'var(--text-secondary)' }}>
              Immich
            </span>
            <Stack
              direction="horizontal"
              align="center"
              gap="condensed"
              style={immichRunning ? { color: 'var(--support-success)' } : undefined}
            >
              {immichRunning && <Icon name="check" filled size={16} />}
              <span
                className="body-compact-01"
                style={immichRunning ? undefined : { color: 'var(--text-secondary)' }}
              >
                {immich?.state ?? '—'}
              </span>
            </Stack>
          </Stack>

          <Stack direction="horizontal" justify="space-between" align="center">
            <span className="label-01" style={{ color: 'var(--text-secondary)' }}>
              Last backup
            </span>
            <span className="body-compact-01">{formatClock(status?.backup.lastRunAt ?? null)}</span>
          </Stack>

          <div style={{ height: 1, background: 'var(--border-subtle-01)' }} />

          <Button
            variant="link"
            size="small"
            onClick={() => go('server')}
            style={{ alignSelf: 'flex-start' }}
          >
            View full status
          </Button>
        </div>
      </div>

      <div
        style={{
          marginTop: 'auto',
          borderTop: '1px solid var(--border-subtle-01)',
          padding: 'var(--spacing-03)',
        }}
      >
        <NavList aria-label="Settings">
          <NavItem screen="settings" label="Settings" />
        </NavList>
      </div>
    </div>
  )
}
