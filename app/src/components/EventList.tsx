import { Icon } from './Icon'
import type { ProvisionEvent } from '../core/types'

/**
 * Live provisioning progress.
 *
 * Shared by the two screens that run the provisioning script — "set up this
 * computer" and "replace your server" — because they stream the same
 * `step<TAB>state<TAB>detail` protocol from the same runner. A second copy
 * would be a second place for the state→glyph mapping to drift.
 *
 * Every state is distinguishable without colour: a filled check, a filled
 * warning, a half-circle while a step is in flight, a dash for skipped. Colour
 * is decoration on top, never the signal.
 */
export function EventList({ events }: { events: ProvisionEvent[] }) {
  if (!events.length) {
    return (
      <p className="body-01" style={{ color: 'var(--text-secondary)' }}>
        Starting…
      </p>
    )
  }
  return (
    <ol
      className="code-02"
      style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-03)' }}
    >
      {events.map((e, i) => (
        <li
          key={`${e.step}-${i}`}
          style={{
            display: 'flex',
            gap: 'var(--spacing-03)',
            color: e.state === 'failed' ? 'var(--text-error)' : 'var(--text-secondary)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'inline-flex',
              color:
                e.state === 'ok'
                  ? 'var(--support-success)'
                  : e.state === 'failed'
                    ? 'var(--support-error)'
                    : 'var(--text-helper)',
            }}
          >
            {e.state === 'ok' ? (
              <Icon name="check" filled />
            ) : e.state === 'failed' ? (
              <Icon name="alert" filled />
            ) : e.state === 'start' ? (
              '◌'
            ) : (
              '–'
            )}
          </span>
          <span>
            {e.step}
            {e.detail ? ` — ${e.detail}` : ''}
          </span>
        </li>
      ))}
    </ol>
  )
}
