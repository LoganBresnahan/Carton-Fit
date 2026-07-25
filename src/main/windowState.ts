import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { BrowserWindow, Rectangle } from 'electron'

// Window size/position across restarts (ADR-0014). A JSON file in userData, NOT
// SQLite: bounds are needed when the BrowserWindow is CONSTRUCTED, and the
// database opens lazily and later on purpose, so that storage trouble cannot
// delay the window appearing.
//
// Everything here is deliberately free of runtime electron imports — the caller
// passes the window and the display list in — so the placement rules can be
// unit-tested against plain data. The type-only import erases at compile time.

export interface WindowState {
  width: number
  height: number
  /** Absent means "let Electron centre it", which is also the fallback whenever
   *  a saved position turns out not to be on any attached display. */
  x?: number
  y?: number
  maximized: boolean
}

export const DEFAULT_WINDOW_STATE: WindowState = { width: 1280, height: 800, maximized: false }

/** Below this the layout (inputs panel beside the 3D stage) stops working. */
const MIN_WIDTH = 800
const MIN_HEIGHT = 600

/** How much of the window must land on a display for the position to be usable.
 *  Enough to grab and drag: a sliver on screen is as lost as none at all. */
const MIN_VISIBLE = 80

export function windowStateFile(userDataPath: string): string {
  return join(userDataPath, 'window-state.json')
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Read the saved state, or the defaults.
 *
 * Never throws. A missing, unreadable, unparseable, or wrong-shaped file all
 * mean the same thing to the user — the window opens at its default size — and
 * a corrupt geometry file must never be the reason the app fails to start.
 */
export function readWindowState(file: string): WindowState {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { ...DEFAULT_WINDOW_STATE }
  }
  if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_WINDOW_STATE }
  const raw = parsed as Record<string, unknown>
  // Each field is validated on its own: a file with a good size and a corrupt
  // position should keep the size rather than throw the whole thing away.
  const state: WindowState = {
    width: isFiniteNumber(raw.width) ? raw.width : DEFAULT_WINDOW_STATE.width,
    height: isFiniteNumber(raw.height) ? raw.height : DEFAULT_WINDOW_STATE.height,
    maximized: raw.maximized === true
  }
  if (isFiniteNumber(raw.x) && isFiniteNumber(raw.y)) {
    state.x = raw.x
    state.y = raw.y
  }
  return state
}

/** Persist the state. Also never throws: failing to remember the window's size
 *  is not worth interrupting a quit over. Written via a temp file + rename so a
 *  crash mid-write cannot leave a truncated file behind. */
export function writeWindowState(file: string, state: WindowState): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    renameSync(tmp, file)
  } catch {
    // Nothing to do, and nothing worth telling the user about.
  }
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0)
}

/**
 * Fit a remembered state to the displays that exist RIGHT NOW.
 *
 * The case that matters is a position saved on a monitor that is no longer
 * attached, or a resolution that shrank. Restoring such bounds blindly puts the
 * window entirely off-screen, and an app that appears not to launch reads as a
 * crash — a worse failure than forgetting where it was.
 *
 * @param workAreas each display's work area (screen minus taskbar/dock).
 */
export function placeWindow(state: WindowState, workAreas: readonly Rectangle[]): WindowState {
  const largest = workAreas.reduce<Rectangle | null>(
    (best, a) => (!best || a.width * a.height > best.width * best.height ? a : best),
    null
  )
  const placed: WindowState = {
    width: Math.max(MIN_WIDTH, state.width),
    height: Math.max(MIN_HEIGHT, state.height),
    maximized: state.maximized
  }
  if (largest) {
    // Never restore a window bigger than the screen it lands on; the floor wins
    // ties, since a slightly clipped window still beats an unusable one.
    placed.width = Math.max(MIN_WIDTH, Math.min(placed.width, largest.width))
    placed.height = Math.max(MIN_HEIGHT, Math.min(placed.height, largest.height))
  }
  if (state.x === undefined || state.y === undefined) return placed

  const visible = workAreas.some(
    (area) =>
      overlap(state.x!, state.x! + placed.width, area.x, area.x + area.width) >= MIN_VISIBLE &&
      overlap(state.y!, state.y! + placed.height, area.y, area.y + area.height) >= MIN_VISIBLE
  )
  if (!visible) return placed // drop the position; Electron centres it

  placed.x = state.x
  placed.y = state.y
  return placed
}

