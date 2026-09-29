import { useApp } from '../state/store'
import { Icon } from './Icon'

/**
 * The only chrome in the lean state, where both modules are handed to the OS
 * and the sidebar steps aside. It swaps between the two screens still reachable
 * — the status panel and Settings. Without it, hiding the sidebar would strand
 * you on Settings with no way back.
 */
export function LeanCorner() {
  const { screen, go, isLean } = useApp()
  if (!isLean) return null

  const onSettings = screen === 'settings'
  const label = onSettings ? 'Back to status' : 'Settings'

  return (
    <button
      className="btn btn--sm"
      onClick={() => go(onSettings ? 'server' : 'settings')}
      title={label}
      aria-label={label}
      style={{
        position: 'absolute',
        top: 12,
        right: 14,
        zIndex: 20,
        background: 'var(--surf)',
      }}
    >
      <Icon name={onSettings ? 'back' : 'settings'} size={14} />
    </button>
  )
}
