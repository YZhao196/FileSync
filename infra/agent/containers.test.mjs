#!/usr/bin/env node
/**
 * Service-name to container-name mapping.
 *
 * Run with `node infra/agent/containers.test.mjs`. No test runner, for the same
 * reason as the caption store: this agent has no dependencies and adding one to
 * test two pure functions would be a worse trade than a script that exits
 * non-zero.
 *
 * The first test is the regression. `immich` used to be resolved by substring
 * against `docker ps` output, so it matched whichever of `immich-server` and
 * `immich-machine-learning` the listing happened to put first — which meant the
 * status tile could describe the ML container and the Restart button could
 * restart it.
 */

import { DEFAULT_SERVICES, parseServices, resolveContainer } from './containers.mjs'

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  const got = ok ? '' : ` — got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${got}`)
}

const states = (...names) => new Map(names.map((n) => [n, 'running']))

check('the default names Immich\'s server container', parseServices(DEFAULT_SERVICES)[0], {
  slug: 'immich',
  container: 'immich-server',
})

check('a bare slug still parses', parseServices('redis')[0], { slug: 'redis', container: null })

check('whitespace and case are forgiven', parseServices(' Immich = Immich-Server , Redis ')[1], {
  slug: 'redis',
  container: null,
})

check('no configuration falls back to the default stack', parseServices(undefined).length, 4)

// The regression: with both containers present, Immich must resolve to the
// server, whichever order the two appear in.
const both = states('immich-machine-learning', 'immich-server', 'redis')
check('immich resolves to its server container', resolveContainer(both, { slug: 'immich', container: 'immich-server' }), 'immich-server')
check(
  'and does so whichever order docker lists them',
  resolveContainer(states('immich-server', 'immich-machine-learning'), { slug: 'immich', container: 'immich-server' }),
  'immich-server',
)

// A named container that is not running must read as stopped, not silently
// resolve to its neighbour.
check(
  'a named container that is absent resolves to nothing',
  resolveContainer(states('immich-machine-learning'), { slug: 'immich', container: 'immich-server' }),
  undefined,
)

check('an exact slug match wins', resolveContainer(states('redis', 'redis-commander'), { slug: 'redis', container: null }), 'redis')

check(
  'an ambiguous slug falls back to the shortest match',
  resolveContainer(states('immich-machine-learning', 'immich-server'), { slug: 'immich', container: null }),
  'immich-server',
)

check('no docker at all resolves to nothing', resolveContainer(null, { slug: 'redis', container: null }), undefined)

check('an unknown slug resolves to nothing', resolveContainer(states('redis'), { slug: 'postgres', container: null }), undefined)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
