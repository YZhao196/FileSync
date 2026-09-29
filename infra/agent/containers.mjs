/**
 * Mapping configured service names onto container names.
 *
 * Its own module because `agent.mjs` starts an HTTP server as a side effect of
 * being imported, so nothing in it can be tested. These two functions are pure,
 * and they are where the interesting mistake lived: matching a service to a
 * container by substring alone.
 *
 * `AGENT_SERVICES=immich` matches both `immich-server` and
 * `immich-machine-learning`. Taking whichever `docker ps` listed first meant the
 * status tile could report the ML container as "Immich" — and, because the
 * restart route matched the same way, the Restart button could restart it.
 */

/** The stack `provision.sh` creates. `immich` is named because it is ambiguous. */
export const DEFAULT_SERVICES = 'immich=immich-server,nextcloud,mariadb,redis'

/**
 * `slug` or `slug=container`. The explicit form is the point: naming the
 * container removes the guess rather than tuning it.
 */
export function parseServices(raw) {
  return String(raw ?? DEFAULT_SERVICES)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => {
      const [slug, container] = entry.split('=').map((s) => s.trim())
      return { slug, container: container || null }
    })
}

/**
 * The container backing a service, or `undefined` if none is running.
 *
 * An explicit name wins outright and is not second-guessed — if it is not there,
 * the service reads as stopped rather than silently resolving to a neighbour.
 * Otherwise an exact slug, then the shortest containing name: a heuristic, but a
 * stable one, where the old code's answer depended on `docker ps` ordering.
 */
export function resolveContainer(states, { slug, container }) {
  if (!states) return undefined
  if (container) return states.has(container) ? container : undefined
  if (states.has(slug)) return slug
  return [...states.keys()]
    .filter((name) => name.includes(slug))
    .sort((a, b) => a.length - b.length)[0]
}
