import { expect, test } from '@playwright/test'
import { launchApp, stepPanelWidth, type AppHandle } from './harness'

// The inputs column's geometry, guarded because dogfooding caught it and no
// other spec could have.
//
// Presets and Saved estimates were written with `className="panel"` — the LEFT
// COLUMN's own class, which carries `width: 360px` and a `border-right`. Nested
// inside that same 360px column, which already spends 1.5rem on padding, the two
// sections overhung both edges by 24px and gave the column a horizontal
// scrollbar. Every functional spec passed throughout: the controls were all
// present, clickable and correct, just 24px into the margin.
//
// So these assert RELATIONSHIPS, not pixel values — the column must not scroll
// sideways, and sections in one column must share one left edge. Both survive a
// change of width, padding or font.

let handle: AppHandle

test.beforeEach(async () => {
  handle = await launchApp()
})

test.afterEach(async () => {
  await handle?.app.close()
})

/**
 * The two relationships, as one check that can be re-run at any width.
 *
 * A helper rather than two tests, because ADR-0026 makes width a parameter:
 * the same pair has to hold at the minimum and the maximum, and a narrow
 * column is where an overhang reappears first.
 */
async function expectColumnGeometryHolds(handle: AppHandle, at: string): Promise<void> {
  const { page } = handle
  const geometry = await page.evaluate(() => {
    const el = document.querySelector('.panel-scroll')
    if (!el) throw new Error('.panel-scroll not found')
    const left = (selector: string): number => {
      const found = document.querySelector(selector)
      if (!found) throw new Error(`${selector} not found`)
      return found.getBoundingClientRect().left
    }
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      inputs: left('.inputs'),
      presets: left('[data-testid="configurations-panel"]'),
      estimates: left('[data-testid="saved-estimates-panel"]')
    }
  })
  // Sub-pixel rounding can leave scrollWidth a hair over; 24px of overhang
  // cannot hide in a rounding error.
  expect(geometry.scrollWidth, `the column scrolls sideways at ${at}`).toBeLessThanOrEqual(
    geometry.clientWidth + 1
  )
  expect(geometry.presets, `presets left the inputs left edge at ${at}`).toBeCloseTo(
    geometry.inputs,
    0
  )
  expect(geometry.estimates, `saved estimates left the inputs left edge at ${at}`).toBeCloseTo(
    geometry.inputs,
    0
  )
}

test('the column geometry holds at the default width', async () => {
  await expectColumnGeometryHolds(handle, 'the default width')
})

// ADR-0026 §4's bounds. Both are reached by pressing well past them, so it is
// the clamp that stops the column rather than an exact count of presses.
test('the column geometry holds at the minimum width', async () => {
  expect(await stepPanelWidth(handle.page, 'narrower', 8)).toBe(280)
  await expectColumnGeometryHolds(handle, 'the 280px minimum')
})

test('the column geometry holds at the maximum width', async () => {
  expect(await stepPanelWidth(handle.page, 'wider', 20)).toBe(640)
  await expectColumnGeometryHolds(handle, 'the 640px maximum')
})

// The width itself is now a parameter, not a literal (ADR-0026 §5). The three
// specs above re-assert the relationships at each end of its range; this one
// covers the wiring underneath them — the store's value reaching the column at
// all. Without it, deleting the inline custom property would leave
// every functional spec green and the panel stuck at the CSS fallback, which
// is the exact shape of the bug this file exists for.
test('the column width comes from --panel-width, not the CSS fallback', async () => {
  const { page } = handle
  const initial = await page.evaluate(() => {
    const panel = document.querySelector('.panel')
    if (!(panel instanceof HTMLElement)) throw new Error('.panel not found')
    return {
      inline: panel.style.getPropertyValue('--panel-width'),
      width: getComputedStyle(panel).width
    }
  })
  // The store writes the property, and the default width is what it holds.
  expect(initial.inline).toBe('360px')
  expect(initial.width).toBe('360px')

  // ...and the property is LIVE: move it and the column follows. A fallback
  // left in place would sit at 360 while this reads 520.
  const moved = await page.evaluate(() => {
    const panel = document.querySelector('.panel') as HTMLElement
    panel.style.setProperty('--panel-width', '520px')
    return getComputedStyle(panel).width
  })
  expect(moved).toBe('520px')
})
