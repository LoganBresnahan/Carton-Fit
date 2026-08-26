// The control panel's width rule (ADR-0026 Decision 4). One pure function, so
// the drag handle, the keyboard steps, the double-click reset and the window
// resize handler all clamp identically — four callers, one rule.

/** The width the panel has always had; `<` / `>` and a handle double-click
 *  return to it, and it is what a missing or corrupt persisted value means. */
export const DEFAULT_PANEL_WIDTH = 360

/** Narrower than this and the inputs start overhanging (the item-11 bug). */
export const MIN_PANEL_WIDTH = 280

/** Absolute ceiling; the window supplies a second, tighter one below. */
export const MAX_PANEL_WIDTH = 640

/** One press of `<` or `>` (ADR-0026 Decision 2). */
export const PANEL_WIDTH_STEP = 40

/** Clamp a requested panel width against the bounds and the window.
 *
 *  The upper bound is `min(640, half the window)` so a width saved on a wide
 *  monitor cannot pin the viewport to a sliver on a narrow one. On a window
 *  too narrow for even the minimum — under 560px, where half is below 280 —
 *  the *window* wins: the panel goes under its minimum rather than taking
 *  more than half the screen, because a viewport with no room left is the
 *  worse failure and the min is a comfort bound, not a correctness one.
 *
 *  A non-finite request (NaN from a corrupt persisted value, or a parse that
 *  produced nothing) is the default width, not zero. */
export function clampPanelWidth(requested: number, windowWidth: number): number {
  const wanted = Number.isFinite(requested) ? requested : DEFAULT_PANEL_WIDTH
  const half = Number.isFinite(windowWidth) ? windowWidth / 2 : MAX_PANEL_WIDTH
  const max = Math.min(MAX_PANEL_WIDTH, half)
  if (wanted > max) return max
  // Below the minimum only when the window itself cannot afford the minimum.
  return Math.max(Math.min(MIN_PANEL_WIDTH, max), wanted)
}
