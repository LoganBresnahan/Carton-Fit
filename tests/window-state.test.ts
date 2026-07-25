import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  attachWindowState,
  DEFAULT_WINDOW_STATE,
  placeWindow,
  readWindowState,
  windowStateFile,
  writeWindowState,
  type WindowState
} from '../src/main/windowState'

// Window geometry persistence (ADR-0014). The rules that matter are the ones
// about NOT trusting the file: it is user-editable, it survives hardware
// changes, and none of its failure modes may stop the app from opening.

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pe-winstate-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const file = (): string => windowStateFile(dir)
const screen = (w: number, h: number, x = 0, y = 0) => ({ x, y, width: w, height: h })

describe('readWindowState', () => {
  it('returns the defaults when there is no file', () => {
    expect(readWindowState(file())).toEqual(DEFAULT_WINDOW_STATE)
  })

  it('round-trips a saved state', () => {
    const state: WindowState = { width: 1000, height: 700, x: 40, y: 60, maximized: true }
    writeWindowState(file(), state)
    expect(readWindowState(file())).toEqual(state)
  })

  it('falls back to defaults on unparseable JSON rather than throwing', () => {
    // A corrupt geometry file must never be why the app fails to start.
    writeFileSync(file(), '{not json at all')
    expect(readWindowState(file())).toEqual(DEFAULT_WINDOW_STATE)
  })

  it('falls back to defaults when the JSON is not an object', () => {
    writeFileSync(file(), '"a string"')
    expect(readWindowState(file())).toEqual(DEFAULT_WINDOW_STATE)
    writeFileSync(file(), 'null')
    expect(readWindowState(file())).toEqual(DEFAULT_WINDOW_STATE)
  })

  it('keeps the good fields when only some are corrupt', () => {
    // Throwing the whole file away would lose a perfectly good size because a
    // position was garbage.
    writeFileSync(file(), JSON.stringify({ width: 900, height: 'huge', x: 10, y: null }))
    const state = readWindowState(file())
    expect(state.width).toBe(900)
    expect(state.height).toBe(DEFAULT_WINDOW_STATE.height)
    // x without a valid y is not a position.
    expect(state.x).toBeUndefined()
    expect(state.y).toBeUndefined()
  })

  it('rejects non-finite numbers, which JSON.parse will happily produce', () => {
    writeFileSync(file(), '{"width": 1e999, "height": 700}')
    expect(readWindowState(file()).width).toBe(DEFAULT_WINDOW_STATE.width)
  })

  it('treats a missing maximized flag as not maximized', () => {
    writeFileSync(file(), JSON.stringify({ width: 900, height: 700 }))
    expect(readWindowState(file()).maximized).toBe(false)
  })
})

describe('writeWindowState', () => {
  it('does not throw when the destination is unwritable', () => {
    // Failing to remember the window size is not worth interrupting a quit.
    const bad = join(dir, 'window-state.json', 'nested', 'state.json')
    writeFileSync(join(dir, 'window-state.json'), 'x') // now a file, not a directory
    expect(() => writeWindowState(bad, DEFAULT_WINDOW_STATE)).not.toThrow()
  })

  it('leaves no temp file behind', () => {
    writeWindowState(file(), DEFAULT_WINDOW_STATE)
    expect(() => readFileSync(`${file()}.tmp`)).toThrow()
  })
})

describe('placeWindow', () => {
  const primary = screen(1920, 1040)

  it('keeps a position that is on screen', () => {
    const placed = placeWindow({ width: 1000, height: 700, x: 100, y: 50, maximized: false }, [primary])
    expect(placed).toEqual({ width: 1000, height: 700, x: 100, y: 50, maximized: false })
  })

  it('DROPS a position on a monitor that is no longer attached', () => {
    // The case this whole function exists for: the window was last closed on a
    // second monitor to the right. Restoring blindly puts it entirely
    // off-screen, and an app that appears not to launch reads as a crash.
    const placed = placeWindow({ width: 1000, height: 700, x: 2400, y: 300, maximized: false }, [
      primary
    ])
    expect(placed.x).toBeUndefined()
    expect(placed.y).toBeUndefined()
    expect(placed.width).toBe(1000) // the SIZE is still worth keeping
  })

  it('keeps a position on a second monitor that IS still attached', () => {
    const placed = placeWindow({ width: 1000, height: 700, x: 2400, y: 300, maximized: false }, [
      primary,
      screen(1920, 1040, 1920, 0)
    ])
    expect(placed.x).toBe(2400)
  })

  it('keeps a window that hangs off an edge but is still grabbable', () => {
    // Partly off-screen is normal and deliberate; only unreachable is a problem.
    const placed = placeWindow({ width: 1000, height: 700, x: 1700, y: 0, maximized: false }, [
      primary
    ])
    expect(placed.x).toBe(1700)
  })

  it('drops a position leaving only a sliver on screen', () => {
    // 20 px of window on screen is as lost as none — there is nothing to drag.
    const placed = placeWindow({ width: 1000, height: 700, x: 1900, y: 0, maximized: false }, [
      primary
    ])
    expect(placed.x).toBeUndefined()
  })

  it('drops a position that is off screen vertically only', () => {
    const placed = placeWindow({ width: 1000, height: 700, x: 100, y: -690, maximized: false }, [
      primary
    ])
    expect(placed.x).toBeUndefined()
  })

  it('shrinks a window bigger than the screen it would open on', () => {
    // A resolution change between sessions, or a profile copied from a bigger
    // machine.
    const placed = placeWindow({ width: 3000, height: 2000, x: 0, y: 0, maximized: false }, [
      screen(1280, 720)
    ])
    expect(placed.width).toBe(1280)
    expect(placed.height).toBe(720)
  })

  it('enforces a usable minimum over a tiny saved size', () => {
    // The layout is a wide inputs panel beside a 3D stage; below this it stops
    // working, and a 1x1 window is indistinguishable from a failed launch.
    const placed = placeWindow({ width: 1, height: 1, maximized: false }, [primary])
    expect(placed.width).toBeGreaterThanOrEqual(800)
    expect(placed.height).toBeGreaterThanOrEqual(600)
  })

  it('prefers the minimum size over the screen bound when they conflict', () => {
    // A clipped-but-usable window beats a correctly-fitted unusable one.
    const placed = placeWindow({ width: 1200, height: 900, maximized: false }, [screen(640, 480)])
    expect(placed.width).toBe(800)
    expect(placed.height).toBe(600)
  })

  it('carries the maximized flag through untouched', () => {
    expect(placeWindow({ width: 1000, height: 700, maximized: true }, [primary]).maximized).toBe(true)
  })

  it('survives having no displays at all', () => {
    // screen.getAllDisplays() returning nothing should not crash the launch.
    const placed = placeWindow({ width: 1000, height: 700, x: 10, y: 10, maximized: false }, [])
    expect(placed.width).toBe(1000)
    expect(placed.x).toBeUndefined()
  })
})

