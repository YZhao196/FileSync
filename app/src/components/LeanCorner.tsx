import { IconButton } from '@primer/react'
import { useApp } from '../state/store'
import { carbonIcon } from './Icon'

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
    <IconButton
      icon={carbonIcon(onSettings ? 'back' : 'settings')}
      aria-label={label}
      variant="default"
      onClick={() => go(onSettings ? 'server' : 'settings')}
      style={{
        position: 'absolute',
        top: 'var(--spacing-04)',
        right: 'var(--spacing-04)',
        zIndex: 20,
      }}
    />
  )
}
