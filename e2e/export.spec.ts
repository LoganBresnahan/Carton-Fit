import { expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importSample, launchApp, setCarton, waitForEstimate, type AppHandle } from './harness'

/**
 * Export (ADR-0017).
 *
 * `tests/export-builders.test.ts` pins the text and CSV derivation against
 * hand-computed numbers. What only a real window can show is the chain those
 * builders sit in: the button reading the LIVE estimate, the clipboard actually
 * receiving text, the preload surface existing, main's dialog handler writing
 * real bytes to a real path, and — the one nothing else can reach — the WebGL
 * canvas producing a non-blank PNG after the frame it drew has been composited.
 *
 * THE DIALOG IS NATIVE, so it is stubbed at the Electron layer rather than
 * driven: `dialog.showSaveDialog` is replaced in main with one that returns a
 * chosen path. Everything on both sides of it — the bytes the renderer built,
 * the file main wrote — is real.
 */
let handle: AppHandle

test.beforeEach(async () => {
  handle = await launchApp()
})

test.afterEach(async () => {
  await handle?.app.close()
})

/** Point the save dialog at a real temp path, returning it. */
async function stubSaveDialog(fileName: string): Promise<string> {
  const filePath = join(mkdtempSync(join(tmpdir(), 'pe-export-')), fileName)
  await handle.app.evaluate(({ dialog }, chosen) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: chosen })) as never
  }, filePath)
  return filePath
}

/** Make the dialog report a cancel, the way a user pressing Escape does. */
async function stubCancelledDialog(): Promise<void> {
  await handle.app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = (async () => ({ canceled: true, filePath: undefined })) as never
  })
}

async function readyEstimate(): Promise<void> {
  const { page } = handle
  await importSample(page, 'cube-10x10.stl')
  await page.click('[data-testid="mode-max-quantity"]')
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)
}

test('copy summary puts the estimate on the clipboard', async () => {
  const { page } = handle
  await readyEstimate()

  await page.click('[data-testid="copy-summary"]')
  await expect(page.locator('[data-testid="copy-summary"]')).toHaveText('Copied ✓')

  const text = await page.evaluate(() => navigator.clipboard.readText())
  // The answer, the carton it was computed in, and the constraint that bound it
  // — the three facts that make the paste worth anything.
  expect(text).toContain('27,000')
  expect(text).toContain('12 × 12 × 12 in')
  expect(text).toContain('Limited by:')
  expect(text).toContain('cube-10x10.stl')
})

test('the CSV main writes is the CSV the renderer built', async () => {
  const { page } = handle
  await readyEstimate()

  const filePath = await stubSaveDialog('estimate.csv')
  await page.click('[data-testid="export-csv"]')
  await expect(page.locator('[data-testid="export-message"]')).toHaveText('Saved ✓')

  const csv = readFileSync(filePath, 'utf8')
  const [header, first] = csv.split('\n')
  expect(header).toContain('Part,Quantity,Length (in)')
  // The 10 mm golden cube, in inches: 10 / 25.4 = 0.394.
  expect(first).toContain('0.394')
  // Plain, not the panel's grouped "27,000": this is the one figure in the
  // file someone computes with, and Number('27,000') is NaN. (This assertion
  // caught the opposite behaviour on the first run.)
  expect(csv).toContain('Result,27000')
  // Every measurement row has the header's column count — the property a
  // comma in a part name or a grouped number would break.
  const columns = header.split(',').length
  expect(first.split(',')).toHaveLength(columns)
})

test('the PNG is a real image of the packed view, not a blank buffer', async () => {
  const { page } = handle
  await readyEstimate()

  const filePath = await stubSaveDialog('packed.png')
  await page.click('[data-testid="export-png"]')
  await expect(page.locator('[data-testid="export-message"]')).toHaveText('Saved ✓')

  const bytes = readFileSync(filePath)
  // PNG signature — proof main decoded base64 rather than writing the data URL.
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  // A stale drawing buffer still encodes as a valid PNG — which is exactly why
  // the signature check above is not enough. MEASURED both ways: the real
  // capture is ~91.8 kB, and dropping the render-before-read-back (the whole
  // point of the capture seam) gives ~16.6 kB. The threshold sits between them
  // with room on both sides, and the mutation was run to prove it.
  expect(bytes.byteLength).toBeGreaterThan(20_000)
})

test('cancelling the dialog says nothing at all', async () => {
  const { page } = handle
  await readyEstimate()

  await stubCancelledDialog()
  await page.click('[data-testid="export-csv"]')

  // A cancel is a decision, not a failure: no tick, no error, no banner.
  await expect(page.locator('[data-testid="export-message"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="storage-banner"]')).toHaveCount(0)
})

test('a failed write is reported next to the button, not swallowed', async () => {
  const { page } = handle
  await readyEstimate()

  // A directory is never writable as a file — a real errno from a real write,
  // rather than a stubbed rejection that proves only the stub.
  await handle.app.evaluate(({ dialog }, chosen) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: chosen })) as never
  }, mkdtempSync(join(tmpdir(), 'pe-export-dir-')))

  await page.click('[data-testid="export-csv"]')
  const message = page.locator('[data-testid="export-message"]')
  await expect(message).toBeVisible()
  await expect(message).toHaveClass(/failed/)
  // The OS's own words, not "Error invoking remote method".
  await expect(message).not.toContainText('invoking remote method')
})

test('exports carry the warnings the panel shows (ADR-0017 §2)', async () => {
  const { page } = handle
  // The open cube: a perfect 10 mm bounding box whose volume is 33% light, so
  // density mode reports a confident and wrong weight (ADR-0015).
  await importSample(page, 'cube-10x10-open.stl')
  await page.click('[data-testid="weight-density"]')
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)

  const warning = await page.locator('[data-testid="results-open-mesh"]').textContent()
  expect(warning).toContain('not a closed mesh')

  await page.click('[data-testid="copy-summary"]')
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain('not a closed mesh')

  const filePath = await stubSaveDialog('warned.csv')
  await page.click('[data-testid="export-csv"]')
  await expect(page.locator('[data-testid="export-message"]')).toHaveText('Saved ✓')
  const csv = readFileSync(filePath, 'utf8')
  expect(csv).toContain('Warning,')
  expect(csv).toContain('not a closed mesh')
})
