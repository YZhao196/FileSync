/**
 * Installs the web globals the shared logic layer needs, before any test file is
 * loaded.
 *
 * The app installs the same set from `index.ts`. It matters that the tests go
 * through the same module rather than their own copy of it: `remote.test.ts`
 * exercises `parseMultiStatus`, which needs `DOMParser`, and `basicAuth`, which
 * needs `TextEncoder` and `btoa`. If the test environment supplied those by
 * accident — Node does provide two of the three — the suite would pass while a
 * device build failed, which is the worst possible outcome for a shim.
 *
 * So the polyfills are imported from the one place the app uses, and the two
 * fallbacks are also tested directly, since Node's own globals mean they would
 * otherwise never execute here.
 */

import '../src/platform/polyfills'
