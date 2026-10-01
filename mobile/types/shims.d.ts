/**
 * The two things TypeScript cannot work out on its own in this project.
 *
 * This file has no top-level imports on purpose — that is what keeps the
 * `declare module` below ambient. Adding one turns it into a module
 * augmentation, which would then require `vitest` to actually exist.
 */

// Jest's globals — `describe`, `it`, `expect` — are injected at runtime and are
// not in scope for `tsc` unless `@types/jest` is pulled in explicitly.
/// <reference types="jest" />

/**
 * The copied tests under `src/core` and `src/lib` still import from `vitest`,
 * because they are byte-identical to the desktop's and rewriting them would
 * defeat the point of copying them. At runtime, `jest.config.js` aliases the
 * specifier to `test/vitest-shim.js`; this is the same thing for the type
 * checker, so `npm run typecheck` agrees with `npm test`.
 *
 * Types are taken from `@jest/globals`, which is where the runtime values come
 * from too. That keeps the two ends of the alias honest: if the shim forwards
 * something with a different shape than this declares, the calls in the copied
 * tests stop compiling.
 */
declare module 'vitest' {
  export const describe: typeof import('@jest/globals').describe
  export const it: typeof import('@jest/globals').it
  export const test: typeof import('@jest/globals').test
  export const expect: typeof import('@jest/globals').expect
  export const beforeEach: typeof import('@jest/globals').beforeEach
  export const afterEach: typeof import('@jest/globals').afterEach
  export const beforeAll: typeof import('@jest/globals').beforeAll
  export const afterAll: typeof import('@jest/globals').afterAll

  export const vi: {
    useFakeTimers: (...args: unknown[]) => void
    useRealTimers: () => void
    setSystemTime: (time: Date | number) => void
    fn: (...args: unknown[]) => unknown
    spyOn: (...args: unknown[]) => unknown
  }
}
