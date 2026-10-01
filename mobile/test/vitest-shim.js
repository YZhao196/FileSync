/**
 * Maps the desktop test files' `vitest` import onto Jest's globals.
 *
 * The tests under `src/core` and `src/lib` are byte-identical copies of the
 * desktop client's — `scripts/sync-core.mjs` enforces that. They therefore still
 * `import { describe, expect, it } from 'vitest'`, which is exactly the point:
 * the shared logic is verified on both platforms by the *same* assertions, not
 * by two suites that drift apart the way the code would if it were rewritten.
 *
 * Rewriting the imports in the copies would defeat that, so the import is
 * aliased instead. Jest's API is close enough that almost nothing needs
 * bridging; `vi` is the exception, and it is a thin forwarder.
 *
 * Deliberately not a general-purpose vitest emulation. It covers what the copied
 * tests actually use and nothing else — if a copied test starts using a vitest
 * feature that is not here, the failure should be a clear one, not a silent
 * difference in behaviour between the two platforms.
 */

const g = globalThis

export const describe = g.describe
export const it = g.it
export const test = g.test
export const expect = g.expect
export const beforeEach = g.beforeEach
export const afterEach = g.afterEach
export const beforeAll = g.beforeAll
export const afterAll = g.afterAll

/**
 * `jest` itself is not on `globalThis` in this configuration — the test-framework
 * globals above are, the `jest` object is not — so it comes from `@jest/globals`,
 * which is the supported way to reach it from outside a test file.
 */
const { jest } = require('@jest/globals')

/**
 * `lib/format.test.ts` uses these three to pin "today" for relative-date
 * formatting. Jest's equivalents take the same arguments and mean the same
 * thing, so they forward directly rather than reimplementing anything.
 */
export const vi = {
  useFakeTimers: (...args) => jest.useFakeTimers(...args),
  useRealTimers: () => jest.useRealTimers(),
  setSystemTime: (time) => jest.setSystemTime(time),
  fn: (...args) => jest.fn(...args),
  spyOn: (...args) => jest.spyOn(...args),
}
