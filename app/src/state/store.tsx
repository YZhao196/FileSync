import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Backends } from '../core/backends'
import { createBackends, deriveConnection, EMPTY_CREDENTIALS } from '../core/client'
import { isNative, saveCredentials, loadCredentials } from '../native/bridge'
import type { Connection, ConnectionState, Credentials } from '../core/types'

export type Screen =
  | 'first-run'
  | 'timeline'
  | 'albums'
  | 'album'
  | 'files'
  | 'server'
  | 'settings'
  | 'replace-server'
  | 'provision'
export type ModuleState = 'choose' | 'inapp' | 'native' | 'native-pick'
export type ThemeChoice = 'system' | 'light' | 'dark'

/**
 * Which album a screen is showing.
 *
 * Carried alongside the screen rather than encoded in a URL: nothing here is
 * linkable, and a router would be a dependency bought for one parameter.
 */
export interface NavTarget {
  albumId?: string
  albumName?: string
  /** Folder to open in the Files browser, so search results can land on it. */
  filePath?: string
}

/**
 * Whether this machine is the storage server or a client pointing at one.
 *
 * Declared at First Run — the app cannot reliably detect it, since the server
 * is reached by a Tailscale name that need not match this host's own name.
 * It decides which controls are meaningful locally: the folder a library lives
 * in belongs to the server, so only the server may change it.
 */
export type DeviceRole = 'host' | 'client'

const STORAGE_KEY = 'filesynapse.settings.v1'

/**
 * Credentials are kept in two places:
 * - Session storage: fast synchronous cache; survives a reload, cleared on close.
 * - OS keychain (native only): durable; loaded on first mount and written on every
 *   change. Backed by Windows Credential Manager, macOS Keychain, or libsecret.
 *   See `native/bridge.ts` — `saveCredentials` / `loadCredentials`.
 *
 * Nothing sensitive is ever written to a plaintext file on disk (PLAN.md §11).
 */
const CREDS_KEY = 'filesynapse.credentials.session'

interface Persisted {
  theme: ThemeChoice
  connection: Connection
  photoMode: ModuleState
  fileMode: ModuleState
  photoFolder: string
  fileFolder: string
  role: DeviceRole
  /**
   * Whether to offer the local caption-and-decide pipeline.
   *
   * Off by default, and off means nothing reaches the agent at all: the server
   * does no background work, so the CPU cost of this being enabled is zero until
   * the user opens a surface that asks for it. Immich's own ML container already
   * covers semantic search, which is why this is a choice rather than a default.
   */
  decisionPipeline: boolean
}

const DEFAULTS: Persisted = {
  theme: 'system',
  connection: { address: '', immichUrl: null, nextcloudUrl: null, agentUrl: null },
  photoMode: 'choose',
  fileMode: 'choose',
  photoFolder: '~/Pictures/immich',
  fileFolder: '~/Nextcloud/FileSynapse',
  role: 'client',
  decisionPipeline: false,
}

/** Reads persisted settings, adopting only keys that still exist — so a field
 *  removed from `Persisted` is dropped from storage rather than lingering. */
function loadCreds(): Credentials {
  try {
    const raw = sessionStorage.getItem(CREDS_KEY)
    if (!raw) return EMPTY_CREDENTIALS
    return { ...EMPTY_CREDENTIALS, ...(JSON.parse(raw) as Partial<Credentials>) }
  } catch {
    return EMPTY_CREDENTIALS
  }
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const p = JSON.parse(raw) as Partial<Persisted>
    return {
      theme: p.theme ?? DEFAULTS.theme,
      connection: p.connection ?? DEFAULTS.connection,
      photoMode: p.photoMode ?? DEFAULTS.photoMode,
      fileMode: p.fileMode ?? DEFAULTS.fileMode,
      photoFolder: p.photoFolder ?? DEFAULTS.photoFolder,
      fileFolder: p.fileFolder ?? DEFAULTS.fileFolder,
      role: p.role ?? DEFAULTS.role,
      decisionPipeline: p.decisionPipeline ?? DEFAULTS.decisionPipeline,
    }
  } catch {
    return DEFAULTS
  }
}

