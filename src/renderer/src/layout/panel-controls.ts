import { useAppStore } from '../store'
import { clampPanelWidth, DEFAULT_PANEL_WIDTH, PANEL_WIDTH_STEP } from './panel-width'

// The two window-level controls over the panel width (ADR-0026 §2, §4): the
// `<` / `>` keyboard steps, and the re-clamp that runs when the window resizes.
//
// Split the way `history/undo.ts` is split — the decisions are pure functions
// taking event-shaped objects, and only the thin `install*` wrappers touch the
// DOM — so the routing rule, which is where the subtlety lives, unit-tests in
// plain Node.
//
// The drag handle is NOT here: it is a component, because it needs the panel
// element's own left edge to turn a pointer position into a width.

/**
 * True when a keystroke should be left to the element that has focus.
 *
 * DELIBERATELY NOT `undo.ts`'s predicate, which is a near-twin with one
 * decisive difference: that one *excludes* `type=number` inputs, because
 * Ctrl+Z inside a number field would otherwise be dead (ADR-0016 §2). This
 * binding needs the opposite — ADR-0026 §2 extends the rule one notch to
 * every editable element, number inputs and selects included. `>` is not a
 * digit, so nothing is typed into a number field that this would swallow, but
 * a shortcut that fires from inside one field and not another is a rule
 * nobody can learn. Reusing undo's predicate here would silently import its
 * exception; the duplication is the point.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  // Duck-typed rather than `instanceof HTMLElement`, which is how undo.ts asks
  // the same question: this file is meant to unit-test in plain node, where
  // those constructors do not exist, and an event target's own `tagName` is
  // exactly as reliable a witness inside the renderer.
  const element = target as { tagName?: unknown; isContentEditable?: unknown } | null
  if (element === null || typeof element.tagName !== 'string') return false
  if (element.isContentEditable === true) return true
  const tag = element.tagName.toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** Which way a keystroke moves the panel edge, or null if it is not ours.
 *
 *  Matched by `event.key` first — `<` and `>` are what the user presses — with
 *  a Shift+`,` / Shift+`.` fallback, because on layouts where those glyphs sit
 *  elsewhere `key` reports something else entirely. Playwright presses take
 *  the same two forms, so the fallback is exercised rather than decorative. */
export function panelWidthKeyDirection(event: Pick<KeyboardEvent, 'key' | 'shiftKey'>): -1 | 1 | null {
  if (event.key === '<') return -1
  if (event.key === '>') return 1
  if (!event.shiftKey) return null
  if (event.key === ',') return -1
  if (event.key === '.') return 1
  return null
}

/**
 * Handle one keydown. Returns true when the width actually moved.
 *
 * Swallows the keystroke whenever it was ours, including at the bounds: at the
 * minimum, `<` should do nothing rather than fall through to whatever else
 * might be listening for it.
 */
export function handlePanelWidthKey(event: KeyboardEvent, windowWidth: number): boolean {
  // Modifier-carrying chords belong to other bindings (and Ctrl+Shift+. is a
  // devtools/browser shortcut on several platforms).
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  const direction = panelWidthKeyDirection(event)
  if (direction === null) return false
  if (isEditableTarget(event.target)) return false

  event.preventDefault()
  const { panelWidth, setPanelWidth } = useAppStore.getState()
  const next = clampPanelWidth(panelWidth + direction * PANEL_WIDTH_STEP, windowWidth)
  if (next === panelWidth) return false
  setPanelWidth(next)
  return true
}

/** Bind `<` / `>`. Separate from the handler so that half needs no DOM. */
export function installPanelWidthKeyboard(
  target: Pick<Window, 'addEventListener' | 'removeEventListener' | 'innerWidth'>
): () => void {
  const onKeyDown = (event: Event): void => {
    handlePanelWidthKey(event as KeyboardEvent, target.innerWidth)
  }
  target.addEventListener('keydown', onKeyDown)
  return () => target.removeEventListener('keydown', onKeyDown)
}

/**
 * Re-clamp the stored width against the window on every resize.
 *
 * Without this, a width saved on a wide monitor pins the viewport to a sliver
 * when the same window opens narrow — the clamp at load (`store.ts`) only sees
 * the width the window had at startup.
 *
 * Writes ONLY on change: a drag of the window edge fires this continuously,
 * and an unconditional write would churn localStorage once per event for a
 * value that did not move.
 */
export function installPanelWidthResize(
  target: Pick<Window, 'addEventListener' | 'removeEventListener' | 'innerWidth'>
): () => void {
  const onResize = (): void => {
    const { panelWidth, setPanelWidth } = useAppStore.getState()
    const next = clampPanelWidth(panelWidth, target.innerWidth)
    if (next !== panelWidth) setPanelWidth(next)
  }
  target.addEventListener('resize', onResize)
  return () => target.removeEventListener('resize', onResize)
}

/** The width a double-click on the handle (or a reset) returns to, clamped —
 *  the default is not reachable on a window too narrow to afford it. */
export function defaultPanelWidth(windowWidth: number): number {
  return clampPanelWidth(DEFAULT_PANEL_WIDTH, windowWidth)
}
