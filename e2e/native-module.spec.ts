import { test, expect } from '@playwright/test'
import { launchApp } from './harness'

/**
 * The packaged app can actually load better-sqlite3 (ADR-0013).
 *
 * WHY THIS EXISTS AS A SPEC RATHER THAN A BUILD CHECK
 * A native module has to be three things at once, and each can fail silently:
 * present in the package, *outside* app.asar (the OS loader cannot dlopen from
 * inside an archive), and compiled for **Electron's** ABI rather than Node's.
 * All three were wrong at some point on 2026-07-25 while wiring roadmap item 7,
 * and none of them turned the build red:
 *
 *   - `asarUnpack` was declared for the LGPL wasm, which silently replaced
 *     electron-builder's native-module default and packed the .node inside
 *     app.asar;
 *   - `npmRebuild: true` alone left @electron/rebuild looking for a prebuild
 *     that does not exist, which it then reported as "finished";
 *   - a stale `.forge-meta` stamp made it skip the rebuild entirely, shipping a
 *     Node-ABI binary byte-identical to the one vitest uses.
 *
 * Only running the shipped bytes catches this class. `process.mainModule.require`
 * rather than a bare `require`: this function is injected into the main process,
 * not compiled as a module, so module-scope `require` is not in its closure.
 */
test.describe('native module in the packaged app', () => {
  test.skip(
    !process.env.PACKAGED_APP,
    'only meaningful against a packaged build — in dev the module is on the Node ABI for vitest'
  )

  test('better-sqlite3 loads and runs a query in the main process', async () => {
    const { app } = await launchApp()
    try {
      const result = await app.evaluate(() => {
        const req = process.mainModule?.require?.bind(process.mainModule)
        if (!req) return { ok: false as const, error: 'no require in the main process' }
        try {
          const Database = req('better-sqlite3')
          const db = new Database(':memory:')
          db.exec('CREATE TABLE probe (x INTEGER)')
          db.prepare('INSERT INTO probe VALUES (?)').run(1)
          const row = db.prepare('SELECT x FROM probe').get() as { x: number }
          const journal = db.pragma('journal_mode', { simple: true })
          db.close()
          return { ok: true as const, abi: process.versions.modules, x: row.x, journal }
        } catch (error) {
          return {
            ok: false as const,
            abi: process.versions.modules,
            error: String((error as Error).message).split('\n').slice(0, 2).join(' ')
          }
        }
      })

      expect(
        result.ok,
        `the packaged app cannot load better-sqlite3 — it would fail the moment a user ` +
          `saved a preset. Check, in order: is the .node under ` +
          `resources/app.asar.unpacked (asarUnpack), and was it compiled for Electron's ` +
          `ABI (npmRebuild + buildDependenciesFromSource, and no stale .forge-meta)? ` +
          `Reported: ${'error' in result ? result.error : ''}`
      ).toBe(true)

      // Prove it really executed rather than merely importing: better-sqlite3
      // loads its addon lazily, so a successful `require` alone proves nothing.
      if (result.ok) expect(result.x).toBe(1)
    } finally {
      await app.close()
    }
  })
})
