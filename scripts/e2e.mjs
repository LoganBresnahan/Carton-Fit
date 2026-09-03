#!/usr/bin/env node
// Run the Playwright-Electron suite without taking over the screen.
//
// THE PROBLEM THIS SOLVES. Electron has no headless mode — the app opens a real
// window, ~115 times per run, and on WSLg each one steals focus. The machine is
// unusable for the four minutes the suite takes. The fix is not a flag; it is
// giving the app a display that is not the developer's, which is exactly what
// CI has always done (`xvfb-run`, ADR-0005's "E2E needs a display and software
// GL"). This script makes that the default locally instead of a thing you have
// to remember.
//
// WHY A SCRIPT RATHER THAN `xvfb-run` IN THE npm SCRIPT. `npm run e2e` is not a
// Linux-only command: the release workflow runs the same suite on
// `windows-latest`, where `xvfb-run` does not exist and a real desktop session
// already does. A hardcoded wrapper would break the platform this app actually
// ships on. So the mode is DECIDED, per environment, and the decision is
// printed — nothing here is silent.
//
// The four branches, each for its own reason:
//   --visible / E2E_VISIBLE=1  → never wrap. Watching the window IS the point
//                                (a layout bug you have to see, a hang).
//   not linux                  → never wrap. Windows and macOS runners have a
//                                session; xvfb is an X concept.
//   linux, xvfb-run present    → wrap. The default, and CI's configuration.
//   linux, xvfb-run missing    → depends on whether a display exists:
//                                one does  → run visible with a loud note, so a
//                                            fresh checkout is not blocked by a
//                                            missing apt package;
//                                none      → fail with the install line, because
//                                            "no display" inside Playwright is
//                                            an error nobody decodes quickly.
//
// Anything after the flag goes to Playwright verbatim, so file filters and
// `--config` still work: `npm run e2e -- e2e/mcp-shim.spec.ts`.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
// Playwright's own CLI entry, run under `node` rather than through the `.bin`
// shim: a `.cmd` shim needs a shell on Windows, and this script has to stay
// runnable there even though the release workflow calls playwright directly.
//
// Located from the package's main export rather than resolved as
// `@playwright/test/cli.js`: the package's `exports` map does not list the CLI,
// so resolving it by subpath throws ERR_PACKAGE_PATH_NOT_EXPORTED. The main
// entry IS exported, and its directory is the package root.
const cli = join(dirname(require.resolve('@playwright/test')), 'cli.js')
if (!existsSync(cli)) {
  console.error(`[e2e] Playwright's CLI is not where expected (${cli}) — run npm ci.`)
  process.exit(1)
}

const argv = process.argv.slice(2)
const visible = argv.includes('--visible') || process.env.E2E_VISIBLE === '1'
const args = argv.filter((arg) => arg !== '--visible')

function hasXvfbRun() {
  const probe = spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' })
  return probe.error === undefined
}

const INSTALL = 'sudo apt-get update && sudo apt-get install -y xvfb'

function plan() {
  if (visible) return { wrap: false, why: 'visible mode requested' }
  if (process.platform !== 'linux') {
    return { wrap: false, why: `${process.platform} has its own session` }
  }
  if (hasXvfbRun()) return { wrap: true, why: 'quiet: windows go to a virtual display' }
  if (process.env.DISPLAY !== undefined || process.env.WAYLAND_DISPLAY !== undefined) {
    return {
      wrap: false,
      why: `xvfb-run not installed — running VISIBLY, windows will take focus. Install it: ${INSTALL}`
    }
  }
  console.error(`[e2e] No display and no xvfb-run. Install it:\n  ${INSTALL}`)
  process.exit(1)
}

const { wrap, why } = plan()
console.log(`[e2e] ${why}`)

// `-a` picks a free display number, so concurrent runs cannot collide.
const command = wrap ? 'xvfb-run' : process.execPath
const commandArgs = wrap
  ? ['-a', process.execPath, cli, 'test', ...args]
  : [cli, 'test', ...args]

const run = spawnSync(command, commandArgs, { stdio: 'inherit' })
if (run.error !== undefined) {
  console.error(`[e2e] could not start ${command}: ${run.error.message}`)
  process.exit(1)
}
// Signals are not exit codes: a suite killed by Ctrl-C must not report 0.
process.exit(run.status === null ? 1 : run.status)
