import { useAppStore, type PackingSettings } from '../store'
import { prunedUnitPart, type PartWeightOverrides } from '../packing/kinds'

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

/**
 * One undoable state: the settings plus the per-kind weight overrides
 * (ADR-0018 §4).
 *
 * Overrides are undoable for the same reason settings are — typing weights
 * into a list of kinds is precisely the fiddling Ctrl+Z exists for — but they
 * live in their own store slice, so the snapshot has to carry both. Grouping
 * them here rather than adding a second stack keeps one timeline: an undo
 * walks back whatever the last edit touched, without the user having to know
 * which kind of input it was.
 */
interface Snapshot {
  settings: PackingSettings
  overrides: PartWeightOverrides
  /**
   * Which part max-quantity replicates, or null for the whole file.
   *
   * Joined the snapshot on 2026-09-04, and the gap it closes was pre-existing
   * rather than new: the picker was never on the stack, so an undo walked the
   * settings and the overrides back and left the unit part where it was. That
   * cost nothing while a restore did not carry one either — and then the
   * ADR-0016 addendum made restores carry it, which turned a quiet omission
   * into one step that half-reverts. Undoing a restore now puts back the
   * question, not just the inputs to it.
   */
  unitPart: string | null
}

interface Entry {
  state: Snapshot
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
export function changeSignature(prev: Snapshot, next: Snapshot): string {
  const changed: string[] = []
  for (const key of Object.keys(next.settings) as (keyof PackingSettings)[]) {
    const before = prev.settings[key]
    const after = next.settings[key]
    if (Array.isArray(before) && Array.isArray(after)) {
      const indices = after
        .map((value, i) => (value === before[i] ? null : i))
        .filter((i): i is number => i !== null)
      if (indices.length > 0) changed.push(`${key}[${indices.join(',')}]`)
    } else if (before !== after) {
      changed.push(String(key))
    }
  }

  // Per-kind overrides are named INDIVIDUALLY, for the same reason the carton
  // dimensions are named per index: they share one container, so a
  // container-level signature would collapse "set the bolt, then set the nut"
  // into a single undo step while still splitting a typed number into three.
  for (const kind of new Set([...Object.keys(prev.overrides), ...Object.keys(next.overrides)])) {
    if (prev.overrides[kind] !== next.overrides[kind]) changed.push(`weight:${kind}`)
  }

  // Its own name, so choosing a unit part and then editing the carton are two
  // steps — and so that two picks inside the coalescing window collapse the
  // way two edits to one number field do, which is the behaviour every other
  // single-valued input here already has.
  if (prev.unitPart !== next.unitPart) changed.push('unitPart')

  return changed.sort().join('|')
}

function record(state: Snapshot, signature: string, now: number): void {
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
    stack[cursor] = { state, signature, at: now }
    return
  }

  // A fresh edit invalidates anything that was ahead of us: you cannot redo
  // into a future you just diverged from.
  stack = stack.slice(0, cursor + 1)
  stack.push({ state, signature, at: now })
  if (stack.length > MAX_DEPTH) stack.shift()
  cursor = stack.length - 1
}

function apply(entry: Entry): void {
  applying = true
  try {
    // Through the normal setters, so persistence and auto-run behave exactly as
    // they do for a user edit. A snapshot carries every key, so merging equals
    // replacing.
    //
    // ONE write covering both slices — the same action a restore uses. The
    // `applying` guard would stop a second write being recorded anyway, but a
    // single write also means a single re-pack rather than two.
    // PRUNED against the parts loaded RIGHT NOW, not against the ones that
    // were open when the entry was recorded: the stack survives an import, so
    // stepping back across one can carry a name the current file does not
    // have, and `partsForRequest` would silently pack everything while the
    // store claimed a unit part. Same rule the restore path uses.
    const state = useAppStore.getState()
    state.restoreInputs(
      entry.state.settings,
      entry.state.overrides,
      prunedUnitPart(entry.state.unitPart, state.parts)
    )
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
 *
 * NUMBER INPUTS ARE THE EXCEPTION, found by dogfooding: spinner clicks and
 * arrow-key steps are not text edits, so they never enter the browser's undo
 * buffer — deferring left Ctrl+Z dead whenever focus sat in the field it had
 * just changed. And nothing is lost by taking over: every keystroke in a
 * number field commits to the store and coalesces (typing "125" is one step),
 * so app undo subsumes the native buffer there. The deference stays only where
 * it pays — real text fields like the preset name, whose text the store does
 * not track.
 */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLInputElement) return target.type !== 'number'
  const tag = target.tagName
  return tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
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

  const snapshot = (state: ReturnType<typeof useAppStore.getState>): Snapshot => ({
    settings: state.settings,
    overrides: state.partWeightsG,
    unitPart: state.unitPartName
  })

  stack = [{ state: snapshot(useAppStore.getState()), signature: '', at: now() }]
  cursor = 0

  const unsubscribe = useAppStore.subscribe((state, prev) => {
    if (
      state.settings === prev.settings &&
      state.partWeightsG === prev.partWeightsG &&
      state.unitPartName === prev.unitPartName
    ) {
      return
    }
    if (applying) return // our own undo/redo write
    const next = snapshot(state)
    record(next, changeSignature(snapshot(prev), next), now())
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
