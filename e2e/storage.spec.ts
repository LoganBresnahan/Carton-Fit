import { test, expect } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './harness'

/**
 * The storage contract, exercised across all three processes (ADR-0007).
 *
 * The unit tests in `tests/db-*.test.ts` drive the stores directly in Node.
 * What they cannot prove is the part that only exists in a real app: that main
 * registered the handlers, that preload exposed them through the context
 * bridge, and that everything crossing IPC survives structured cloning. A
 * renderer calling `window.api.storage` is the only way to check that, and each
 * of those three hops can fail while every unit test stays green.
 *
 * PACKAGED ONLY, like `native-module.spec.ts`: better-sqlite3 is compiled for
 * whichever ABI packaged last, and `npm test` restores the Node one (ADR-0013),
 * so in a dev run the main process legitimately reports storage unavailable.
 */
test.describe('storage across main/preload/renderer', () => {
  test.skip(
    !process.env.PACKAGED_APP,
    'needs the Electron-ABI build of better-sqlite3, which only a packaged build reliably has'
  )

  /** A fresh profile per launch, so these never touch the real user's database. */
  function isolatedProfile(): string[] {
    return [`--user-data-dir=${mkdtempSync(join(tmpdir(), 'pe-e2e-profile-'))}`]
  }

  test('reports healthy storage at the current schema version', async () => {
    const { app, page } = await launchApp(isolatedProfile())
    try {
      const health = await page.evaluate(() => window.api.storage.health())
      expect(
        health.available,
        `storage reported unavailable: ${health.error ?? '(no error given)'}`
      ).toBe(true)
      expect(health.schemaVersion).toBe(1)
      // A fresh profile has nothing to recover from.
      expect(health.quarantined).toBeNull()
    } finally {
      await app.close()
    }
  })

  test('round-trips a configuration through IPC with its structure intact', async () => {
    const { app, page } = await launchApp(isolatedProfile())
    try {
      const settings = {
        mode: 'fit-check',
        tier: 'thorough',
        boxDimsMm: [304.8, 203.2, 152.4],
        maxWeightG: 15876,
        unitSystem: 'imperial'
      }

      const result = await page.evaluate(async (s) => {
        await window.api.storage.saveConfiguration('Shipping box A', s)
        return {
          list: await window.api.storage.listConfigurations(),
          loaded: await window.api.storage.getConfiguration('Shipping box A'),
          missing: await window.api.storage.getConfiguration('never saved')
        }
      }, settings)

      expect(result.list.map((c) => c.name)).toEqual(['Shipping box A'])
      // The nested array is the thing most likely to be quietly mangled by a
      // serialization boundary, so assert the whole object AND the dims.
      expect(result.loaded?.settings).toEqual(settings)
      expect((result.loaded?.settings as typeof settings).boxDimsMm).toEqual([304.8, 203.2, 152.4])
      expect(result.missing).toBeNull()
    } finally {
      await app.close()
    }
  })

  test('presets survive a restart — the point of storing them at all', async () => {
    const profile = isolatedProfile()

    const first = await launchApp(profile)
    try {
      await first.page.evaluate(() =>
        window.api.storage.saveConfiguration('Persisted', { maxWeightG: 1234 })
      )
    } finally {
      await first.app.close()
    }

    const second = await launchApp(profile)
    try {
      const loaded = await second.page.evaluate(() =>
        window.api.storage.getConfiguration('Persisted')
      )
      expect((loaded?.settings as { maxWeightG: number }).maxWeightG).toBe(1234)
    } finally {
      await second.app.close()
    }
  })

  test('records estimate history and reads it back newest-first', async () => {
    const { app, page } = await launchApp(isolatedProfile())
    try {
      const history = await page.evaluate(async () => {
        const entry = (fileName: string) => ({
          fileName,
          contentHash: 'hash-1',
          settings: { tier: 'fast' },
          result: { count: 12, binding: 'geometry' }
        })
        await window.api.storage.recordEstimate(entry('first.stp'))
        await window.api.storage.recordEstimate(entry('second.stp'))
        return {
          recent: await window.api.storage.recentEstimates(),
          forContent: await window.api.storage.estimatesForContent('hash-1'),
          other: await window.api.storage.estimatesForContent('no-such-hash')
        }
      })

      expect(history.recent.map((e) => e.fileName)).toEqual(['second.stp', 'first.stp'])
      expect(history.recent[0].result).toEqual({ count: 12, binding: 'geometry' })
      expect(history.forContent).toHaveLength(2)
      expect(history.other).toEqual([])
    } finally {
      await app.close()
    }
  })

  test('a rejected call surfaces as an error rather than a silent no-op', async () => {
    const { app, page } = await launchApp(isolatedProfile())
    try {
      // A blank name is refused by the store; the renderer must SEE that, or a
      // failed save would look identical to a successful one.
      const message = await page.evaluate(async () => {
        try {
          await window.api.storage.saveConfiguration('   ', {})
          return null
        } catch (error) {
          return String((error as Error).message)
        }
      })
      expect(message).toMatch(/name/i)
    } finally {
      await app.close()
    }
  })
})
