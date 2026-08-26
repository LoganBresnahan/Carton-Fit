import { expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, type AppHandle } from './harness'

/**
 * Light / dark / system, end to end (ADR-0025).
 *
 * The unit layer already pins the pieces: `tests/window-state.test.ts` covers
 * the `theme` field's validation, `tests/viewport-palette.test.ts` the two
 * colour branches. What only a real launch can show is that the ONE MECHANISM
 * holds — `nativeTheme.themeSource` really does move the renderer's
 * `prefers-color-scheme` — and that the three hand-copied colour tables
 * (`styles.css`, main's `WINDOW_BACKGROUND`, `viewportPalette`) are still in
 * step. Every one of those can drift while every unit test stays green, which is
 * why the build plan calls these specs the drift guards rather than coverage.
 *
 * Note `launchApp` clears Playwright's `prefers-color-scheme` emulation: it
 * forces light by default, which outranks `themeSource` and would make every
 * assertion here measure Playwright instead of the app.
 */

function profile(): { args: string[]; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pe-e2e-theme-'))
  return { args: [`--user-data-dir=${dir}`], dir }
}

/**
 * One colour spelling.
 *
 * Three sources answer in three dialects: a CSS custom property comes back as
 * the literal token text (`#f4f6f9`), `getComputedStyle` on a real property as
 * `rgb(244, 246, 249)`, and `getBackgroundColor()` as hex that may carry a
 * leading alpha byte (Chromium's `#AARRGGBB`). Compare meanings, not strings.
 */
function normalizeColor(raw: string): string {
  const value = raw.trim().toLowerCase()
  const rgb = value.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/)
  if (rgb) {
    const channels = [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0'))
    return `#${channels.join('')}`
  }
  const hex = value.replace('#', '')
  if (hex.length === 8) return `#${hex.slice(2)}` // #AARRGGBB — drop the alpha
  if (hex.length === 3) return `#${[...hex].map((c) => c + c).join('')}`
  return `#${hex}`
}

const DARK_BG = '#1b1e24'
const LIGHT_BG = '#f4f6f9'

/** What the stylesheet currently thinks the app's background is. */
const cssBackground = (page: AppHandle['page']): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg'))

/** What `nativeTheme` currently resolves to, asked of MAIN. */
const resolvedDark = (app: AppHandle['app']): Promise<boolean> =>
  app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)

const themeSource = (app: AppHandle['app']): Promise<string> =>
  app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)

/** What the renderer's media query says — the other end of the one mechanism. */
const rendererDark = (page: AppHandle['page']): Promise<boolean> =>
  page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

/**
 * The preference that is NOT what we are already showing.
 *
 * Under `xvfb` there is no desktop setting to follow, so `system` resolves to
 * whatever Chromium defaults to on the runner. Pinning "dark" on a machine that
 * was already dark would let every assertion below pass without the feature
 * existing at all, so the target is chosen against the live resolution.
 */
const opposite = (dark: boolean): 'light' | 'dark' => (dark ? 'light' : 'dark')

async function chooseTheme(handle: AppHandle, preference: string): Promise<void> {
  const select = handle.page.locator('[data-testid="theme-select"]')
  // It renders disabled until `theme:get` answers (ADR-0025 §6), so this wait is
  // the round-trip, not a sleep.
  await expect(select).toBeEnabled()
  await select.selectOption(preference)
}

/** The preference as persisted, or null while the file has yet to be written. */
function savedTheme(dir: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'window-state.json'), 'utf8'))
    return typeof raw.theme === 'string' ? raw.theme : null
  } catch {
    return null
  }
}

test('a fresh profile follows the OS, and both sides agree on what that means', async () => {
  // No `--user-data-dir` of our own: the harness hands every launch a throwaway
  // profile, so "fresh" needs no setup — it is the default state.
  const handle = await launchApp()
  try {
    expect(await themeSource(handle.app), 'a new install must not pin a theme').toBe('system')

    // THE CONTRACT. Main owns `nativeTheme`; the stylesheet and the viewport read
    // `prefers-color-scheme` and nothing else. If Electron ever stopped pointing
    // one at the other, every colour in the app would quietly stop following the
    // setting, and no unit test could see it.
    expect(await rendererDark(handle.page)).toBe(await resolvedDark(handle.app))

    // And the select reports the preference main is actually holding.
    await expect(handle.page.locator('[data-testid="theme-select"]')).toHaveValue('system')
  } finally {
    await handle.app.close()
  }
})

