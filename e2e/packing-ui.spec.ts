import { expect, test } from '@playwright/test'
import {
  importSample,
  launchApp,
  readEstimate,
  setCarton,
  waitForEstimate,
  type AppHandle
} from './harness'
import { AS1_ASSEMBLY, CUBE_STL, OPEN_CUBE_STL } from '../samples/goldens'

// The interaction layer the deploy gate does not cover: auto-run, the unit
// picker, the model/packed toggle, truncated layouts, and settings persistence.
//
// These assert BEHAVIOUR and RELATIONSHIPS rather than magic constants wherever
// a constant could not be derived by hand — asserting a number I cannot justify
// would just re-record whatever the engine happens to do, which is the
// tautology ADR-0005's golden rule exists to prevent.

let handle: AppHandle

test.beforeEach(async () => {
  handle = await launchApp()
})

test.afterEach(async () => {
  await handle?.app.close()
})

test('the estimate follows the inputs with no compute button (ADR-0009)', async () => {
  const { page } = handle
  await importSample(page, CUBE_STL.file)
  await page.click('[data-testid="mode-max-quantity"]')
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)
  expect((await readEstimate(page)).headline).toContain('27,000')

  // No button is pressed here — shrinking the carton alone must re-pack.
  await setCarton(page, [3, 3, 3])
  await waitForEstimate(page)
  expect((await readEstimate(page)).headline).toContain('343')

  // And there is genuinely no compute affordance to press.
  await expect(page.getByRole('button', { name: /compute|calculate|run/i })).toHaveCount(0)
})

test('reports a truncated layout honestly when the count outruns the drawing', async () => {
  const { page } = handle
  await importSample(page, CUBE_STL.file)
  await page.click('[data-testid="mode-max-quantity"]')
  // 15 in = 381 mm; floor(381 / 10) = 38 per axis → 38³ = 54,872, which is past
  // the 50,000 placement cap, so the COUNT stays exact while the 3D view shows
  // a partial layout — and the panel has to say so.
  await setCarton(page, [15, 15, 15])
  await waitForEstimate(page)

  const estimate = await readEstimate(page)
  expect(estimate.headline).toContain('54,872')
  expect(estimate.truncated).toContain('50,000')
  expect(estimate.truncated).toContain('54,872')
  expect(estimate.truncated).toMatch(/count is exact/)
})

test('names the parts that did not fit', async () => {
  const { page } = handle
  await importSample(page, AS1_ASSEMBLY.file)
  await setCarton(page, [1, 1, 1]) // 25.4 mm: far too small for the plate or rod
  await waitForEstimate(page)

  const estimate = await readEstimate(page)
  expect(estimate.headline).toBe("Doesn't fit")
  expect(estimate.binding).toBe('space')
  expect(estimate.unplaced ?? '').not.toHaveLength(0)
  // ADR-0003: a greedy non-fit is never presented as a proof.
  expect(estimate.caption).toMatch(/not a proof the rest cannot fit/)
})

