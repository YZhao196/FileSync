import { useState } from 'react'
import { Button, FormControl, Label, Stack, TextInput } from '@primer/react'
import { Card, InlineMessage } from '@primer/react/experimental'
import { deriveConnection, testConnection } from '../core/client'
import type { TestResult } from '../core/types'
import { useApp } from '../state/store'

/**
 * Screen 1 — the wizard. Both paths ship in every build: finishing the first is
 * what creates the server the second connects to, so they are sequential rather
 * than alternatives.
 *
 * Laid out like `ChoiceScreen` — a `Stack` of equal cards around an "OR" rule —
 * but built as custom `Card` content rather than `ChoiceScreen` itself. Primer's
 * `Card.Action` is pinned to the card's top-right corner, which suits a one-word
 * choice title but collides with this card's longer heading; and the second card
 * is a small connection test that needs a field, a button and a result message.
 */
export function FirstRun() {
  const { setAddress, connection, credentials, setConnectionState, go, setRole } = useApp()

  // Empty rather than pre-filled. It used to seed with the developer's own
  // hostname, so every new install opened with a server name that meant nothing
  // to the person reading it — a placeholder masquerading as a default. The
  // field's `placeholder` attribute shows the expected shape instead.
  const [address, setLocalAddress] = useState(connection.address)
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
    <Stack
      direction="horizontal"
      align="center"
      justify="center"
      gap="none"
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--background)',
        overflow: 'auto',
        padding: 'var(--spacing-08)',
      }}
    >
      <div style={{ flex: '1 1 0', minWidth: 0, maxWidth: 340 }}>
        <Card padding="normal" borderRadius="large">
          <Stack direction="vertical" gap="normal">
            <h2 className="heading-compact-01" style={{ color: 'var(--text-primary)' }}>
              Set up this computer as your server
            </h2>
            <p className="body-01" style={{ color: 'var(--text-secondary)' }}>
              Install Immich, Nextcloud, and Tailscale on this PC. Schedule nightly backups. About 5
              minutes.
            </p>
            <div>
              <Label>Linux only</Label>
            </div>
            <Button variant="primary" block onClick={() => go('provision')}>
              Set up this computer
            </Button>
          </Stack>
        </Card>
      </div>

      <OrDivider />

      <div style={{ flex: '1 1 0', minWidth: 0, maxWidth: 340 }}>
        <Card padding="normal" borderRadius="large">
          <Stack direction="vertical" gap="normal">
            <h2 className="heading-compact-01" style={{ color: 'var(--text-primary)' }}>
              Connect to an existing server
            </h2>
            <p className="body-01" style={{ color: 'var(--text-secondary)' }}>
              Point this app at a running server on this network or over Tailscale.
            </p>

            <FormControl id="server-address">
              <FormControl.Label>Server address</FormControl.Label>
              <TextInput
                block
                value={address}
                placeholder="https://…"
                onChange={(e) => setLocalAddress(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runTest()}
              />
              <FormControl.Caption>Accepts a Tailscale hostname or full URL</FormControl.Caption>
            </FormControl>

            <Stack direction="vertical" gap="condensed">
              <Button
                variant="default"
                block
                onClick={runTest}
                disabled={state === 'testing' || !address.trim()}
              >
                {buttonLabel}
              </Button>

              {result && state === 'failed' && (
                <InlineMessage variant="critical" role="alert">
                  {result.message}
                </InlineMessage>
              )}

              {/*
                A failure here is, on a brand-new server, almost always the same
                one: the app has no credentials yet, so every endpoint answers
                401. That is not a fault to report and leave — it is the next
                step, and on this screen there was previously no way to take it.
                The hint names where the two secrets come from, because on a
                server that was just provisioned they do not exist yet either.
              */}
              {result && state === 'failed' && (
                <Stack direction="vertical" gap="condensed">
                  <p className="helper-text-01" style={{ color: 'var(--text-helper)' }}>
                    Credentials are added in Settings, and a new server has none yet. In Immich,
                    create an API key under Account Settings → API Keys; in Nextcloud, an app
                    password under Personal settings → Security.
                  </p>
                  <Button variant="primary" block onClick={() => go('settings')}>
                    Enter credentials
                  </Button>
                </Stack>
              )}
            </Stack>

            <p className="helper-text-01" style={{ color: 'var(--text-helper)', textAlign: 'center' }}>
              Later: scan a QR code from the desktop app
            </p>
          </Stack>
        </Card>
      </div>
    </Stack>
  )
}

function OrDivider() {
  return (
    <Stack direction="vertical" align="center" gap="condensed" style={{ padding: '0 var(--spacing-05)' }}>
      <div style={{ width: 1, height: 64, background: 'var(--border-subtle-01)' }} />
      <span
        className="label-01"
        style={{ color: 'var(--text-helper)', background: 'var(--background)', padding: '3px 7px' }}
      >
        OR
      </span>
      <div style={{ width: 1, height: 64, background: 'var(--border-subtle-01)' }} />
    </Stack>
  )
}
