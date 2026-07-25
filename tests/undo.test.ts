import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '../src/renderer/src/store'
import {
  canRedo,
  canUndo,
  changeSignature,
  redo,
  resetUndoHistory,
  startUndoHistory,
  undo
} from '../src/renderer/src/history/undo'
import { restoreEstimateSettings } from '../src/renderer/src/storage/estimates'
import type { EstimateRow } from '../src/shared/storage'

// Input undo/redo (ADR-0016 §2). The design is simple; the failure modes are
// not, and they are what these tests are for:
//   - the stack recording its OWN undo writes, so undo walks nowhere;
//   - a burst of keystrokes in one field costing a Ctrl+Z each (the number
//     fields commit on EVERY keystroke, so "125" is three store writes);
//   - a preset or history restore costing one Ctrl+Z per field it touched.

/** Controllable clock, so coalescing is tested rather than raced. */
let now = 1_000_000
const clock = (): number => now
const advance = (ms: number): void => {
  now += ms
}

const settings = () => useAppStore.getState().settings
const setDim = (index: number, mm: number): void => {
  const dims = [...settings().boxDimsMm] as [number, number, number]
  dims[index] = mm
  useAppStore.getState().updateSettings({ boxDimsMm: dims })
}

beforeEach(() => {
  resetUndoHistory()
  useAppStore.getState().updateSettings({
    boxDimsMm: [100, 100, 100],
    maxWeightG: 1000,
    clearancePartMm: 0
  })
  now = 1_000_000
  startUndoHistory(clock)
})

afterEach(() => {
  resetUndoHistory()
})

describe('undo/redo', () => {
  it('walks back one edit and forward again', () => {
    useAppStore.getState().updateSettings({ maxWeightG: 2000 })
    advance(1000)
    useAppStore.getState().updateSettings({ maxWeightG: 3000 })

    expect(undo()).toBe(true)
    expect(settings().maxWeightG).toBe(2000)
    expect(undo()).toBe(true)
    expect(settings().maxWeightG).toBe(1000)

    expect(redo()).toBe(true)
    expect(settings().maxWeightG).toBe(2000)
  })

  it('does NOT record its own undo writes', () => {
    // The bug this prevents: undo writes settings, the subscription sees a
    // change and pushes it, and the stack grows forwards while you try to walk
    // backwards — undo appears to do nothing after the first press.
    useAppStore.getState().updateSettings({ maxWeightG: 2000 })
    advance(1000)
    useAppStore.getState().updateSettings({ maxWeightG: 3000 })

    undo()
    undo()
    expect(settings().maxWeightG).toBe(1000)
    expect(canUndo()).toBe(false)
  })

  it('stops at the beginning and the end instead of throwing', () => {
    expect(undo()).toBe(false) // nothing recorded yet
    expect(redo()).toBe(false)
    useAppStore.getState().updateSettings({ maxWeightG: 2000 })
    expect(redo()).toBe(false) // already at the newest state
    expect(undo()).toBe(true)
    expect(undo()).toBe(false)
  })

  it('reports what it can do, for a UI that wants to say so', () => {
    expect(canUndo()).toBe(false)
    expect(canRedo()).toBe(false)
    useAppStore.getState().updateSettings({ maxWeightG: 2000 })
    expect(canUndo()).toBe(true)
    expect(canRedo()).toBe(false)
    undo()
    expect(canRedo()).toBe(true)
  })
})

