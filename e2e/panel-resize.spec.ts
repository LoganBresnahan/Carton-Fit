import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, maxPanelWidth, panelWidth, stepPanelWidth, type AppHandle } from './harness'

/**
 * The resizable control panel (ADR-0026), end to end.
 *
 * `tests/panel-width.test.ts` and `tests/panel-controls.test.ts` pin the clamp
 * and the key routing against plain data. What only a real launch can show is
 * the wiring around them: that a width reaches the column, survives a restart,
 * is ignored while a field has focus, resets on double-click, re-clamps when
 * the window narrows, and that the viewport re-frames behind it. Every one of
 * those can break with the unit tests still green.
 *
 * Widths are read from the rendered column, never from drag pixels: a drag
 * asserted in mouse coordinates would be measuring the pointer, and the bounds
 * make the two deliberately disagree.
 */

/** ADR-0026 §4's two flat bounds. The CEILING is deliberately not here: it is
 *  `min(640, half the window)`, and which half of that wins changes with the
 *  machine — 640 on a 1280px window, 504 on the ~1008px one windows-latest
 *  opens. Specs read it from the window through `maxPanelWidth`. */
const DEFAULT_WIDTH = 360
const MIN_WIDTH = 280

function profile(): string[] {
  return [`--user-data-dir=${mkdtempSync(join(tmpdir(), 'pe-e2e-panel-'))}`]
}

/** Drag the handle so the column's right edge lands at `target` px.
 *
 *  Returns the width the column actually took, which is the clamp's answer and
 *  not necessarily `target`. */
async function dragHandleTo(handle: AppHandle, target: number): Promise<number> {
  const { page } = handle
  const box = await page.locator('.panel-resize-handle').boundingBox()
  if (box === null) throw new Error('the resize handle has no box — is it rendered?')
  const left = await page.evaluate(() => {
    const panel = document.querySelector('.panel')
    if (!panel) throw new Error('.panel not found')
    return panel.getBoundingClientRect().left
  })
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  // Two moves, not one: pointer capture only starts on the first move after
  // the press, and a single jump has been enough to miss it before.
  await page.mouse.move(left + target - 20, box.y + box.height / 2)
  await page.mouse.move(left + target, box.y + box.height / 2)
  await page.mouse.up()
  return panelWidth(page)
}

test('the width survives a restart', async () => {
  // One profile across two launches, the storage specs' pattern — the harness
  // otherwise hands out a throwaway one and nothing could persist.
  const args = profile()

  const first = await launchApp(args)
  let chosen: number
  try {
    chosen = await stepPanelWidth(first.page, 'wider', 2)
    expect(chosen, 'the keys did not move the width, so the restart proves nothing').toBe(
      DEFAULT_WIDTH + 80
    )
  } finally {
    await first.app.close()
  }

  const second = await launchApp(args)
  try {
    expect(await panelWidth(second.page)).toBe(chosen)
    // ...and it is the STORE's value, not a stale stylesheet that happens to
    // agree: the custom property has to carry it (ADR-0026 §5).
    const inline = await second.page.evaluate(() => {
      const panel = document.querySelector('.panel') as HTMLElement
      return panel.style.getPropertyValue('--panel-width')
    })
    expect(inline).toBe(`${chosen}px`)
  } finally {
    await second.app.close()
  }
})

