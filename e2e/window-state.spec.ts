import { expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './harness'

/**
 * Window geometry across restarts (ADR-0014).
 *
 * `tests/window-state.test.ts` pins the placement RULES against plain data.
 * What only a real launch can show is the wiring: that the state is read before
 * the BrowserWindow is constructed, that the close handler actually fires, and
 * that the file lands in userData. Each of those can break while every unit
 * test stays green.
 */
function profile(): { args: string[]; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pe-e2e-window-'))
  return { args: [`--user-data-dir=${dir}`], dir }
}

const bounds = (app: Awaited<ReturnType<typeof launchApp>>['app']) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds())

test('restores the window across restarts WITHOUT drifting', async () => {
  const { args, dir } = profile()

  const first = await launchApp(args)
  let moved: { x: number; y: number; width: number; height: number }
  try {
    await first.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setBounds({ x: 160, y: 120, width: 1024, height: 720 })
    })
    // Read back what the window manager actually granted rather than what was
    // asked for: under xvfb it need not be identical.
    moved = await bounds(first.app)
    expect(moved.width, 'the resize did not take, so the test would be vacuous').not.toBe(1280)
  } finally {
    await first.app.close()
  }

  expect(existsSync(join(dir, 'window-state.json'))).toBe(true)

  const second = await launchApp(args)
  let restored: { x: number; y: number; width: number; height: number }
  try {
    restored = await bounds(second.app)
    expect(restored.width).toBe(moved.width)
    expect(restored.height).toBe(moved.height)
    // Close to where it was. One window-frame's worth of slack, because a
    // window manager that reports frame-inclusive bounds but accepts
    // frame-exclusive ones shifts the first restore by exactly that much.
    expect(Math.abs(restored.x - moved.x)).toBeLessThanOrEqual(60)
    expect(Math.abs(restored.y - moved.y)).toBeLessThanOrEqual(60)
  } finally {
    await second.app.close()
  }

  // THE REGRESSION GUARD. The bug this catches is not "does it restore" — that
  // passed all along — but that each restore fed the frame offset back in and
  // added it again, so the window crept 6 px right and 27 px DOWN every single
  // launch and walked off the screen in about twenty. A third launch must land
  // exactly where the second did.
  const third = await launchApp(args)
  try {
    const again = await bounds(third.app)
    expect(again.x, 'the window drifted between launches').toBe(restored.x)
    expect(again.y, 'the window drifted between launches').toBe(restored.y)
    expect(again.width).toBe(restored.width)
    expect(again.height).toBe(restored.height)
  } finally {
    await third.app.close()
  }
})

test('still opens when the geometry file is corrupt', async () => {
  // The file is plain JSON in userData, so a user can edit it, and a crash can
  // truncate it. Neither may stop the app from starting.
  const { args, dir } = profile()
  writeFileSync(join(dir, 'window-state.json'), '{"width": "not a number"')

  const { app, page } = await launchApp(args)
  try {
    await expect(page.locator('[data-testid="dropzone"]')).toBeVisible()
    const shown = await bounds(app)
    expect(shown.width).toBeGreaterThanOrEqual(800)
  } finally {
    await app.close()
  }
})

test('ignores a position on a monitor that is no longer attached', async () => {
  // Saved far beyond any plausible desktop. Restoring it verbatim would put the
  // window somewhere unreachable, which reads to the user as a failed launch.
  const { args, dir } = profile()
  writeFileSync(
    join(dir, 'window-state.json'),
    JSON.stringify({ width: 1000, height: 700, x: 40000, y: 30000, maximized: false })
  )

  const { app } = await launchApp(args)
  try {
    const shown = await bounds(app)
    expect(shown.x).toBeLessThan(40000)
    expect(shown.width).toBe(1000) // the remembered SIZE is still honoured
  } finally {
    await app.close()
  }
})
