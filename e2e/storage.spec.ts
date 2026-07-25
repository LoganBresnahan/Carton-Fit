import { test, expect } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importSample, launchApp, readEstimate, setCarton, waitForEstimate } from './harness'

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

/**
 * The saved-configurations UI (VISION: setups can be saved and reloaded).
 *
 * The unit tests drive the storage service with a fake API; these prove the
 * panel is wired to it — that Save reaches SQLite in the main process and Load
 * puts the values back into the real inputs.
 */
test.describe('saved configurations UI', () => {
  test.skip(!process.env.PACKAGED_APP, 'needs the Electron-ABI build of better-sqlite3')

  test('saves the current carton and restores it after changing the inputs', async () => {
    const { app, page } = await launchApp([
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pe-e2e-profile-'))}`
    ])
    try {
      await page.waitForSelector('[data-testid="configurations-panel"]')
      await expect(page.locator('[data-testid="config-empty"]')).toBeVisible()

      // A carton worth remembering, in the UI's display units.
      await page.fill('[data-testid="dim-0"]', '18')
      await page.fill('[data-testid="config-name"]', 'Big box')
      await page.click('[data-testid="config-save"]')
      await expect(page.locator('[data-testid="config-item"]')).toHaveCount(1)

      // Change the inputs, then load the preset back.
      await page.fill('[data-testid="dim-0"]', '4')
      await expect(page.locator('[data-testid="dim-0"]')).toHaveValue('4')

      await page.click('[data-testid="config-load-Big box"]')
      await expect(page.locator('[data-testid="dim-0"]')).toHaveValue('18')
    } finally {
      await app.close()
    }
  })

  test('a saved configuration survives a restart', async () => {
    const profile = [`--user-data-dir=${mkdtempSync(join(tmpdir(), 'pe-e2e-profile-'))}`]

    const first = await launchApp(profile)
    try {
      await first.page.fill('[data-testid="dim-1"]', '7')
      await first.page.fill('[data-testid="config-name"]', 'Persisted setup')
      await first.page.click('[data-testid="config-save"]')
      await expect(first.page.locator('[data-testid="config-item"]')).toHaveCount(1)
    } finally {
      await first.app.close()
    }

    const second = await launchApp(profile)
    try {
      // Listed on mount, from SQLite, in a brand-new process.
      await expect(second.page.locator('[data-testid="config-item"]')).toHaveCount(1)
      await second.page.click('[data-testid="config-load-Persisted setup"]')
      await expect(second.page.locator('[data-testid="dim-1"]')).toHaveValue('7')
    } finally {
      await second.app.close()
    }
  })

  test('estimates reach history only when the user saves one (ADR-0016)', async () => {
    const { app, page } = await launchApp([
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pe-e2e-profile-'))}`
    ])
    try {
      await importSample(page, 'cube-10x10.stp')
      await waitForEstimate(page)

      // THE POINT OF ADR-0016. Producing an estimate is not deciding to keep
      // one: under auto-run this state has already been reached dozens of times
      // while the user typed, and none of it belongs in history.
      expect(await page.evaluate(() => window.api.storage.recentEstimates())).toEqual([])

      await page.click('[data-testid="save-estimate"]')
      await expect(page.locator('[data-testid="estimate-item"]')).toHaveCount(1)

      const history = await page.evaluate(() => window.api.storage.recentEstimates())
      expect(history).toHaveLength(1)
      expect(history[0].fileName).toBe('cube-10x10.stp')
      // The hash is real, not a placeholder — history threads across renames.
      expect(history[0].contentHash).toMatch(/^[0-9a-f]{64}$/)
      expect(history[0].result).toBeTruthy()
    } finally {
      await app.close()
    }
  })

  test('editing the carton after an estimate adds nothing to history', async () => {
    // The regression guard for reintroducing auto-recording by accident: this
    // is exactly the keystroke flood the old implementation filed.
    const { app, page } = await launchApp([
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pe-e2e-profile-'))}`
    ])
    try {
      await importSample(page, 'cube-10x10.stp')
      await setCarton(page, [12, 12, 12])
      await waitForEstimate(page)
      await setCarton(page, [10, 9, 8])
      await waitForEstimate(page)
      await setCarton(page, [6, 6, 6])
      await waitForEstimate(page)

      expect(await page.evaluate(() => window.api.storage.recentEstimates())).toEqual([])
    } finally {
      await app.close()
    }
  })

  test('a saved estimate restores its inputs, and the result is recomputed', async () => {
    const { app, page } = await launchApp([
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pe-e2e-profile-'))}`
    ])
    try {
      await importSample(page, 'cube-10x10.stl')
      await page.click('[data-testid="mode-max-quantity"]')
      await setCarton(page, [12, 12, 12])
      await waitForEstimate(page)
      const original = (await readEstimate(page)).headline
      expect(original).toContain('27,000') // the hand-computed golden

      await page.click('[data-testid="save-estimate"]')
      await expect(page.locator('[data-testid="estimate-item"]')).toHaveCount(1)

      // Move away, then restore.
      await setCarton(page, [3, 3, 3])
      await waitForEstimate(page)
      expect((await readEstimate(page)).headline).toContain('343')

      await page.click('[data-testid^="estimate-restore-"]')
      await waitForEstimate(page)
      await expect(page.locator('[data-testid="dim-0"]')).toHaveValue('12')
      // Recomputed from the restored inputs, not replayed from the row.
      expect((await readEstimate(page)).headline).toContain('27,000')
    } finally {
      await app.close()
    }
  })

  test('a saved estimate survives a restart', async () => {
    const profile = [`--user-data-dir=${mkdtempSync(join(tmpdir(), 'pe-e2e-profile-'))}`]

    const first = await launchApp(profile)
    try {
      await importSample(first.page, 'cube-10x10.stl')
      await waitForEstimate(first.page)
      await first.page.click('[data-testid="save-estimate"]')
      await expect(first.page.locator('[data-testid="estimate-item"]')).toHaveCount(1)
    } finally {
      await first.app.close()
    }

    const second = await launchApp(profile)
    try {
      await expect(second.page.locator('[data-testid="estimate-item"]')).toHaveCount(1)
      await expect(second.page.locator('[data-testid="estimate-summary"]').first()).toContainText(
        /in|mm/
      )
    } finally {
      await second.app.close()
    }
  })
})
