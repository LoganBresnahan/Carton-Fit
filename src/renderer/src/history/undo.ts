import { useAppStore, type PackingSettings } from '../store'

// Undo/redo over the packing inputs (ADR-0016 §2).
//
// IN MEMORY, SESSION SCOPED, AND NOWHERE NEAR THE DATABASE. Saved estimates are
// receipts the user asked to keep; this is regret about the inputs, which is a
// different thing with a different lifetime. Under ADR-0009's auto-run there is
// no result to restore either — undoing an input re-runs the pack, so undoing an
// input IS undoing the estimate.
//
// The stack holds whole settings snapshots rather than diffs. Settings are a
// small flat object rewritten wholesale on every change (ADR-0006), so a
// snapshot is cheap, and a diff-based stack would have to be kept consistent
// with a shape that is still growing.

/** Deep enough to cover a working session's worth of fiddling, bounded so a
 *  long session cannot grow it without limit. */
const MAX_DEPTH = 100

/** Edits to the same field within this window collapse into one step. */
const COALESCE_MS = 600

interface Entry {
  settings: PackingSettings
  /** What changed to produce this entry — the coalescing key. */
  signature: string
  at: number
}

let stack: Entry[] = []
/** Index of the entry describing the CURRENT settings. */
let cursor = -1
/** True while this module is the one writing settings, so its own writes are
 *  not mistaken for user edits and pushed back onto the stack. */
let applying = false
let started = false
let detach: (() => void) | null = null

/**
 * What changed between two settings objects.
 *
 * Array-aware on purpose: the three carton dimensions live in one `boxDimsMm`
 * array, so a key-level signature would treat "length then width" as the same
 * field and collapse two deliberate edits into one undo step. Comparing indices
 * keeps them distinct while still coalescing repeated typing in ONE dimension —
 * which matters, because the number fields commit on every keystroke, so typing
 * "125" is three store writes.
 */
export function changeSignature(prev: PackingSettings, next: PackingSettings): string {
  const changed: string[] = []
  for (const key of Object.keys(next) as (keyof PackingSettings)[]) {
    const before = prev[key]
    const after = next[key]
    if (Array.isArray(before) && Array.isArray(after)) {
      const indices = after
        .map((value, i) => (value === before[i] ? null : i))
        .filter((i): i is number => i !== null)
      if (indices.length > 0) changed.push(`${key}[${indices.join(',')}]`)
    } else if (before !== after) {
      changed.push(String(key))
    }
  }
  return changed.sort().join('|')
}

function record(settings: PackingSettings, signature: string, now: number): void {
  const top = stack[cursor]
  const coalesces =
    top !== undefined &&
    cursor === stack.length - 1 && // never coalesce into the middle of a redo tail
    top.signature === signature &&
    signature !== '' &&
    now - top.at <= COALESCE_MS

  if (coalesces) {
    // Same field, still typing: move the current entry rather than adding one,
    // so the step behind the burst is the state before it started.
    stack[cursor] = { settings, signature, at: now }
    return
  }

  // A fresh edit invalidates anything that was ahead of us: you cannot redo
  // into a future you just diverged from.
  stack = stack.slice(0, cursor + 1)
  stack.push({ settings, signature, at: now })
  if (stack.length > MAX_DEPTH) stack.shift()
  cursor = stack.length - 1
}

function apply(entry: Entry): void {
  applying = true
  try {
    // Through the normal setter, so persistence and auto-run behave exactly as
    // they do for a user edit. A snapshot carries every key, so merging equals
    // replacing.
    useAppStore.getState().updateSettings(entry.settings)
  } finally {
    // The store notifies subscribers synchronously inside `set`, so by here our
    // own write has already been seen and skipped.
    applying = false
  }
}

/** Step back one edit. Returns false when there is nothing to go back to. */
export function undo(): boolean {
  if (cursor <= 0) return false
  cursor -= 1
  apply(stack[cursor])
  return true
}

/** Step forward again. Returns false at the newest state. */
export function redo(): boolean {
  if (cursor < 0 || cursor >= stack.length - 1) return false
  cursor += 1
  apply(stack[cursor])
  return true
}

export function canUndo(): boolean {
  return cursor > 0
}

export function canRedo(): boolean {
  return cursor >= 0 && cursor < stack.length - 1
}

/**
 * True when a keystroke should be left to the browser.
 *
 * Ctrl+Z inside a text field means "undo my typing" to every user on every
 * platform, and hijacking it to rewind the carton would be worse than not
 * having undo at all. Native undo there re-fires `onChange`, which lands back
 * here as an ordinary edit — so the two mechanisms compose instead of fighting.
 */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/** Ctrl/Cmd+Z, and both spellings of redo (Ctrl+Shift+Z, and Ctrl+Y on Windows). */
export function handleUndoKey(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false
  if (isEditable(event.target)) return false

  const key = event.key.toLowerCase()
  if (key === 'z') {
    const acted = event.shiftKey ? redo() : undo()
    // Swallow it either way: at the ends of the stack the app should do
    // nothing, not fall through to some other handler.
    event.preventDefault()
    return acted
  }
  if (key === 'y') {
    const acted = redo()
    event.preventDefault()
    return acted
  }
  return false
}

/**
 * Begin tracking input history.
 *
 * Installed from the renderer entry rather than a component, like the other
 * subscriptions (ADR-0006), and idempotent because StrictMode double-invokes.
 *
 * Deliberately free of any DOM reference — the keyboard half is
 * {@link installUndoKeyboard} — so the stack behaviour, which is where all the
 * subtlety lives, is unit-testable in plain Node like the rest of the logic.
 */
export function startUndoHistory(now: () => number = Date.now): () => void {
  if (started) return () => {}
  started = true

  stack = [
    { settings: useAppStore.getState().settings, signature: '', at: now() }
  ]
  cursor = 0

  const unsubscribe = useAppStore.subscribe((state, prev) => {
    if (state.settings === prev.settings) return
    if (applying) return // our own undo/redo write
    record(state.settings, changeSignature(prev.settings, state.settings), now())
  })

  detach = () => {
    unsubscribe()
    started = false
    stack = []
    cursor = -1
    applying = false
    detach = null
  }
  return detach
}

/** Bind Ctrl+Z / Ctrl+Shift+Z. Separate from the tracking so that half needs no DOM. */
export function installUndoKeyboard(target: Pick<Window, 'addEventListener' | 'removeEventListener'>): () => void {
  const onKeyDown = (event: Event): void => {
    handleUndoKey(event as KeyboardEvent)
  }
  target.addEventListener('keydown', onKeyDown)
  return () => target.removeEventListener('keydown', onKeyDown)
}

/** Test seam: forget everything without needing a live subscription. */
export function resetUndoHistory(): void {
  detach?.()
}
