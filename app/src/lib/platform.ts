/**
 * Platform-aware vocabulary.
 *
 * `⌘` means nothing on Windows, and "Finder" means nothing on Linux — so the
 * shortcuts and file-manager names the UI shows are resolved per OS. The
 * platform cannot change at runtime, so this is computed once at import.
 *
 * The pure parts are exported separately so all three branches can be tested
 * without three machines.
 */

export type Platform = 'macos' | 'windows' | 'linux'

const PLATFORMS: readonly Platform[] = ['macos', 'windows', 'linux']

/**
 * `?platform=windows` overrides detection so every variant can be reviewed on
 * one machine. Development affordance only.
 */
export function platformFrom(userAgent: string, search: string): Platform {
  const override = new URLSearchParams(search).get('platform')
  if (override && (PLATFORMS as readonly string[]).includes(override)) {
    return override as Platform
  }
  if (/mac/i.test(userAgent)) return 'macos'
  if (/win/i.test(userAgent)) return 'windows'
  return 'linux'
}

function detect(): Platform {
  if (typeof window === 'undefined') return 'linux'
  return platformFrom(navigator.userAgent, window.location.search)
}

export const platform: Platform = detect()

/** The platform's primary modifier, as printed on the keyboard. */
export const modifierFor = (p: Platform): string => (p === 'macos' ? '⌘' : 'Ctrl')

/** `shortcutFor('macos', 'K')` → `⌘K`; `shortcutFor('windows', 'K')` → `Ctrl+K`. */
export function shortcutFor(p: Platform, key: string): string {
  const mod = modifierFor(p)
  return p === 'macos' ? `${mod}${key}` : `${mod}+${key}`
}

export const modShortcut = (key: string): string => shortcutFor(platform, key)

export const fileManagerFor = (p: Platform): string =>
  p === 'macos' ? 'Finder' : p === 'windows' ? 'File Explorer' : 'your file manager'

/** The OS file manager, named the way its users know it. */
export const FILE_MANAGER = fileManagerFor(platform)