test.describe('one launch', () => {
  let handle: AppHandle

  test.beforeEach(async () => {
    handle = await launchApp()
  })

  test.afterEach(async () => {
    await handle?.app.close()
  })

  test('the keys are ignored inside fields and honored on the body', async () => {
    const { page } = handle

    // A TEXT field — the preset name, which is where a user types words and `>`
    // is a character they might want.
    await page.click('[data-testid="config-name"]')
    await page.keyboard.press('Shift+.')
    await page.keyboard.press('Shift+.')
    expect(await panelWidth(page), 'a text field lost its keystroke to the panel').toBe(
      DEFAULT_WIDTH
    )

    // A NUMBER field. This is the case the rule was extended for (ADR-0026 §2):
    // undo's near-twin predicate deliberately EXCLUDES number inputs, so a
    // binding that reused it would move the width from here and nowhere else.
    await page.click('[data-testid="dim-0"]')
    await page.keyboard.press('Shift+.')
    expect(await panelWidth(page), 'a number field lost its keystroke to the panel').toBe(
      DEFAULT_WIDTH
    )

    // And on the body, where nothing else claims the key, both directions work.
    expect(await stepPanelWidth(page, 'wider')).toBe(DEFAULT_WIDTH + 40)
    expect(await stepPanelWidth(page, 'narrower', 2)).toBe(DEFAULT_WIDTH - 40)
  })

  test('the keys stop at both bounds', async () => {
    const { page } = handle
    const max = await maxPanelWidth(page)
    // Well past either bound, so what stops the column is the clamp rather than
    // the count of presses.
    expect(await stepPanelWidth(page, 'narrower', 8)).toBe(MIN_WIDTH)
    expect(await stepPanelWidth(page, 'wider', 20)).toBeCloseTo(max, 1)
  })

  test('double-click on the handle resets to the default', async () => {
    const { page } = handle
    const wide = await stepPanelWidth(page, 'wider', 4)
    expect(wide, 'nothing to reset from').toBeGreaterThan(DEFAULT_WIDTH)

    await page.locator('.panel-resize-handle').dblclick()
    expect(await panelWidth(page)).toBe(DEFAULT_WIDTH)
  })

  test('dragging the handle sets the width, clamped', async () => {
    const { page } = handle
    const max = await maxPanelWidth(page)
    // Comfortably inside the bounds on any window this suite runs on, so the
    // clamp is not what this half is measuring.
    const inside = Math.min(500, max - 40)
    expect(await dragHandleTo(handle, inside)).toBeCloseTo(inside, 1)
    // Dragged past the ceiling, the column stops at it — the pointer and the
    // column disagree on purpose.
    expect(await dragHandleTo(handle, max + 260)).toBeCloseTo(max, 1)
    expect(await panelWidth(page)).toBeCloseTo(max, 1)
  })

  test('a window narrowed below twice the width re-clamps it', async () => {
    const { page, app } = handle
    const wide = await stepPanelWidth(page, 'wider', 20)
    expect(wide).toBeCloseTo(await maxPanelWidth(page), 1)
    const before = await page.evaluate(() => window.innerWidth)

    // The real thing rather than a viewport override: this is the case where a
    // width saved on a wide monitor would otherwise pin the viewport to a
    // sliver. Deleting `installPanelWidthResize` fails exactly this spec.
    //
    // Two thirds of whatever the window currently is, so the new half-window
    // ceiling is below the width the panel is holding on ANY machine — asking
    // for a fixed 900 only narrows a window that started wider than that.
    await app.evaluate(({ BrowserWindow }, width) => {
      BrowserWindow.getAllWindows()[0].setBounds({ width, height: 700 })
    }, Math.round(before * 0.66))
    await page.waitForFunction(
      (held) => {
        const panel = document.querySelector('.panel')
        return panel !== null && panel.getBoundingClientRect().width < held
      },
      wide,
      { timeout: 10_000 }
    )

    // Computed from the window the WM actually granted, which need not be what
    // was asked for.
    const inner = await page.evaluate(() => window.innerWidth)
    expect(inner, 'the window did not narrow, so the re-clamp is untested').toBeLessThan(before)
    expect(await panelWidth(page)).toBeCloseTo(Math.min(640, inner / 2), 1)
  })

  test('the viewport canvas tracks the stage after a drag', async () => {
    const { page } = handle
    // "The viewport needs no change, its ResizeObserver already handles it"
    // (ADR-0026) is a claim, and this is the line that checks it.
    await expect(page.locator('[data-testid="viewport-canvas"]')).toBeVisible()
    await expect(
      page.locator('[data-testid="viewport-fallback"]'),
      'GL failed, so canvas size would prove nothing'
    ).toHaveCount(0)

    const before = await stageAndCanvas(page)

    await dragHandleTo(handle, 560)
    const after = await stageAndCanvas(page)
    // Non-vacuity: a drag that did nothing would leave the canvas correct at
    // the width it already had, and this spec would pass without observing
    // anything. The stage has to have MOVED first.
    expect(after.stage, 'the drag did not resize the stage').toBeLessThan(before.stage - 100)
    // The CSS box follows from flex layout alone — it is the DRAWING BUFFER
    // that the ResizeObserver sets (`renderer.setSize(w, h, false)`), so that
    // is what has to have changed. Assert the box too, since a canvas whose
    // buffer and box disagree renders stretched.
    expect(after.box).toBeCloseTo(after.stage, 0)
    expect(
      after.buffer,
      'the drawing buffer kept its old size — the ResizeObserver did not fire'
    ).toBeLessThan(before.buffer - 100)
    expect(after.buffer).toBeCloseTo(Math.round(after.stage * after.dpr), -0.5)
  })
})

/** What the viewport is actually sized at, measured a frame after layout so the
 *  ResizeObserver (ADR-0008) has run. `box` is the canvas's CSS width, `buffer`
 *  its drawing-buffer width — only the second is the observer's work. */
async function stageAndCanvas(
  page: Page
): Promise<{ stage: number; box: number; buffer: number; dpr: number }> {
  return page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const stage = document.querySelector('.stage')
    const canvas = document.querySelector('[data-testid="viewport-canvas"]')
    if (!stage || !(canvas instanceof HTMLCanvasElement)) throw new Error('stage or canvas missing')
    return {
      stage: stage.getBoundingClientRect().width,
      box: canvas.getBoundingClientRect().width,
      buffer: canvas.width,
      dpr: window.devicePixelRatio
    }
  })
}
