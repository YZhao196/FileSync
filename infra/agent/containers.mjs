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

/**
 * The two stacks `provision.sh` creates, mapped onto the four things worth
 * showing on the status panel.
 *
 * Every container is named explicitly because neither stack's names are
 * guessable: Immich's compose sets `container_name: immich_server` (note the
 * underscore) and `immich_postgres`, while ours sets `nextcloud` and
 * `nextcloud-db`. The slugs on the left are what the panel displays, so they stay
 * the four a person recognises rather than drifting into container names.
 *
 * Redis is deliberately absent. There are two of them now — one per stack — and
 * a panel with "Redis" twice says less than nothing.
 */
export const DEFAULT_SERVICES =
  'immich=immich_server,nextcloud=nextcloud,mariadb=nextcloud-db,postgres=immich_postgres'

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
 * An explicit name is matched as a substring, which is safe precisely because it
 * is not ambiguous — and necessary, because Compose names containers
 * `<project>-<service>-<n>`, so `immich-server` is really
 * `filesynapse-immich-server-1` and an exact match would never fire. Getting
 * that wrong reads as "stopped" for a running service, which is worse than the
 * ambiguity it replaced.
 *
 * A bare slug tries an exact name first, then the shortest containing name: a
 * heuristic, but a stable one, where the old code's answer depended on the order
 * `docker ps` happened to return.
 */
export function resolveContainer(states, { slug, container }) {
  if (!states) return undefined
  const names = [...states.keys()]
  if (container) return names.find((name) => name.includes(container))
  if (states.has(slug)) return slug
  return names.filter((name) => name.includes(slug)).sort((a, b) => a.length - b.length)[0]
}
