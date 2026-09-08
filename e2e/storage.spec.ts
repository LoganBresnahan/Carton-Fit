import { test, expect } from '@playwright/test'
import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SAMPLES,
  importSample,
  launchApp,
  openSavedEstimates,
  readEstimate,
  setCarton,
  waitForEstimate
} from './harness'

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
      // 2: ADR-0034 §3's `document_versions`; 3: ADR-0035's customers.
      expect(health.schemaVersion).toBe(3)
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
      const picker = page.locator('[data-testid="preset-select"]')
      await expect(picker).toBeDisabled()
      await expect(picker).toContainText('No presets yet')

      // A carton worth remembering, in the UI's display units.
      await page.fill('[data-testid="dim-0"]', '18')
      await page.fill('[data-testid="config-name"]', 'Big box')
      await page.click('[data-testid="config-save"]')
      await expect(page.locator('[data-testid="config-item"]')).toHaveCount(1)

      // Change the inputs, then load the preset back.
      await page.fill('[data-testid="dim-0"]', '4')
      await expect(page.locator('[data-testid="dim-0"]')).toHaveValue('4')

      await picker.selectOption('Big box')
      await expect(page.locator('[data-testid="dim-0"]')).toHaveValue('18')
      // The picker reads the preset just applied…
      await expect(picker).toHaveValue('Big box')
      // …and comes off it the moment the fields move (ADR-0034 §5).
      await page.fill('[data-testid="dim-0"]', '5')
      await expect(picker).toHaveValue('')

      // Delete acts on the picked preset, from the same two controls.
      await picker.selectOption('Big box')
      await page.click('[data-testid="config-delete-Big box"]')
      await expect(page.locator('[data-testid="config-item"]')).toHaveCount(0)
      await expect(picker).toBeDisabled()
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
      await second.page.locator('[data-testid="preset-select"]').selectOption('Persisted setup')
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

      await openSavedEstimates(page)
      await page.click('[data-testid^="estimate-restore-"]')
      await waitForEstimate(page)
      await expect(page.locator('[data-testid="dim-0"]')).toHaveValue('12')
      // Recomputed from the restored inputs, not replayed from the row.
      expect((await readEstimate(page)).headline).toContain('27,000')
    } finally {
      await app.close()
    }
  })

  test('the saved-estimates list is scoped to the loaded model; All shows everything (ADR-0034 §3)', async () => {
    const { app, page } = await launchApp([
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pe-e2e-profile-'))}`
    ])
    const items = page.locator('[data-testid="estimate-item"]')
    const scope = page.locator('[data-testid="estimates-scope"]')
    const model = page.locator('[data-testid="estimates-scope-model"]')
    const all = page.locator('[data-testid="estimates-scope-all"]')
    try {
      // Nothing loaded: nothing to scope to, the line says so, no switch.
      await expect(scope).toHaveAttribute('data-scope', 'all')
      await expect(model).toHaveCount(0)

      // Save on part A.
      await importSample(page, 'cube-10x10.stp')
      await waitForEstimate(page)
      await expect(scope).toHaveAttribute('data-scope', 'model')
      await expect(scope).toContainText('cube-10x10.stp')
      await page.click('[data-testid="save-estimate"]')
      await expect(items).toHaveCount(1)

      // Load part B: the list is B's — empty — and no row was deleted.
      await importSample(page, 'as1-oc-214.stp')
      await waitForEstimate(page)
      await expect(scope).toContainText('as1-oc-214.stp')
      await expect(items).toHaveCount(0)
      await expect(page.locator('[data-testid="estimates-empty"]')).toContainText('this model')
      expect(await page.evaluate(() => window.api.storage.recentEstimates())).toHaveLength(1)

      // Save on B, then All shows both, newest first.
      await page.click('[data-testid="save-estimate"]')
      await expect(items).toHaveCount(1)
      await expect(items.first()).toContainText('as1-oc-214.stp')
      // The switch shows the CURRENT state lit, and both states at once —
      // a button that named the other state was read as the current one.
      await expect(model).toHaveAttribute('aria-checked', 'true')
      await expect(all).toHaveAttribute('aria-checked', 'false')
      await openSavedEstimates(page)
      await all.click()
      await expect(scope).toHaveAttribute('data-scope', 'all')
      await expect(all).toHaveAttribute('aria-checked', 'true')
      await expect(items).toHaveCount(2)
      await expect(items.nth(0)).toContainText('as1-oc-214.stp')
      await expect(items.nth(1)).toContainText('cube-10x10.stp')

      // And back: the scope is a view, not a filter that lost anything.
      await model.click()
      await expect(items).toHaveCount(1)
      await expect(items.first()).toContainText('as1-oc-214.stp')
    } finally {
      await app.close()
    }
  })

  test('a re-exported part is offered as a new version; the person decides (ADR-0034 §3)', async () => {
    // Two samples stand in for rev A and rev B of one part: a copy of the
    // assembly under the cube's file name is a different hash with the same
    // name, which is all the offer's rule looks at.
    const { app, page } = await launchApp([
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pe-e2e-profile-'))}`
    ])
    const items = page.locator('[data-testid="estimate-item"]')
    const offer = page.locator('[data-testid="estimate-link-offer"]')
    const revB = join(mkdtempSync(join(tmpdir(), 'pe-e2e-revb-')), 'cube-10x10.stp')
    copyFileSync(join(SAMPLES, 'as1-oc-214.stp'), revB)
    try {
      // Rev A: two receipts.
      await importSample(page, 'cube-10x10.stp')
      await waitForEstimate(page)
      await expect(offer).toHaveCount(0)
      await page.click('[data-testid="save-estimate"]')
      await expect(items).toHaveCount(1)
      await page.click('[data-testid="save-estimate"]')
      await expect(items).toHaveCount(2)

      // Rev B under the same name: unknown hash, so the offer appears, and
      // the scoped list is empty until the person answers.
      await page.setInputFiles('[data-testid="file-input"]', revB)
      await page.waitForSelector('[data-testid="import-stats"]', { timeout: 30_000 })
      await waitForEstimate(page)
      await expect(offer).toContainText('2 saved estimates exist for an earlier cube-10x10.stp')
      await expect(items).toHaveCount(0)

      // Keep separate: nothing written, the offer goes, the list stays B's.
      await page.click('[data-testid="estimate-link-decline"]')
      await expect(offer).toHaveCount(0)
      await expect(items).toHaveCount(0)

      // Loading rev B again re-asks — nothing was linked, and no receipt was
      // saved under it, so it is still unknown. This time: Link.
      await importSample(page, 'as1-oc-214.stp')
      await waitForEstimate(page)
      await page.setInputFiles('[data-testid="file-input"]', revB)
      await page.waitForSelector('[data-testid="import-stats"]', { timeout: 30_000 })
      await waitForEstimate(page)
      await expect(offer).toHaveCount(1)
      await page.click('[data-testid="estimate-link-accept"]')
      await expect(offer).toHaveCount(0)

      // Rev A's receipts now show under rev B, labelled as the earlier version…
      await expect(items).toHaveCount(2)
      await expect(page.locator('[data-testid="estimate-earlier-version"]')).toHaveCount(2)
      // …every row keeps the hash it was saved against…
      const rows = await page.evaluate(() => window.api.storage.recentEstimates())
      expect(new Set(rows.map((r) => r.contentHash)).size).toBe(1)
      // …and a receipt saved now is the current version, unlabelled.
      await page.click('[data-testid="save-estimate"]')
      await expect(items).toHaveCount(3)
      await expect(items.first().locator('[data-testid="estimate-earlier-version"]')).toHaveCount(0)
      await expect(page.locator('[data-testid="estimate-earlier-version"]')).toHaveCount(2)

      // Restoring an earlier version's receipt recomputes against the
      // geometry loaded now (ADR-0016 §3) — which is what makes linking safe.
      await openSavedEstimates(page)
      await page.click('[data-testid^="estimate-restore-"] >> nth=2')
      await waitForEstimate(page)
    } finally {
      await app.close()
    }
  })

  test('every saved estimate is listed, not the first twelve', async () => {
    const { app, page } = await launchApp([
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pe-e2e-profile-'))}`
    ])
    try {
      await page.evaluate(async () => {
        for (let i = 0; i < 15; i++) {
          await window.api.storage.recordEstimate({
            fileName: 'many.stp',
            contentHash: 'many',
            settings: {},
            result: { mode: 'fit-check', fits: true, binding: 'geometry' }
          })
        }
      })
      await page.reload()
      await expect(page.locator('[data-testid="estimate-item"]')).toHaveCount(15)
      await expect(page.locator('[data-testid="estimates-count"]')).toHaveText('15')
    } finally {
      await app.close()
    }
  })

  test('the saved-estimates section folds, counts, and remembers (ADR-0034 §5)', async () => {
    const profile = [`--user-data-dir=${mkdtempSync(join(tmpdir(), 'pe-e2e-profile-'))}`]
    const first = await launchApp(profile)
    try {
      const details = first.page.locator('[data-testid="saved-estimates-details"]')
      const count = first.page.locator('[data-testid="estimates-count"]')
      // Closed by default, and the summary says what it holds.
      await expect(details).not.toHaveAttribute('open', '')
      await expect(count).toHaveText('none yet')

      await importSample(first.page, 'cube-10x10.stl')
      await waitForEstimate(first.page)
      await first.page.click('[data-testid="save-estimate"]')
      await expect(count).toHaveText('1 for this model')
      // The count sees the scope: All widens it, and says so.
      await openSavedEstimates(first.page)
      await first.page.click('[data-testid="estimates-scope-all"]')
      await expect(count).toHaveText('1 across all models')
    } finally {
      await first.app.close()
    }

    // Opened once, open next time.
    const second = await launchApp(profile)
    try {
      await expect(second.page.locator('[data-testid="saved-estimates-details"]')).toHaveAttribute(
        'open',
        ''
      )
    } finally {
      await second.app.close()
    }
  })

  test('a saved estimate can be deleted from the panel (ADR-0034 §4)', async () => {
    const { app, page } = await launchApp([
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pe-e2e-profile-'))}`
    ])
    const items = page.locator('[data-testid="estimate-item"]')
    try {
      await importSample(page, 'cube-10x10.stl')
      await waitForEstimate(page)
      await page.click('[data-testid="save-estimate"]')
      await expect(items).toHaveCount(1)
      await page.click('[data-testid="save-estimate"]')
      await expect(items).toHaveCount(2)

      const [newest, oldest] = await page.evaluate(() => window.api.storage.recentEstimates())
      await openSavedEstimates(page)
      await page.click(`[data-testid="estimate-delete-${newest.id}"]`)
      // The row is seen leaving before it is gone: it fades first, and the
      // delete follows the fade.
      await expect(items.first()).toHaveClass(/removing/)
      await expect(items).toHaveCount(1)

      // The right row went, and it went from the database, not just the list.
      const left = await page.evaluate(() => window.api.storage.recentEstimates())
      expect(left.map((r) => r.id)).toEqual([oldest.id])
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
