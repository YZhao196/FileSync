import { useEffect, useRef } from 'react'
import type { Backends } from '../core/backends'
import { backupSummary, isBackupCurrent } from '../lib/backup'
import { notify, setTrayStatus } from '../native/bridge'

/** Five minutes. A nightly backup does not change state faster than that, and
 *  the status panel refreshes on its own when someone is looking at it. */
const INTERVAL_MS = 5 * 60 * 1000

interface Verdict {
  backupOk: boolean
  servicesOk: boolean
}

/**
 * Watches the server in the background and speaks up when something is wrong.
 *
 * PLAN.md §11's whole argument for this app is that nobody wants to open
 * Cockpit to find out whether restic ran — so the app has to be the thing that
 * notices. Two jobs:
 *
 *   1. Keep the tray tooltip current, since that is the surface people see
 *      without opening anything.
 *   2. Notify *on the transition* into a bad state, not on every poll. A
 *      notification every five minutes would train you to dismiss it, which is
 *      worse than no notification at all.
 *
 * A development build running on mocks is deliberately excluded: warning about
 * a fabricated backup failure would be the most misleading thing this app could
 * do.
 */
export function useBackupWatch(backends: Backends, live: boolean): void {
  const previous = useRef<Verdict | null>(null)

  useEffect(() => {
    if (!live) return
    let cancelled = false

    const tick = async () => {
      let verdict: Verdict
      try {
        const status = await backends.server.status()
        if (cancelled) return
        verdict = {
          backupOk: isBackupCurrent(status.backup),
          servicesOk: status.services.every((s) => s.state === 'running'),
        }
        void setTrayStatus(backupSummary(status.backup, verdict.servicesOk))
      } catch {
        if (cancelled) return
        verdict = { backupOk: false, servicesOk: false }
        void setTrayStatus('FileSynapse — server unreachable')
      }

      const last = previous.current
      previous.current = verdict
      // The first poll only establishes a baseline. Announcing a problem you
      // just discovered by starting the app is a notification about starting
      // the app.
      if (!last) return

      if (last.backupOk && !verdict.backupOk) {
        // Deliberately no duration. This used to say "more than two days old",
        // naming the client's own 48-hour window — but that is not the
        // threshold that fires. The agent infers `lastRunOk` at 36 hours on a
        // server with no verdict file, and `isBackupCurrent` requires
        // `lastRunOk`, so a run forty hours old arrives here already marked
        // failed. The notification would have been confidently wrong about its
        // own reason, which is the worst kind: it sends somebody to check a
        // clock rather than a log.
        //
        // "recently enough" rather than a number, because there are two numbers
        // and this code does not know which one applied.
        void notify(
          'Backup needs attention',
          'The last restic run did not finish cleanly, or has not run recently enough. Open FileSynapse to see which.',
        )
      }
      if (last.servicesOk && !verdict.servicesOk) {
        void notify('A server service is down', 'Open FileSynapse to see which one.')
      }
    }

    void tick()
    const timer = window.setInterval(tick, INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [backends, live])
}