test('a pinned theme survives a restart', async () => {
  const { args, dir } = profile()

  const first = await launchApp(args)
  let pinned: 'light' | 'dark'
  try {
    pinned = opposite(await resolvedDark(first.app))
    await chooseTheme(first, pinned)

    // Applied immediately, without a relaunch — both ends of the mechanism.
    await expect.poll(() => themeSource(first.app)).toBe(pinned)
    await expect.poll(() => rendererDark(first.page)).toBe(pinned === 'dark')

    // Written STRAIGHT AWAY rather than at quit (ADR-0025 §3): a preference lost
    // to a crash is worse than a window that reopens slightly off. Waiting on the
    // file rather than on the close is also what keeps the relaunch below from
    // racing the save.
    await expect.poll(() => savedTheme(dir)).toBe(pinned)
  } finally {
    await first.app.close()
  }

  const second = await launchApp(args)
  try {
    expect(await themeSource(second.app), 'the saved preference was not read back').toBe(pinned)
    expect(await rendererDark(second.page)).toBe(pinned === 'dark')
    // Non-vacuous: the restored theme has to reach the page's colours, not just
    // main's idea of them.
    expect(normalizeColor(await cssBackground(second.page))).toBe(
      pinned === 'dark' ? DARK_BG : LIGHT_BG
    )
  } finally {
    await second.app.close()
  }
})

/**
 * THE FLASH GUARD, and the drift guard on main's hand-copied colour table.
 *
 * `backgroundColor` is fixed when the BrowserWindow is constructed — before any
 * page frame exists — so reading it back after launch is a faithful proxy for
 * what the user saw in that first moment. Equal to the stylesheet's `--bg` means
 * no launch shows a slab of the other theme before the page paints.
 *
 * BOTH themes, deliberately. `WINDOW_BACKGROUND` has two hand-copied entries,
 * and a spec that pins one theme only ever checks one of them — which is what
 * the first draft of this file did, and a mutation run caught: breaking the
 * light hex left everything green on a runner whose OS resolves light. The
 * preference is seeded into the window-state file rather than clicked, because
 * this is about what the window is CONSTRUCTED with.
 */
for (const [pinned, expected] of [
  ['dark', DARK_BG],
  ['light', LIGHT_BG]
] as const) {
  test(`the window frame is painted ${pinned} before the page paints`, async () => {
    const { args, dir } = profile()
    writeFileSync(
      join(dir, 'window-state.json'),
      JSON.stringify({ width: 1000, height: 700, maximized: false, theme: pinned })
    )

    const handle = await launchApp(args)
    try {
      const frame = await handle.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getBackgroundColor()
      )
      const page = await cssBackground(handle.page)
      expect(normalizeColor(page), 'the seeded preference was not applied').toBe(expected)
      expect(normalizeColor(frame), 'the window frame flashes the other theme').toBe(
        normalizeColor(page)
      )
    } finally {
      await handle.app.close()
    }
  })
}

test('the 3D viewport re-tints with the rest of the app', async () => {
  const handle = await launchApp()
  try {
    // three.js stays private to the viewport island (ADR-0008) and the drawing
    // buffer is not preserved, so sampling the canvas is not on offer. The island
    // publishes its clear colour to `data-clear-color` for exactly this spec, and
    // comparing that against `--bg` is what catches a drift between
    // `viewportPalette` and the stylesheet.
    const viewport = handle.page.locator('[data-testid="viewport"]')
    await expect(viewport, 'no GL context, so this spec would be vacuous').toBeVisible()
    await expect(handle.page.locator('[data-testid="viewport-fallback"]')).toHaveCount(0)

    const clearColor = async (): Promise<string> =>
      normalizeColor((await viewport.getAttribute('data-clear-color')) ?? '')

    expect(await clearColor()).toBe(normalizeColor(await cssBackground(handle.page)))
    const before = await clearColor()

    const pinned = opposite(await resolvedDark(handle.app))
    await chooseTheme(handle, pinned)

    // Await the re-tint rather than asserting into the round-trip: the media
    // query flips only once main has moved `themeSource`, and the island reacts
    // to that flip, not to the click.
    await handle.page.waitForFunction(
      (wantDark) => window.matchMedia('(prefers-color-scheme: dark)').matches === wantDark,
      pinned === 'dark'
    )
    await expect.poll(clearColor).not.toBe(before)

    expect(await clearColor(), 'the viewport and the stylesheet disagree').toBe(
      normalizeColor(await cssBackground(handle.page))
    )
  } finally {
    await handle.app.close()
  }
})