// The frame-offset correction. MEASURED on WSLg: BrowserWindow takes x/y
// EXCLUDING the window frame but getNormalBounds() reports it INCLUDING the
// frame, so echoing the reported position back adds the decoration size every
// launch — +6,+27 each time, walking the window off the screen in twenty
// launches. No instant is reliably post-shift (bounds read 0,0 before mapping,
// then the requested value, then the shifted one — and on Windows never shift
// at all), so the rule is positional, not temporal.
describe('frame offset compensation', () => {
  function fakeWindow(reported: { x: number; y: number; width: number; height: number }) {
    const handlers = new Map<string, () => void>()
    return {
      getNormalBounds: () => reported,
      isMaximized: () => false,
      on(event: string, fn: () => void) { handlers.set(event, fn) },
      once(event: string, fn: () => void) { handlers.set(event, fn) },
      fire(event: string) { handlers.get(event)?.() },
      moveTo(x: number, y: number) { reported.x = x; reported.y = y }
    }
  }
  /* eslint-disable @typescript-eslint/no-explicit-any */

  it('saves the position we asked for, not the one the frame shifted it to', () => {
    const win = fakeWindow({ x: 72, y: 94, width: 1024, height: 720 })
    attachWindowState(win as any, file(), { requestedPosition: { x: 66, y: 67 } })
    win.fire('close')
    const saved = readWindowState(file())
    expect(saved.x).toBe(66)
    expect(saved.y).toBe(67)
  })

  it('does not drift across repeated launches — the whole point', () => {
    // Simulate five launches of a window manager that adds +6,+27 every time.
    let state: WindowState = { width: 1024, height: 720, x: 300, y: 200, maximized: false }
    for (let launch = 0; launch < 5; launch++) {
      const win = fakeWindow({ x: state.x! + 6, y: state.y! + 27, width: 1024, height: 720 })
      attachWindowState(win as any, file(), { requestedPosition: { x: state.x!, y: state.y! } })
      win.fire('close')
      state = readWindowState(file())
    }
    expect(state.x).toBe(300)
    expect(state.y).toBe(200)
  })

  it('records a real user move, which is bigger than any frame', () => {
    const win = fakeWindow({ x: 306, y: 227, width: 1024, height: 720 })
    attachWindowState(win as any, file(), { requestedPosition: { x: 300, y: 200 } })
    win.moveTo(900, 500)
    win.fire('close')
    expect(readWindowState(file()).x).toBe(900)
  })

  it('keeps tracking small adjustments once the user has moved the window', () => {
    // After a real move the anchor is gone, so a later nudge is recorded rather
    // than being mistaken for decoration.
    const win = fakeWindow({ x: 306, y: 227, width: 1024, height: 720 })
    attachWindowState(win as any, file(), { requestedPosition: { x: 300, y: 200 }, debounceMs: 0 })
    win.moveTo(900, 500)
    win.fire('close')
    win.moveTo(920, 510)
    win.fire('close')
    expect(readWindowState(file()).x).toBe(920)
  })

  it('reopens a moved window exactly where the user left it', () => {
    // The frame offset is learned while the window is still anchored, then
    // applied to the user's own position — otherwise their move would come back
    // one title bar lower, once.
    const win = fakeWindow({ x: 306, y: 227, width: 900, height: 640 })
    attachWindowState(win as any, file(), { requestedPosition: { x: 300, y: 200 } })
    win.fire('close') // an anchored save: learns the +6,+27 offset
    win.moveTo(906, 527) // the user drags it; the WM still reports frame-inclusive
    win.fire('close')
    const saved = readWindowState(file())
    expect(saved.x).toBe(900)
    expect(saved.y).toBe(500)
  })

  it('records the reported position when nothing was requested', () => {
    // First ever launch: Electron centred the window, and wherever it landed is
    // exactly what we want to remember.
    const win = fakeWindow({ x: 646, y: 347, width: 1280, height: 800 })
    attachWindowState(win as any, file(), {})
    win.fire('close')
    expect(readWindowState(file()).x).toBe(646)
  })
})