test('explains a non-fit with the free space it could not use (ADR-0022 §7)', async () => {
  const { page } = handle
  await importSample(page, AS1_ASSEMBLY.file)
  await setCarton(page, [3, 3, 3]) // 76.2 mm: holds some of the assembly, not all
  await waitForEstimate(page)

  const estimate = await readEstimate(page)
  expect(estimate.headline).toBe("Doesn't fit")
  const note = estimate.freeSpace ?? ''
  expect(note).not.toHaveLength(0)

  // Asserted as RELATIONSHIPS, not as dimensions: the exact void depends on the
  // arrangement two engines raced for, and a hand-computed triple here would just
  // re-record whatever the winner happened to do (ADR-0005's golden rule).
  //
  // 1. On-screen units, said once per triple — a bare number is how a 3 in carton
  //    gets read as 3 mm.
  expect(note).toMatch(/Largest free space: [\d.]+ × [\d.]+ × [\d.]+ in/)
  // 2. Both triples descending, so they compare down the line.
  const triples = [...note.matchAll(/([\d.]+) × ([\d.]+) × ([\d.]+)/g)].map((m) =>
    m.slice(1).map(Number)
  )
  expect(triples.length).toBeGreaterThanOrEqual(1)
  for (const [a, b, c] of triples) {
    expect(a).toBeGreaterThanOrEqual(b)
    expect(b).toBeGreaterThanOrEqual(c)
  }
  // 3. When the comparison is stated, it names a part the panel ALSO lists as
  //    unplaced — a sentence about a part that fit would be worse than silence.
  const named = note.match(/orientation of “([^”]+)”/)
  if (named) {
    expect(estimate.unplaced ?? '').toContain(named[1])
    // ...and the gate held: what it needs does not fit what is left.
    const [space, need] = triples
    expect(need.some((value, axis) => value > space[axis])).toBe(true)
  }
  // 4. It explains; it never concludes. Placement is still heuristic.
  expect(note).not.toMatch(/too small|cannot|impossible/i)
  expect(estimate.caption).toMatch(/not a proof the rest cannot fit/)
})

test('states the rigorous upper bound beside the count (ADR-0022 §7)', async () => {
  const { page } = handle
  await importSample(page, CUBE_STL.file)
  await page.click('[data-testid="mode-max-quantity"]')
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)

  // Hand-computed, and the interesting case: 304.8 mm / 10 mm = 30 per axis, so
  // 27,000 copies — and the per-axis bound is that same 30³, below the volumetric
  // bound of floor(304.8³ / 1000) = 28,315. Count and bound MEET, which means this
  // answer is not a heuristic at all any more: nothing can beat it, and the panel
  // says so by printing the same number twice.
  const estimate = await readEstimate(page)
  expect(estimate.headline).toContain('27,000')
  expect(estimate.upperBound).toBe('(upper bound 27,000)')
})

test('the unit picker changes what max-quantity replicates (ADR-0003)', async () => {
  const { page } = handle
  await importSample(page, AS1_ASSEMBLY.file)

  // Fit-check asks about the whole file, so the control is not offered.
  await expect(page.locator('[data-testid="unit-picker"]')).toHaveCount(0)

  await page.click('[data-testid="mode-max-quantity"]')
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)
  await expect(page.locator('[data-testid="unit-select"]')).toBeVisible()
  const wholeFile = Number(
    (await readEstimate(page)).headline.replace(/[^0-9]/g, '') || '0'
  )

  // One nut is far smaller than the whole 18-part assembly, so many more fit.
  // The relationship is derivable; the exact count is not, so only this is
  // asserted.
  await page.selectOption('[data-testid="unit-select"]', 'nut')
  await waitForEstimate(page)
  const singlePart = Number(
    (await readEstimate(page)).headline.replace(/[^0-9]/g, '') || '0'
  )

  expect(wholeFile).toBeGreaterThan(0)
  expect(singlePart).toBeGreaterThan(wholeFile * 10)
})

test('the model/packed toggle pins the view against re-packs', async () => {
  const { page } = handle
  await importSample(page, CUBE_STL.file)
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)

  // The toggle appears only once there is an estimate to toggle away from.
  const toggle = page.locator('[data-testid="view-toggle"]')
  await expect(toggle).toBeVisible()
  await expect(page.locator('[data-testid="view-packed"]')).toHaveAttribute(
    'aria-checked',
    'true'
  )

  await page.click('[data-testid="view-model"]')
  await expect(page.locator('[data-testid="view-model"]')).toHaveAttribute(
    'aria-checked',
    'true'
  )

  // Under ADR-0009 a re-pack is a keystroke away; it must NOT drag the user
  // back to the packed view while they are inspecting the model.
  await setCarton(page, [10, 10, 10])
  await waitForEstimate(page)
  await expect(page.locator('[data-testid="view-model"]')).toHaveAttribute(
    'aria-checked',
    'true'
  )
})