export interface AppApi extends Persisted {
  /** Both modules handed to the OS: the app is a bare server monitor. */
  isLean: boolean
  /** This machine is the storage server, so it owns the library folders. */
  isHost: boolean
  setRole: (r: DeviceRole) => void
  resolvedTheme: 'light' | 'dark'
  setTheme: (t: ThemeChoice) => void
  connectionState: ConnectionState
  setConnectionState: (s: ConnectionState) => void
  setAddress: (address: string, overrides?: Partial<Connection>) => void
  credentials: Credentials
  setCredentials: (c: Credentials) => void
  screen: Screen
  nav: NavTarget
  go: (s: Screen, target?: NavTarget) => void
  /** Search is a palette over whatever screen you are on, so its state belongs
   *  to the app rather than to any one screen. */
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void
  setPhotoMode: (m: ModuleState) => void
  setFileMode: (m: ModuleState) => void
  setPhotoFolder: (p: string) => void
  setFileFolder: (p: string) => void
  setDecisionPipeline: (on: boolean) => void
  resetConnection: () => void
  backends: Backends
}

const AppContext = createContext<AppApi | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Persisted>(load)
  const [connectionState, setConnectionState] = useState<ConnectionState>('unconfigured')
  const [credentials, setCredentials] = useState<Credentials>(loadCreds)

  /**
   * Set once the initial keychain load has completed (or immediately when
   * not running natively). Guards against overwriting stored credentials
   * with the empty initial state before the async load returns.
   */
  const [keychainReady, setKeychainReady] = useState(!isNative())

  const [screen, setScreen] = useState<Screen>(state.connection.address ? 'server' : 'first-run')
  const [nav, setNav] = useState<NavTarget>({})
  const [searchOpen, setSearchOpen] = useState(false)

  const [systemDark, setSystemDark] = useState(
    () => globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  )

  useEffect(() => {
    const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolvedTheme: 'light' | 'dark' =
    state.theme === 'system' ? (systemDark ? 'dark' : 'light') : state.theme

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
  }, [resolvedTheme])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Storage may be unavailable (private mode); settings simply don't persist.
    }
  }, [state])

  const patch = useCallback((p: Partial<Persisted>) => setState((s) => ({ ...s, ...p })), [])

  // On first mount inside the Tauri shell, load persisted credentials from the
  // OS keychain (Windows Credential Manager / macOS Keychain / libsecret).
  useEffect(() => {
    if (!isNative()) return
    loadCredentials()
      .then((saved) => {
        if (Object.values(saved).some(Boolean)) {
          setCredentials((prev) => ({ ...prev, ...(saved as Partial<Credentials>) }))
        }
      })
      .catch((err: unknown) => console.warn('[store] keychain load failed', err))
      .finally(() => setKeychainReady(true))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist credentials: sessionStorage for fast in-session access, keychain
  // for survival across app restarts. The keychain write is gated on
  // `keychainReady` so the initial empty state never overwrites stored entries.
  useEffect(() => {
    try {
      sessionStorage.setItem(CREDS_KEY, JSON.stringify(credentials))
    } catch {
      // Session storage may be unavailable; credentials simply don't survive a reload.
    }
    if (keychainReady && isNative()) {
      saveCredentials(credentials as unknown as Record<string, string>).catch(
        (err: unknown) => console.warn('[store] keychain save failed', err),
      )
    }
  }, [credentials, keychainReady])

  const setAddress = useCallback(
    (address: string, overrides?: Partial<Connection>) => {
      patch({ connection: { ...deriveConnection(address), ...overrides } })
    },
    [patch],
  )

  const backends = useMemo(
    () => createBackends(state.connection, credentials),
    [state.connection, credentials],
  )

  const api = useMemo<AppApi>(
    () => ({
      ...state,
      isLean: state.photoMode === 'native' && state.fileMode === 'native',
      isHost: state.role === 'host',
      setRole: (role) => patch({ role }),
      resolvedTheme,
      setTheme: (theme) => patch({ theme }),
      connectionState,
      setConnectionState,
      setAddress,
      credentials,
      setCredentials,
      screen,
      nav,
      go: (s, target) => {
        setNav(target ?? {})
        setScreen(s)
        setSearchOpen(false)
      },
      searchOpen,
      setSearchOpen,
      setPhotoMode: (photoMode) => patch({ photoMode }),
      setFileMode: (fileMode) => patch({ fileMode }),
      setPhotoFolder: (photoFolder) => patch({ photoFolder }),
      setFileFolder: (fileFolder) => patch({ fileFolder }),
      setDecisionPipeline: (decisionPipeline) => patch({ decisionPipeline }),
      resetConnection: () => {
        patch({ connection: DEFAULTS.connection })
        setConnectionState('unconfigured')
        setNav({})
        setScreen('first-run')
      },
      backends,
    }),
    [
      state,
      resolvedTheme,
      connectionState,
      setAddress,
      credentials,
      screen,
      nav,
      searchOpen,
      patch,
      backends,
    ],
  )

  return <AppContext.Provider value={api}>{children}</AppContext.Provider>
}

export function useApp(): AppApi {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}