/** What to save for a window right now. Uses the NORMAL bounds so that a
 *  maximized window restores to a sensible size when un-maximized, rather than
 *  remembering the full screen as its restored size.
 *
 *  @param position overrides the reported position — see
 *  {@link WindowStateOptions.requestedPosition} for why the reported one cannot
 *  simply be trusted. */
export function captureWindowState(
  win: BrowserWindow,
  position?: { x: number; y: number }
): WindowState {
  const bounds = win.getNormalBounds()
  return {
    width: bounds.width,
    height: bounds.height,
    x: position ? position.x : bounds.x,
    y: position ? position.y : bounds.y,
    maximized: win.isMaximized()
  }
}

/**
 * The largest discrepancy still attributable to the window frame. Decorations
 * are tens of pixels; a bigger gap means the user moved the window, which is a
 * position we must record rather than explain away.
 */
const MAX_FRAME_OFFSET = 60

export interface WindowStateOptions {
  /** Overridable so tests do not have to wait out the real debounce. */
  debounceMs?: number
  /**
   * The position asked for at construction, when one was asked for.
   *
   * MEASURED on WSLg: `BrowserWindow` interprets x/y as EXCLUDING the window
   * frame, but `getNormalBounds()` reports a position INCLUDING it. Saving what
   * is reported and passing it back next launch therefore adds the decoration
   * size every single time — measured at +6,+27 per launch, so twenty launches
   * walk the window 540 px down the screen and eventually off it.
   *
   * Timing cannot fix this. There is no instant at which the reported position
   * is reliably post-shift: bounds read 0,0 before the window is mapped, then
   * equal the requested position, and only afterwards gain the frame offset —
   * and on Windows they never gain it at all. So instead of asking "when is the
   * reading valid", this treats a sub-frame-sized difference from what we asked
   * for as *the same position*, and only believes a reported position once it
   * differs by more than a frame could account for.
   */
  requestedPosition?: { x: number; y: number }
}

/**
 * Keep `file` in step with the window.
 *
 * Saves are debounced because resize and move fire continuously while dragging,
 * and a synchronous write per event would stutter the drag. The close handler
 * writes immediately and cancels any pending timer, so the last state always
 * lands even if the user quits mid-drag.
 */
export function attachWindowState(
  win: BrowserWindow,
  file: string,
  options: WindowStateOptions = {}
): void {
  const debounceMs = options.debounceMs ?? 400
  let timer: NodeJS.Timeout | null = null
  /** Cleared once the window is somewhere we did not put it — i.e. the user
   *  moved it, and the reported position becomes the truth from then on. */
  let anchor = options.requestedPosition
  /** This window manager's frame offset, learned by comparing where we asked the
   *  window to be against where it says it is. Zero until observed. */
  let frameDelta = { x: 0, y: 0 }

  /**
   * The position to record.
   *
   * While the window is still within a frame's distance of where we asked for
   * it, we record what we ASKED for; the difference is the window manager's
   * decoration, and echoing it back is what makes the window walk. Once it moves
   * further than a frame could explain, the user has moved it: drop the anchor
   * and record reality from then on, including any later small adjustments.
   */
  const positionToSave = (): { x: number; y: number } => {
    const bounds = win.getNormalBounds()
    if (anchor) {
      const dx = bounds.x - anchor.x
      const dy = bounds.y - anchor.y
      if (Math.abs(dx) <= MAX_FRAME_OFFSET && Math.abs(dy) <= MAX_FRAME_OFFSET) {
        // Still where we put it. Remember the discrepancy: it IS this window
        // manager's frame offset, measured against a position we know, and it
        // is the only chance to learn it before the anchor is gone.
        frameDelta = { x: dx, y: dy }
        return { ...anchor }
      }
      anchor = undefined
    }
    // Moved by the user. Report reality, less the frame offset learned above,
    // so the window reopens where they actually left it rather than a title bar
    // lower.
    return { x: bounds.x - frameDelta.x, y: bounds.y - frameDelta.y }
  }

  const save = (): void => {
    timer = null
    writeWindowState(file, captureWindowState(win, positionToSave()))
  }
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, debounceMs)
  }

  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    save()
  })
}