describe('coalescing', () => {
  it('collapses a burst of typing in one field into ONE step', () => {
    // The number fields commit on every keystroke, so typing "125" is three
    // writes. It must cost one Ctrl+Z, not three.
    setDim(0, 1)
    advance(80)
    setDim(0, 12)
    advance(80)
    setDim(0, 125)

    expect(undo()).toBe(true)
    expect(settings().boxDimsMm[0]).toBe(100) // straight back to before the burst
    expect(canUndo()).toBe(false)
  })

  it('keeps a pause between edits as a separate step', () => {
    setDim(0, 200)
    advance(5000) // the user stopped, thought, and came back
    setDim(0, 300)

    expect(undo()).toBe(true)
    expect(settings().boxDimsMm[0]).toBe(200)
  })

  it('treats a DIFFERENT carton dimension as a separate step', () => {
    // All three dimensions live in one `boxDimsMm` array, so a key-level
    // signature would collapse "length then width" into one undo. They are two
    // deliberate edits.
    setDim(0, 200)
    advance(50)
    setDim(1, 300)

    expect(undo()).toBe(true)
    expect(settings().boxDimsMm[1]).toBe(100)
    expect(settings().boxDimsMm[0]).toBe(200) // the length edit survives
  })

  it('treats a different field as a separate step even when typed fast', () => {
    useAppStore.getState().updateSettings({ maxWeightG: 2000 })
    advance(50)
    useAppStore.getState().updateSettings({ clearancePartMm: 5 })

    expect(undo()).toBe(true)
    expect(settings().clearancePartMm).toBe(0)
    expect(settings().maxWeightG).toBe(2000)
  })
})

describe('redo tail', () => {
  it('is discarded by a fresh edit — you cannot redo into a future you left', () => {
    useAppStore.getState().updateSettings({ maxWeightG: 2000 })
    advance(1000)
    useAppStore.getState().updateSettings({ maxWeightG: 3000 })
    undo() // back to 2000, with 3000 ahead of us

    advance(1000)
    useAppStore.getState().updateSettings({ maxWeightG: 4242 })
    expect(canRedo()).toBe(false)
    expect(redo()).toBe(false)
    expect(settings().maxWeightG).toBe(4242)
  })

  it('does not coalesce into the middle of a redo tail', () => {
    // Reachable only via an intervening edit to a DIFFERENT field: undo back
    // onto a recent same-field entry that still has a future attached. Without
    // the cursor guard the new value would overwrite that entry in place while
    // the tail survived — leaving a redo that restores a state which never
    // existed.
    useAppStore.getState().updateSettings({ maxWeightG: 2000 })
    advance(50)
    useAppStore.getState().updateSettings({ clearancePartMm: 5 })
    undo() // back onto the maxWeightG entry, with the clearance edit ahead
    advance(50)
    useAppStore.getState().updateSettings({ maxWeightG: 5000 })

    expect(canRedo()).toBe(false) // the tail is gone, not silently kept
    expect(undo()).toBe(true)
    expect(settings().maxWeightG).toBe(2000)
    expect(settings().clearancePartMm).toBe(0)
  })
})

describe('bulk restores are one step', () => {
  it('undoes a whole preset load in one press', () => {
    // A preset touches many fields at once. ADR-0016: one undo step.
    useAppStore.getState().updateSettings({
      boxDimsMm: [500, 400, 300],
      maxWeightG: 9999,
      clearancePartMm: 7
    })

    expect(undo()).toBe(true)
    expect(settings().boxDimsMm).toEqual([100, 100, 100])
    expect(settings().maxWeightG).toBe(1000)
    expect(settings().clearancePartMm).toBe(0)
  })

  it('undoes a restored saved estimate in one press', () => {
    const row: EstimateRow = {
      id: 1,
      fileName: 'a.stp',
      contentHash: 'h',
      settings: { boxDimsMm: [500, 400, 300], maxWeightG: 9999 },
      result: {},
      createdAt: 1
    }
    restoreEstimateSettings(row)
    expect(settings().maxWeightG).toBe(9999)

    expect(undo()).toBe(true)
    expect(settings().maxWeightG).toBe(1000)
    expect(settings().boxDimsMm).toEqual([100, 100, 100])
  })
})

describe('changeSignature', () => {
  it('names the array INDEX that changed, not just the field', () => {
    const a = { ...settings(), boxDimsMm: [1, 2, 3] as [number, number, number] }
    const b = { ...settings(), boxDimsMm: [1, 9, 3] as [number, number, number] }
    expect(changeSignature(a, b)).toBe('boxDimsMm[1]')
  })

  it('is empty when nothing changed, which never coalesces', () => {
    expect(changeSignature(settings(), { ...settings() })).toBe('')
  })

  it('is order-independent across several fields', () => {
    const a = settings()
    const b = { ...a, maxWeightG: 5, clearancePartMm: 9 }
    expect(changeSignature(a, b)).toBe('clearancePartMm|maxWeightG')
  })
})
