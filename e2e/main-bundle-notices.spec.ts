import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './harness'
import { citedPackages, inlineNotice } from './notices'

/**
 * Every package bundled into out/main is accounted for in the notices file.
 *
 * The main build bundles node_modules code into our own files (occt's glue,
 * three's STL path, and since ADR-0029 phase 3 the MCP SDK's stdio subset),
 * where no `LICENSE` file rides beside it — so the obligation is met by the
 * notices file instead, and nothing about a future `npm update` keeps that
 * true by itself. The build writes what it actually bundled to
 * `out/main/bundled-modules.json` (see electron.vite.config.ts); this spec is
 * the other half of the loop: an SDK upgrade that starts reaching one more
 * package turns into a red spec naming it, not a silent licence violation.
 *
 * NOT packaged-gated, unlike licence-notices.spec.ts: the manifest describes
 * out/main, which both e2e modes run from or package from.
 */
test('every package bundled into out/main has a notices entry', () => {
  const manifestPath = join(REPO_ROOT, 'out', 'main', 'bundled-modules.json')
  // A missing manifest must FAIL, not skip: deleting the build plugin would
  // otherwise retire this guard silently.
  const bundled = JSON.parse(readFileSync(manifestPath, 'utf8')) as string[]
  expect(bundled.length, 'bundled-modules.json lists nothing — plugin broken?').toBeGreaterThan(0)

  const cited = new Set(citedPackages())
  const uncited = bundled.filter((name) => !cited.has(name))
  expect(
    uncited,
    'bundled into out/main but absent from THIRD-PARTY-NOTICES.md — add a table row ' +
      'and, if the package tree does not ship, an inline "### Notice:" section'
  ).toHaveLength(0)
})

test('bundled-only packages carry their licence text inline', () => {
  // The row alone satisfies the spec above; this closes the second half for
  // packages whose tree never ships: the SDK subset must have its full text in
  // the "Notices carried in this file" section. Which packages those are is
  // read from the manifest, not restated — minus the two whose node_modules
  // trees DO ship licence files (occt-import-js and three are `dependencies`,
  // pruned to code-dirs-only precisely so their LICENSE files remain).
  const manifestPath = join(REPO_ROOT, 'out', 'main', 'bundled-modules.json')
  const bundled = JSON.parse(readFileSync(manifestPath, 'utf8')) as string[]
  const shipsAsPackage = new Set(
    Object.keys(
      (JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
      }).dependencies ?? {}
    )
  )

  for (const name of bundled.filter((pkg) => !shipsAsPackage.has(pkg))) {
    const inline = inlineNotice(name)
    expect(inline, `${name} is bundled without a shipped package tree, but has no inline notice`)
      .not.toBeNull()
    expect((inline ?? '').trim().length, `${name}'s inline notice is too short`).toBeGreaterThan(500)
  }
})
