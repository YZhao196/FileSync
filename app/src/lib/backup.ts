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
