#!/usr/bin/env node
// Delete @electron/rebuild's "already built" stamps before packaging (ADR-0013).
//
// THE SILENT FAILURE THIS PREVENTS
// @electron/rebuild records what it built in
// `<module>/build/Release/.forge-meta` (contents: `<arch>--<ABI>-`) and skips
// any module whose stamp already matches the target — `alreadyBuiltByRebuild()`
// in its rebuild.js. But `npm rebuild` / `npm ci` / `npm install` REPLACE the
// .node with the Node-ABI prebuild and leave that stamp untouched.
//
// The result is a packaged app carrying a binary its own Electron cannot load,
// with nothing in the build output to say so — @electron/rebuild logs
// "preparing" then "finished" in a few seconds and exits 0. Measured on
// 2026-07-25: the shipped .node was byte-identical (md5) to the Node build, and
// the packaged app failed only when it first tried to open a database.
//
// This is unavoidable here rather than incidental: ADR-0013 pins better-sqlite3
// for its NODE-ABI prebuild (fast `npm ci`) and compiles for Electron, so the
// two ABIs are deliberately swapped back and forth in one working tree. The
// stamp cannot be trusted to describe what is actually on disk.
//
// Cost: forces a real ~60 s compile at package time. A silently broken
// installer costs more. CI is unaffected in practice — a fresh `npm ci` has no
// stamp to go stale — but it runs here too, because "CI happens to be safe" is
// not a property worth depending on.

import { readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const MODULES_DIR = 'node_modules'
let cleared = 0

for (const name of existsSync(MODULES_DIR) ? readdirSync(MODULES_DIR) : []) {
  // Scoped packages hold their real modules one level deeper.
  const candidates = name.startsWith('@')
    ? readdirSync(join(MODULES_DIR, name)).map((inner) => join(MODULES_DIR, name, inner))
    : [join(MODULES_DIR, name)]

  for (const dir of candidates) {
    const stamp = join(dir, 'build', 'Release', '.forge-meta')
    if (existsSync(stamp)) {
      rmSync(stamp)
      console.log(`cleared native rebuild stamp: ${stamp}`)
      cleared++
    }
  }
}

if (cleared === 0) console.log('no native rebuild stamps to clear')
