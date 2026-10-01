import type { BackupStatus } from '../core/types'

/**
 * Whether the cloud backup counts as current.
 *
 * PLAN.md §10 and §11 both lean on this: the replace flow will not offer to
 * wipe the old machine while Backblaze is stale, and the tray and notifications
 * exist to notice when it goes stale. One predicate, two consumers.
 *
 * 48 hours rather than 24: a nightly run that slips by a few hours, or a laptop
 * that was asleep, should not read as a failure. A run that has actually missed
 * a night does.
 *
 * ## There is a second threshold, and it is stricter
 *
 * `BACKUP_CURRENT_MS` in `infra/agent/agent.mjs` is 36 hours, and it answers a
 * related question: on a server with no verdict file — the hand-built case the
 * agent's README describes — it decides whether a recent snapshot is enough to
 * call the last run okay.
 *
 * The two never meet, and this one loses. `isBackupCurrent` requires
 * `lastRunOk`, so a 40-hour-old snapshot makes the agent say `lastRunOk: false`
 * and the tray say **BACKUP STALE** — for a backup the paragraph above says
 * should read as fine. The agent's number is the effective one; this one only
 * applies within it.
 *
 * Not reconciled here because the two are making different claims: the agent is
 * inferring success from an artefact that does not prove it, which argues for
 * being *less* generous than a display tolerance, and 36 is defensible on that
 * ground. What is not defensible is that neither file mentioned the other. If
 * either number moves, move both or say why not.
 */
export const BACKUP_CURRENT_WINDOW_MS = 48 * 3600 * 1000

export function isBackupCurrent(backup: BackupStatus | undefined | null): boolean {
  if (!backup || !backup.lastRunAt || !backup.lastRunOk) return false
  const age = Date.now() - new Date(backup.lastRunAt).getTime()
  return age >= 0 && age < BACKUP_CURRENT_WINDOW_MS
}

/**
 * One line for the tray tooltip — the three numbers PLAN.md §11 says the app
 * exists to show, without opening it.
 */
export function backupSummary(
  backup: BackupStatus | undefined | null,
  servicesUp: boolean,
): string {
  if (!backup) return 'FileSynapse — no status'
  const state = isBackupCurrent(backup) ? 'backup ok' : 'BACKUP STALE'
  const when = backup.lastRunAt ? new Date(backup.lastRunAt).toLocaleString() : 'never'
  return `FileSynapse — ${state} · last ${when} · ${servicesUp ? 'services up' : 'A SERVICE IS DOWN'}`
}