test('persists carton settings across a restart (roadmap item 3)', async () => {
  const { page } = handle
  await importSample(page, CUBE_STL.file)
  await setCarton(page, [7, 8, 9])
  await waitForEstimate(page)

  await page.reload()
  await page.waitForSelector('[data-testid="dropzone"]')
  await expect(page.locator('[data-testid="dim-0"]')).toHaveValue('7')
  await expect(page.locator('[data-testid="dim-1"]')).toHaveValue('8')
  await expect(page.locator('[data-testid="dim-2"]')).toHaveValue('9')
})

// Roadmap item 9. The one place the app could state a wrong answer with full
// confidence: density mode multiplies a mesh volume that an open mesh makes
// meaningless, and weight is a hard constraint, so the part count inherits the
// error. The warning must appear exactly when the wrong number is on screen.
test('warns when a density weight rests on an open mesh', async () => {
  const { page } = handle
  const warning = page.locator('[data-testid="results-open-mesh"]')

  await importSample(page, OPEN_CUBE_STL.file)
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)
  // Direct weight does not touch the volume, so there is nothing to warn about.
  await expect(warning).toHaveCount(0)

  await page.click('[data-testid="weight-density"]')
  await waitForEstimate(page)
  await expect(warning).toBeVisible()
  await expect(warning).toContainText(/not a closed mesh/)

  // And it clears the moment the answer stops depending on the volume.
  await page.click('[data-testid="weight-direct"]')
  await waitForEstimate(page)
  await expect(warning).toHaveCount(0)
})

test('stays quiet about a closed mesh in density mode', async () => {
  // The negative half: a warning that fires on every part is noise, and would
  // train the user to ignore the one case that matters.
  const { page } = handle
  await importSample(page, CUBE_STL.file)
  await page.click('[data-testid="weight-density"]')
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)
  await expect(page.locator('[data-testid="results-open-mesh"]')).toHaveCount(0)
})

test('converts display units without changing the stored answer', async () => {
  const { page } = handle
  await importSample(page, CUBE_STL.file)
  await page.click('[data-testid="mode-max-quantity"]')
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)
  const imperial = await readEstimate(page)

  await page.click('[data-testid="unit-toggle"]')
  // 12 in is exactly 304.8 mm — display changes, canonical storage does not.
  await expect(page.locator('[data-testid="dim-0"]')).toHaveValue('304.8')
  await waitForEstimate(page)
  expect((await readEstimate(page)).headline).toBe(imperial.headline)
})

test('a weight unit selector converts its own display without changing the answer (ADR-0024)', async () => {
  const { page } = handle
  await importSample(page, CUBE_STL.file)
  await page.click('[data-testid="mode-max-quantity"]')
  await setCarton(page, [12, 12, 12])
  await waitForEstimate(page)
  const before = await readEstimate(page)

  await page.selectOption('[data-testid="max-weight-unit"]', 'g')
  // The default 35 lb cap re-displays as grams — same canonical value, never rescaled.
  await expect(page.locator('[data-testid="max-weight"]')).toHaveValue('15875.733')
  // The packed-weight line spends against the cap, so it follows the cap's unit…
  await expect(page.locator('[data-testid="results-weight"]')).toContainText(' g')
  // …and the estimate itself is untouched.
  await waitForEstimate(page)
  expect((await readEstimate(page)).headline).toBe(before.headline)

  // The per-part unit is its own choice (ADR-0024) — switching the cap left it alone.
  await expect(page.locator('[data-testid="part-weight-unit"]')).toHaveValue('lb')
})

test('clicking a number field selects its value, so typing replaces it (ADR-0024)', async () => {
  // Selection state is unreadable on a number input (Chromium throws on
  // selectionStart), so assert the behaviour instead: without select-on-focus
  // this types 125 or 512, not 5.
  const { page } = handle
  await importSample(page, CUBE_STL.file)
  await setCarton(page, [12, 12, 12])
  await page.click('[data-testid="dim-0"]')
  await page.keyboard.type('5')
  await expect(page.locator('[data-testid="dim-0"]')).toHaveValue('5')
})
