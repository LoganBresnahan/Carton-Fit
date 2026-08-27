import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../src/renderer/src/store'
import {
  defaultPanelWidth,
  handlePanelWidthKey,
  installPanelWidthKeyboard,
  installPanelWidthResize,
  isEditableTarget,
  panelWidthKeyDirection
} from '../src/renderer/src/layout/panel-controls'
import {
  DEFAULT_PANEL_WIDTH,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  PANEL_WIDTH_STEP
} from '../src/renderer/src/layout/panel-width'

// The two window-level width controls (ADR-0026 §2, §4). Everything here runs
// in plain node with event- and window-shaped objects, which is the reason the
// routing predicate is duck-typed rather than `instanceof HTMLElement`.
//
// What these are actually for:
//   - the ONE difference from undo's near-identical predicate: this binding
//     must defer inside a NUMBER input too, where undo deliberately does not;
//   - `<`/`>` reported as themselves on one layout and as Shift+`,`/`.` on
//     another, so both spellings have to work;
//   - the resize re-clamp writing only when the width actually moves, since
//     every write is a localStorage write.

const WIDE = 2560

/** An event target shaped like the element the predicate inspects. Cast rather
 *  than constructed: node has no DOM, which is exactly why the predicate reads
 *  `tagName` instead of asking `instanceof`. */
const target = (props: Record<string, unknown>): EventTarget => props as unknown as EventTarget

/** A keydown-shaped object. `target: null` is "nothing focused". */
function keyEvent(key: string, extra: Partial<KeyboardEvent> = {}) {
  return {
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: null,
    preventDefault: vi.fn(),
    ...extra
  } as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> }
}

/** A window-shaped listener target whose width can be moved mid-test. */
function fakeWindow(innerWidth = WIDE) {
  const listeners = new Map<string, EventListener[]>()
  return {
    innerWidth,
    addEventListener: (type: string, fn: EventListener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn])
    },
    removeEventListener: (type: string, fn: EventListener) => {
      listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn))
    },
    count: (type: string) => (listeners.get(type) ?? []).length,
    fire: (type: string, event: unknown) => {
      for (const fn of listeners.get(type) ?? []) fn(event as Event)
    }
  }
}

const width = (): number => useAppStore.getState().panelWidth

beforeEach(() => {
  useAppStore.getState().setPanelWidth(DEFAULT_PANEL_WIDTH)
})

afterEach(() => {
  useAppStore.getState().setPanelWidth(DEFAULT_PANEL_WIDTH)
})

describe('panelWidthKeyDirection', () => {
  it('reads the glyphs themselves', () => {
    expect(panelWidthKeyDirection({ key: '<', shiftKey: true })).toBe(-1)
    expect(panelWidthKeyDirection({ key: '>', shiftKey: true })).toBe(1)
  })

  it('falls back to Shift plus the unshifted key, for layouts that report that', () => {
    expect(panelWidthKeyDirection({ key: ',', shiftKey: true })).toBe(-1)
    expect(panelWidthKeyDirection({ key: '.', shiftKey: true })).toBe(1)
  })

  it('leaves an unshifted comma or period alone', () => {
    // A decimal point is typed constantly in this app's number fields.
    expect(panelWidthKeyDirection({ key: '.', shiftKey: false })).toBeNull()
    expect(panelWidthKeyDirection({ key: ',', shiftKey: false })).toBeNull()
  })

  it('ignores everything else', () => {
    expect(panelWidthKeyDirection({ key: 'a', shiftKey: true })).toBeNull()
    expect(panelWidthKeyDirection({ key: 'ArrowLeft', shiftKey: false })).toBeNull()
  })
})

