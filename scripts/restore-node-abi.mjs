#!/usr/bin/env node
// Make `npm test` work regardless of what packaged last (ADR-0013).
//
// better-sqlite3 is a V8-ABI module, so one .node file serves exactly one ABI.
// Packaging compiles it for Electron (148); vitest runs under Node (141). After
// `npm run package`, `npm test` would otherwise fail with a
// NODE_MODULE_VERSION mismatch that reads like a broken test suite rather than
// a build artifact left in the wrong shape.
//
// `npm rebuild better-sqlite3` restores the Node build in well under a second,
// because ADR-0013 pins a version whose NODE-ABI prebuild exists — that is the
// entire reason for the pin. So this runs as `pretest` and is close to free.
//
// It is deliberately best-effort: if the rebuild fails, say so and let vitest
// run anyway. Most of this suite is pure geometry that never touches the
// database, and failing the whole run over storage tooling would be worse than
// the real error the DB tests are about to give.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

if (!existsSync('node_modules/better-sqlite3')) process.exit(0)

// Already loadable under this Node? Then there is nothing to do.
try {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const Database = require('better-sqlite3')
  new Database(':memory:').close()
  process.exit(0)
} catch {
  // Wrong ABI (or genuinely broken) — fall through and rebuild.
}

console.log('better-sqlite3 is not loadable under Node — restoring its Node-ABI build…')
try {
  execFileSync('npm', ['rebuild', 'better-sqlite3'], { stdio: 'inherit' })
} catch {
  console.warn('warning: `npm rebuild better-sqlite3` failed; database tests will fail below.')
}
