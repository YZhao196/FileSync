import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

import { ToastProvider } from '../components/Toaster'
import { AppProvider } from '../state/store'
import { ServerStatus } from './ServerStatus'

/**
 * The status panel — the screen PLAN.md §11 says is the reason this app runs at
 * all: "did the backup run, how full is the disk, are the services up", answered
 * without opening Cockpit.
 *
 * A render test rather than an interaction one. What is worth pinning is that
 * every section the spec requires actually draws from a real status object, so a
 * change that silently drops one — a field renamed, a collector returning
 * nothing, a section behind a condition that stopped being true — shows up here
 * rather than as a panel somebody notices is shorter than it was.
 */

afterEach(cleanup)

// Both providers, because the screen reports its actions through a toast —
// `useToast` throws rather than degrading when it is missing, which is what
// made the first run of this test fail on every case at once.
const renderStatus = () =>
  render(
    <AppProvider>
      <ToastProvider>
        <ServerStatus />
      </ToastProvider>
    </AppProvider>,
  )

describe('ServerStatus', () => {
  it('draws a row per service, with a restart control', async () => {
    const view = await renderStatus()
    await waitFor(() => expect(view.getByText('Immich')).toBeTruthy())
    // The mock reports four; the panel is a list, not a fixed set.
    expect(view.getByText('Nextcloud')).toBeTruthy()
    expect(view.getAllByText('Restart').length).toBeGreaterThan(0)
  })

  it('reports storage in usage terms rather than raw bytes', async () => {
    // "240 GB / 1 TB" is the answer somebody wants; 257,698,037,760 is not.
    // Asserted on the labels the panel gives the drives rather than on the
    // numbers: the numbers come from the mock and would pin this test to them,
    // while the labels are the screen's own.
    const view = await renderStatus()
    await waitFor(() => expect(view.getByText(/Photos drive/i)).toBeTruthy())
    expect(view.getByText(/Cloud drive/i)).toBeTruthy()
  })

  it('shows the backup state, which is the reason the tray exists', async () => {
    const view = await renderStatus()
    await waitFor(() => expect(view.getByText(/Snapshots/i)).toBeTruthy())
  })

  it('shows the tailnet, because every client reaches this over one', async () => {
    const view = await renderStatus()
    await waitFor(() => expect(view.getByText(/Tailscale/i)).toBeTruthy())
  })

  it('offers "Back up now" without needing the app to be closed', async () => {
    const view = await renderStatus()
    await waitFor(() => expect(view.getByText(/Back up now/i)).toBeTruthy())
  })
})