describe('isEditableTarget', () => {
  it('defers inside a NUMBER input — the one place undo deliberately does not', () => {
    // ADR-0026 §2 extends ADR-0016 §2's rule one notch. `>` is not a digit, so
    // nothing is swallowed that the field wanted; the point is a rule that is
    // the same in every field, because the other kind is unlearnable.
    expect(isEditableTarget(target({ tagName: 'INPUT', type: 'number' }))).toBe(true)
    expect(isEditableTarget(target({ tagName: 'INPUT', type: 'text' }))).toBe(true)
  })

  it('defers inside textareas, selects and contentEditable regions', () => {
    expect(isEditableTarget(target({ tagName: 'TEXTAREA' }))).toBe(true)
    expect(isEditableTarget(target({ tagName: 'SELECT' }))).toBe(true)
    expect(isEditableTarget(target({ tagName: 'DIV', isContentEditable: true }))).toBe(true)
  })

  it('does not defer to ordinary elements or to nothing at all', () => {
    expect(isEditableTarget(target({ tagName: 'DIV' }))).toBe(false)
    expect(isEditableTarget(target({ tagName: 'BUTTON' }))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})

describe('handlePanelWidthKey', () => {
  it('steps the width one notch each way', () => {
    expect(handlePanelWidthKey(keyEvent('>'), WIDE)).toBe(true)
    expect(width()).toBe(DEFAULT_PANEL_WIDTH + PANEL_WIDTH_STEP)

    expect(handlePanelWidthKey(keyEvent('<'), WIDE)).toBe(true)
    expect(width()).toBe(DEFAULT_PANEL_WIDTH)
  })

  it('swallows the keystroke at the bounds rather than letting it fall through', () => {
    useAppStore.getState().setPanelWidth(MIN_PANEL_WIDTH)
    const event = keyEvent('<')
    // No move to report...
    expect(handlePanelWidthKey(event, WIDE)).toBe(false)
    expect(width()).toBe(MIN_PANEL_WIDTH)
    // ...but the key was still ours, so nothing else gets to act on it.
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('never steps past the maximum', () => {
    useAppStore.getState().setPanelWidth(MAX_PANEL_WIDTH - 10)
    handlePanelWidthKey(keyEvent('>'), WIDE)
    expect(width()).toBe(MAX_PANEL_WIDTH)
  })

  it('clamps against the window, not just the absolute bounds', () => {
    // A 700px window affords 350px of panel; one widen from 360 must not grow it.
    handlePanelWidthKey(keyEvent('>'), 700)
    expect(width()).toBe(350)
  })

  it('leaves the keystroke to a focused field', () => {
    const event = keyEvent('>', { target: target({ tagName: 'INPUT', type: 'number' }) })
    expect(handlePanelWidthKey(event, WIDE)).toBe(false)
    expect(width()).toBe(DEFAULT_PANEL_WIDTH)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('ignores modifier chords, which belong to other bindings', () => {
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      expect(handlePanelWidthKey(keyEvent('>', { [modifier]: true }), WIDE)).toBe(false)
    }
    expect(width()).toBe(DEFAULT_PANEL_WIDTH)
  })
})

describe('installPanelWidthKeyboard', () => {
  it('acts on keydown and stops after the disposer runs', () => {
    const target = fakeWindow()
    const dispose = installPanelWidthKeyboard(target)

    target.fire('keydown', keyEvent('>'))
    expect(width()).toBe(DEFAULT_PANEL_WIDTH + PANEL_WIDTH_STEP)

    dispose()
    expect(target.count('keydown')).toBe(0)
    target.fire('keydown', keyEvent('>'))
    expect(width()).toBe(DEFAULT_PANEL_WIDTH + PANEL_WIDTH_STEP)
  })

  it('clamps against the window as it is NOW, not as it was at install', () => {
    const target = fakeWindow()
    installPanelWidthKeyboard(target)
    target.innerWidth = 700

    target.fire('keydown', keyEvent('>'))
    expect(width()).toBe(350)
  })
})

describe('installPanelWidthResize', () => {
  it('re-clamps a width the new window cannot afford', () => {
    // The wide-monitor value that would otherwise pin the viewport to a sliver.
    useAppStore.getState().setPanelWidth(MAX_PANEL_WIDTH)
    const target = fakeWindow()
    installPanelWidthResize(target)

    target.innerWidth = 900
    target.fire('resize', {})

    expect(width()).toBe(450)
  })

  it('does not touch the store when the width still fits', () => {
    const target = fakeWindow()
    installPanelWidthResize(target)
    // Every write is a localStorage write, and dragging a window edge fires
    // this continuously.
    const before = useAppStore.getState()
    target.innerWidth = 1600
    target.fire('resize', {})

    expect(useAppStore.getState().panelWidth).toBe(before.panelWidth)
    expect(useAppStore.getState()).toBe(before)
  })

  it('stops after the disposer runs', () => {
    const target = fakeWindow()
    const dispose = installPanelWidthResize(target)
    dispose()

    target.innerWidth = 600
    target.fire('resize', {})

    expect(target.count('resize')).toBe(0)
    expect(width()).toBe(DEFAULT_PANEL_WIDTH)
  })
})

describe('defaultPanelWidth', () => {
  it('is the default width on any ordinary window', () => {
    expect(defaultPanelWidth(1280)).toBe(DEFAULT_PANEL_WIDTH)
  })

  it('is CLAMPED, so the reset cannot exceed half a narrow window', () => {
    // The whole reason this is not just `DEFAULT_PANEL_WIDTH`: on a window too
    // narrow to afford 360, double-clicking the handle must not hand the panel
    // more than half the screen and leave the viewport a sliver. The e2e
    // double-click spec runs at 1280, where the clamp is a no-op, so this
    // branch has nowhere else to be pinned.
    expect(defaultPanelWidth(600)).toBe(300)
  })
})
