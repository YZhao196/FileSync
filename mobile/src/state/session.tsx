/**
 * Who the app is talking to, and whether it is allowed to.
 *
 * The desktop keeps this in `state/store.tsx` alongside navigation, theming and
 * a dozen other things. This is narrower on purpose: connection and credentials
 * are the only state that has to exist before any screen can render, and
 * everything else a screen needs is either local to it or fetched from the
 * backends.
 *
 * The split between the two stores of state mirrors the desktop's:
 *
 *   - **The address is a setting.** It is not a secret, it is small, and losing
 *     it on reinstall is an annoyance rather than a security event. It goes in
 *     AsyncStorage.
 *   - **The credentials are secrets.** They go in the OS keystore, through
 *     `platform/credentials.ts`, and never anywhere else.
 *
 * `backends` is created from the pair and rebuilt whenever either changes, so a
 * screen never holds a backend bound to a server the user has since left.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
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
import type { Connection, Credentials } from '../core/types'
import { clearCredentials, loadCredentials, saveCredentials } from '../platform/credentials'

const ADDRESS_KEY = 'filesynapse.address'

interface Session {
  /** False until the stored address and credentials have been read. */
  ready: boolean
  connection: Connection
  credentials: Credentials
  /** True once there is an address to talk to. Drives which navigator renders. */
  configured: boolean
  backends: Backends
  /** Persists the address and rebuilds the backends. */
  connect: (address: string) => Promise<void>
  setCredentials: (creds: Credentials) => Promise<void>
  /** Settings → Disconnect. Forgets the address and every stored credential. */
  disconnect: () => Promise<void>
}

const SessionContext = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [address, setAddress] = useState('')
  const [credentials, setCredentialsState] = useState<Credentials>(EMPTY_CREDENTIALS)

  useEffect(() => {
    let cancelled = false

    // Both reads are independent, so they run together rather than in sequence.
    Promise.all([AsyncStorage.getItem(ADDRESS_KEY), loadCredentials()])
      .then(([storedAddress, storedCredentials]) => {
        // A slow read that resolved after unmount would otherwise set state on
        // a screen that is gone — React warns about it and it is a real leak.
        if (cancelled) return
        setAddress(storedAddress ?? '')
        setCredentialsState(storedCredentials)
      })
      .catch(() => {
        // A keystore that refuses to open is not fatal: the app falls back to
        // the First Run screen, which is the correct place to be when we cannot
        // say who the user is.
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const connection = useMemo(() => deriveConnection(address), [address])

  const connect = useCallback(async (next: string) => {
    setAddress(next)
    await AsyncStorage.setItem(ADDRESS_KEY, next)
  }, [])

  const setCredentials = useCallback(async (creds: Credentials) => {
    setCredentialsState(creds)
    await saveCredentials(creds)
  }, [])

  const disconnect = useCallback(async () => {
    setAddress('')
    setCredentialsState(EMPTY_CREDENTIALS)
    await Promise.all([AsyncStorage.removeItem(ADDRESS_KEY), clearCredentials()])
  }, [])

  const backends = useMemo(() => createBackends(connection, credentials), [connection, credentials])

  const value = useMemo<Session>(
    () => ({
      ready,
      connection,
      credentials,
      configured: connection.address !== '',
      backends,
      connect,
      setCredentials,
      disconnect,
    }),
    [ready, connection, credentials, backends, connect, setCredentials, disconnect],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession was called outside a SessionProvider')
  return session
}
