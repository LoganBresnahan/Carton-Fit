import { expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importSample, launchApp, setCarton, waitForEstimate, type AppHandle } from './harness'

/**
 * Per-kind weight overrides (ADR-0018).
 *
 * `tests/part-kinds.test.ts` pins the grouping rules and the resolution order
 * against hand-built meshes. What only a real window can show is the chain:
 * a typed weight reaching the store, auto-run re-packing off the back of it,
 * the weight cap binding differently, and the open-mesh warning retiring
 * because the user took the advice it gave.
 *
 * The real assembly is the fixture on purpose — as1-oc-214.stp is 18 parts
 * across a handful of instanced products, which is exactly the mixed-assembly
 * case that motivated the ADR, and the case a synthetic two-part file cannot
 * represent.
 */
let handle: AppHandle

test.beforeEach(async () => {
  handle = await launchApp()
})

test.afterEach(async () => {
  await handle?.app.close()
})

test('groups instanced parts into one row per kind, with a count', async () => {
  const { page } = handle
  await importSample(page, 'as1-oc-214.stp')
  await waitForEstimate(page)

  const rows = page.locator('[data-testid="kind-item"]')
  const count = await rows.count()
  // 18 parts, far fewer kinds — the whole point of grouping. If this ever
  // equals 18, the suffix rule stopped working and every instance got a row.
  expect(count).toBeGreaterThan(1)
  expect(count).toBeLessThan(18)

  // At least one kind covers several instances, and says so.
  await expect(page.locator('.kind-count').first()).toContainText('×')
})

test('an override changes the count, and one entry covers every instance', async () => {
  const { page } = handle
  await importSample(page, 'as1-oc-214.stp')
  await page.click('[data-testid="mode-max-quantity"]')
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)

  const headline = page.locator('[data-testid="results-headline"]')
  const before = await headline.textContent()

  // Pick whichever kind the file leads with and make it heavy enough that the
  // 35 lb cap has to bind. Deriving the name from the panel rather than
  // hard-coding it keeps this spec honest if the fixture is ever re-exported.
  const kind = await page.locator('[data-testid="kind-item"] .kind-name').first().textContent()
  const name = (kind ?? '').replace(/\s*×\d+$/, '').trim()
  await page.fill(`[data-testid="kind-weight-${name}"]`, '10')
  await waitForEstimate(page)

  expect(await headline.textContent()).not.toBe(before)
  await expect(page.locator('[data-testid="results-binding"]')).toHaveText('weight')
})

test('clearing the field returns the kind to the computed weight', async () => {
  const { page } = handle
  await importSample(page, 'as1-oc-214.stp')
  await page.click('[data-testid="mode-max-quantity"]')
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)

  const headline = page.locator('[data-testid="results-headline"]')
  const before = await headline.textContent()

  const kind = await page.locator('[data-testid="kind-item"] .kind-name').first().textContent()
  const name = (kind ?? '').replace(/\s*×\d+$/, '').trim()
  const field = page.locator(`[data-testid="kind-weight-${name}"]`)

  await field.fill('10')
  await waitForEstimate(page)
  expect(await headline.textContent()).not.toBe(before)

  // Empty means "no override" — the placeholder default comes back.
  await field.fill('')
  await waitForEstimate(page)
  expect(await headline.textContent()).toBe(before)
})

test('Ctrl+Z walks a weight override back', async () => {
  const { page } = handle
  await importSample(page, 'as1-oc-214.stp')
  await waitForEstimate(page)

  const kind = await page.locator('[data-testid="kind-item"] .kind-name').first().textContent()
  const name = (kind ?? '').replace(/\s*×\d+$/, '').trim()
  const field = page.locator(`[data-testid="kind-weight-${name}"]`)
  await field.fill('3')
  await waitForEstimate(page)
  await expect(field).toHaveValue('3')

  // Number fields keep app undo (the spinner fix), so pressing it in place works.
  await field.press('Control+KeyZ')
  await expect(field).toHaveValue('')
})

// ADR-0018 §4: entering the weight directly is one of the two fixes the
// open-mesh warning itself recommends, so taking that advice must retire it.
test('overriding an open-mesh kind retires the warning it answers', async () => {
  const { page } = handle
  await importSample(page, 'cube-10x10-open.stl')
  await page.click('[data-testid="weight-density"]')
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)

  const warning = page.locator('[data-testid="results-open-mesh"]')
  await expect(warning).toBeVisible()
  await expect(warning).toContainText('Enter the part weight directly')

  // A single-kind file hides the panel (the file-wide weight already covers
  // it), so this is the documented alternative fix: switch to direct entry.
  await page.click('[data-testid="weight-direct"]')
  await waitForEstimate(page)
  await expect(warning).toHaveCount(0)
})

test('overrides ride a saved estimate and restore by kind', async () => {
  // PACKAGED ONLY, like storage.spec.ts: better-sqlite3 is compiled for
  // whichever ABI packaged last and `npm test` restores the Node one
  // (ADR-0013), so in a dev run main legitimately reports storage unavailable
  // and Save estimate does nothing. The round-trip itself is pinned in
  // tests/storage-estimates.test.ts; this proves the whole chain on the build
  // that ships.
  test.skip(
    !process.env.PACKAGED_APP,
    'needs the Electron-ABI build of better-sqlite3, which only a packaged build reliably has'
  )
  const { page } = handle
  await importSample(page, 'as1-oc-214.stp')
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)

  const kind = await page.locator('[data-testid="kind-item"] .kind-name').first().textContent()
  const name = (kind ?? '').replace(/\s*×\d+$/, '').trim()
  const field = page.locator(`[data-testid="kind-weight-${name}"]`)
  await field.fill('4')
  await waitForEstimate(page)

  await page.click('[data-testid="save-estimate"]')
  await expect(page.locator('[data-testid="save-estimate"]')).toHaveText('Saved ✓')

  // Clear it, then restore — the override has to come back with the settings.
  await field.fill('')
  await waitForEstimate(page)
  await expect(field).toHaveValue('')

  await page.locator('[data-testid="estimate-item"] button').first().click()
  await waitForEstimate(page)
  await expect(field).toHaveValue('4')
})

test('the export says the weights were corrected by hand', async () => {
  const { page } = handle
  await importSample(page, 'as1-oc-214.stp')
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)

  const kind = await page.locator('[data-testid="kind-item"] .kind-name').first().textContent()
  const name = (kind ?? '').replace(/\s*×\d+$/, '').trim()
  await page.fill(`[data-testid="kind-weight-${name}"]`, '4')
  await waitForEstimate(page)

  await page.click('[data-testid="copy-summary"]')
  const text = await page.evaluate(() => navigator.clipboard.readText())
  // Without this, a summary claiming one weight source is contradicted by its
  // own per-part table.
  expect(text).toContain('overridden individually')

  const filePath = join(mkdtempSync(join(tmpdir(), 'pe-weights-')), 'weights.csv')
  await handle.app.evaluate(({ dialog }, chosen) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: chosen })) as never
  }, filePath)
  await page.click('[data-testid="export-csv"]')
  await expect(page.locator('[data-testid="export-message"]')).toHaveText('Saved ✓')

  const csv = readFileSync(filePath, 'utf8')
  expect(csv).toContain(`Weight overrides,${name}`)
})
