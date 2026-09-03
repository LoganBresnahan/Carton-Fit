import { expect, test } from '@playwright/test'
import {
  importSample,
  launchApp,
  readEstimate,
  setCarton,
  setField,
  waitForEstimate,
  type AppHandle
} from './harness'
import { AS1_ASSEMBLY, CUBE_STL, GOLDEN_PACKS } from '../samples/goldens'

// THE DEPLOY GATE (ADR-0005). `/deploy` runs this against the PACKAGED build
// before staging anything, because packaged builds fail in packaged-only ways —
// `file://` asset paths, the 7.6 MB WASM load, module workers — none of which
// dev-mode green can see.
//
// Every expected number comes from samples/goldens.ts, hand-computed from the
// part's dimensions rather than from the engine, so a consistent wrong answer
// still fails.

let handle: AppHandle

test.beforeEach(async () => {
  handle = await launchApp()
})

test.afterEach(async () => {
  await handle?.app.close()
})

test('boots to an interactive window with the picker path intact', async () => {
  const { page } = handle
  await expect(page.locator('[data-testid="dropzone"]')).toBeVisible()
  // ADR-0005 hangs e2e on this input existing; losing it silently would make
  // every other spec unrunnable.
  await expect(page.locator('[data-testid="file-input"]')).toHaveCount(1)
  await expect(page.locator('[data-testid="viewport-canvas"]')).toBeVisible()
  // If WebGL failed the app degrades to a message instead of throwing; a build
  // that lands there is not shippable, so assert the fallback is ABSENT.
  await expect(page.locator('[data-testid="viewport-fallback"]')).toHaveCount(0)
})

test('imports a STEP assembly through the picker and lists its parts', async () => {
  const { page } = handle
  await importSample(page, AS1_ASSEMBLY.file)

  const stats = await page.locator('[data-testid="import-stats"]').textContent()
  expect(stats).toContain(`${AS1_ASSEMBLY.partCount} parts`)
  expect(stats).toContain(AS1_ASSEMBLY.triangleCount!.toLocaleString())
  // Instance-disambiguated names (ADR-0002 addendum): repeated hardware must
  // not collapse into one entry.
  const names = await page.locator('[data-testid="parts-list"] li').allTextContents()
  expect(names).toHaveLength(AS1_ASSEMBLY.partCount)
  expect(names).toContain('nut')
  expect(names).toContain('nut (2)')
})

test('imports an STL through the picker', async () => {
  const { page } = handle
  await importSample(page, CUBE_STL.file)
  const stats = await page.locator('[data-testid="import-stats"]').textContent()
  expect(stats).toContain('1 part')
  expect(stats).toContain(`${CUBE_STL.triangleCount} triangles`)
})

// One test per golden scenario: the machine-checkable core of the deploy gate.
for (const golden of GOLDEN_PACKS) {
  test(`golden: ${golden.name}`, async () => {
    const { page } = handle
    await importSample(page, golden.part.file)

    await page.click(`[data-testid="mode-${golden.mode}"]`)
    await page.click(`[data-testid="tier-${golden.tier}"]`)
    await setCarton(page, golden.cartonIn)
    if (golden.maxWeightLb !== undefined) {
      await setField(page, 'max-weight', golden.maxWeightLb)
    }
    if (golden.partWeightLb !== undefined) {
      await setField(page, 'part-weight', golden.partWeightLb)
    }

    await waitForEstimate(page)
    const estimate = await readEstimate(page)

    // `derivation` rides along in the failure message so a red test says WHY
    // the number should have been what it was, not just that it differed.
    const because = `\n  expected by hand: ${golden.derivation}`

    if (golden.count !== undefined) {
      expect(estimate.headline, because).toContain(golden.count.toLocaleString())
    }
    if (golden.fits !== undefined) {
      expect(estimate.headline, because).toBe(golden.fits ? 'Fits' : "Doesn't fit")
    }
    // ADR-0004 requires every result to state which hard constraint bound it.
    expect(estimate.binding, because).toBe(golden.binding)
    if (golden.fill !== undefined) {
      expect(estimate.fill, because).toBe(golden.fill)
    }
    expect(estimate.tier).toBe(golden.tier)
    // ADR-0003: heuristic results must never be sold as proofs — and, since
    // 2026-09-03, must not be hedged past the point the bound forecloses.
    // These goldens are exact-fit grids, so the rigorous bound MEETS the count
    // and "a mixed arrangement may fit more" would contradict the bound printed
    // beside it (ADR-0029 phase-2 amendment 3). Read the panel's own bound
    // rather than deciding from the fixture: the two must agree on screen, and
    // that agreement is the property worth pinning here.
    if (golden.mode === 'max-quantity' && (golden.count ?? 0) > 0) {
      const shown = estimate.upperBound?.match(/[\d,]+/)?.[0]
      const atBound = shown !== undefined && shown === golden.count?.toLocaleString()
      expect(estimate.caption, because).toMatch(
        atBound ? /no arrangement beats this/ : /Heuristic/
      )
    }
  })
}
