import { expect, test } from '@playwright/test'
import { launchApp, type AppHandle } from './harness'

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

test('the inputs column never scrolls horizontally', async () => {
  const { page } = handle
  const overflow = await page.evaluate(() => {
    const el = document.querySelector('.panel-scroll')
    if (!el) throw new Error('.panel-scroll not found')
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
  })
  // Sub-pixel rounding can leave scrollWidth a hair over; 24px of overhang
  // cannot hide in a rounding error.
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
})

test('every section in the column shares the inputs left edge', async () => {
  const { page } = handle
  const edges = await page.evaluate(() => {
    const left = (selector: string): number => {
      const el = document.querySelector(selector)
      if (!el) throw new Error(`${selector} not found`)
      return el.getBoundingClientRect().left
    }
    return {
      inputs: left('.inputs'),
      presets: left('[data-testid="configurations-panel"]'),
      estimates: left('[data-testid="saved-estimates-panel"]')
    }
  })
  expect(edges.presets).toBeCloseTo(edges.inputs, 0)
  expect(edges.estimates).toBeCloseTo(edges.inputs, 0)
})

// The width itself is now a parameter, not a literal (ADR-0026 §5). Phase 3
// drives it to both bounds and re-asserts the two relationships above; this
// spec covers the wiring underneath that — the store's value reaching the
// column at all. Without it, deleting the inline custom property would leave
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
