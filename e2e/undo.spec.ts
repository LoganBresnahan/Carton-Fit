import { expect, test } from '@playwright/test'
import { importSample, launchApp, readEstimate, setCarton, waitForEstimate } from './harness'
import type { AppHandle } from './harness'

/**
 * Input undo/redo (ADR-0016 §2).
 *
 * `tests/undo.test.ts` pins the stack behaviour against a controllable clock.
 * What only a real window can show is the chain this feature actually depends
 * on: a keystroke reaching a window-level listener, the store write it causes,
 * and auto-run re-packing off the back of it. Every link there can break while
 * the unit tests stay green.
 */
let handle: AppHandle

test.beforeEach(async () => {
  handle = await launchApp()
})
test.afterEach(async () => {
  await handle?.app.close()
})

/** Ctrl+Z with focus OUTSIDE any text field — inside one it means "undo my
 *  typing", which is the browser's job and deliberately left alone. */
async function pressUndo(redo = false): Promise<void> {
  const { page } = handle
  await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press(redo ? 'Control+Shift+KeyZ' : 'Control+KeyZ')
}

test('Ctrl+Z walks the carton back and re-runs the estimate', async () => {
  const { page } = handle
  await importSample(page, 'cube-10x10.stl')
  await page.click('[data-testid="mode-max-quantity"]')
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)
  expect((await readEstimate(page)).headline).toContain('27,000')

  await setCarton(page, [3, 3, 3])
  await waitForEstimate(page)
  expect((await readEstimate(page)).headline).toContain('343')

  // Three dimensions were changed, so three steps back to the 12 in carton.
  await pressUndo()
  await pressUndo()
  await pressUndo()
  await waitForEstimate(page)

  await expect(page.locator('[data-testid="dim-0"]')).toHaveValue('12')
  await expect(page.locator('[data-testid="dim-2"]')).toHaveValue('12')
  // The estimate followed the inputs back — undoing an input IS undoing the
  // estimate under auto-run, with no result ever stored or replayed.
  expect((await readEstimate(page)).headline).toContain('27,000')
})

test('Ctrl+Shift+Z goes forward again', async () => {
  const { page } = handle
  await importSample(page, 'cube-10x10.stl')
  await page.click('[data-testid="mode-max-quantity"]')
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)

  await setCarton(page, [3, 3, 3])
  await waitForEstimate(page)

  await pressUndo()
  await pressUndo()
  await pressUndo()
  await waitForEstimate(page)
  await expect(page.locator('[data-testid="dim-0"]')).toHaveValue('12')

  await pressUndo(true)
  await pressUndo(true)
  await pressUndo(true)
  await waitForEstimate(page)
  await expect(page.locator('[data-testid="dim-0"]')).toHaveValue('3')
  expect((await readEstimate(page)).headline).toContain('343')
})

test('undo does nothing at the start of the session rather than breaking', async () => {
  const { page } = handle
  await importSample(page, 'cube-10x10.stl')
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)

  for (let i = 0; i < 8; i++) await pressUndo()
  await waitForEstimate(page)

  // Whatever it walks back to, the app is still working and still answering.
  await expect(page.locator('[data-testid="results-panel"]')).toBeVisible()
  await expect(page.locator('[data-testid="results-headline"]')).toBeVisible()
})

test('Ctrl+Z inside a text field is left to the browser', async () => {
  // Hijacking it there would break the one thing every user expects Ctrl+Z to
  // do in a text box, and would be worse than having no undo at all.
  const { page } = handle
  await importSample(page, 'cube-10x10.stl')
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)

  await page.fill('[data-testid="config-name"]', 'a preset name')
  await page.locator('[data-testid="config-name"]').press('Control+KeyZ')

  // The carton is untouched: the keystroke never reached the input history.
  await expect(page.locator('[data-testid="dim-0"]')).toHaveValue('12')
})
