import { useState } from 'react'
import { deriveConnection, testConnection } from '../core/client'
import type { TestResult } from '../core/types'
import { useApp } from '../state/store'

/**
 * Screen 1 — the wizard. Both paths ship in every build: finishing the first is
 * what creates the server the second connects to, so they are sequential rather
 * than alternatives.
 */
export function FirstRun() {
  const { setAddress, connection, credentials, setConnectionState, go, setRole } = useApp()

  const [address, setLocalAddress] = useState(connection.address || 'espnas')
  const [state, setState] = useState<'idle' | 'testing' | 'done' | 'failed'>('idle')
  const [result, setResult] = useState<TestResult | null>(null)

  const runTest = async () => {
    if (state === 'testing') return
    setState('testing')

    // One name in, three endpoints out — the port map lives in `deriveConnection`
    // and nowhere else, so a changed port cannot drift between the two paths.
    const conn = deriveConnection(address)
    setAddress(address)
    const res = await testConnection(conn, credentials)

    setResult(res)
    setConnectionState(res.overall)
    if (res.overall === 'healthy') {
      // Connecting to a server that already exists makes this machine a client.
      setRole('client')
      setState('done')
      go('server')
    } else {
      setState('failed')
    }
  }

  const buttonLabel =
    state === 'testing' ? 'Testing…' : state === 'done' ? 'Connected' : 'Test connection'

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surf2)',
        overflow: 'auto',
        padding: 40,
      }}
    >
      <div style={cardStyle}>
        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--tx)', lineHeight: 1.4 }}>
          Set up this computer as your server
        </div>
        <span
          style={{
            display: 'inline-flex',
            padding: '2px 8px',
            background: 'var(--accbg)',
            borderRadius: 3,
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--acc)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            alignSelf: 'flex-start',
          }}
        >
          Linux only
        </span>
        <div style={{ fontSize: 13, color: 'var(--tx2)', lineHeight: 1.55 }}>
          Install Immich, Nextcloud, and Tailscale on this PC. Schedule nightly backups. About 5
          minutes.
        </div>
        <button
          className="btn btn--primary"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => go('provision')}
        >
          Set up this computer →
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          padding: '0 20px',
        }}
      >
        <div style={{ width: 1, height: 64, background: 'var(--bd)' }} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--txd)',
            background: 'var(--surf2)',
            padding: '3px 7px',
          }}
        >
          OR
        </span>
        <div style={{ width: 1, height: 64, background: 'var(--bd)' }} />
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--tx)', lineHeight: 1.4 }}>
          Connect to an existing server
        </div>
        <div style={{ fontSize: 13, color: 'var(--tx2)', lineHeight: 1.55 }}>
          Point this app at a running server on this network or over Tailscale.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label className="field-label" htmlFor="server-address">
            Server address
          </label>
          <input
            id="server-address"
            className="input"
            value={address}
            placeholder="https://…"
            onChange={(e) => setLocalAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runTest()}
          />
          <div className="hint">Accepts a Tailscale hostname or full URL</div>
        </div>

        <button
          className="btn btn--primary"
          onClick={runTest}
          disabled={state === 'testing' || !address.trim()}
          style={{
            background: state === 'done' ? 'var(--ok)' : undefined,
            cursor: state === 'testing' ? 'wait' : undefined,
          }}
        >
          {buttonLabel}
        </button>

        {result && state === 'failed' && (
          <div
            role="alert"
            style={{
              fontSize: 12,
              color: 'var(--danger)',
              background: 'var(--dangerbg)',
              border: '1px solid var(--bd)',
              borderRadius: 6,
              padding: '8px 10px',
              lineHeight: 1.5,
            }}
          >
            {result.message}
          </div>
        )}

        <div className="hint" style={{ textAlign: 'center' }}>
          Later: scan a QR code from the desktop app
        </div>
      </div>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  width: 310,
  background: 'var(--surf)',
  borderRadius: 12,
  border: '1px solid var(--bd)',
  padding: 28,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  boxShadow: 'var(--shadow-raised)',
}
