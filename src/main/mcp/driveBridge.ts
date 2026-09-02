import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import {
  MCP_DRIVE_CHANNELS,
  type DriveAction,
  type DriveBridge,
  type DriveResponse,
  type DriveResult
} from '../../shared/mcpDrive'

// The main half of the drive bridge (ADR-0029 v2): the MCP tool handlers run
// here, next to the stdio transport, but everything they drive lives in the
// renderer. This module turns "ask the app" into a correlated request/response
// over webContents — a NEW IPC direction, so it is deliberately narrow: one
// channel out, one back, ids matched here, nothing else on it.
//
// CALLS ARE SERIALIZED. MCP clients may issue tool calls concurrently, but two
// interleaved drive actions would race each other's settle windows and answer
// each other's questions (the settle tracker orders one drive against the
// HUMAN's edits; it cannot order two drives against each other). A promise
// chain gives every call the previous one's settled world.

/** Import + settle can legitimately take a while on a big STEP file; the
 *  renderer's own settle timeout (120 s) should fire first and produce the
 *  better message, so this is the backstop, not the norm. */
const DEFAULT_CALL_TIMEOUT_MS = 150_000

/** How long the first call may wait for a window + drive host to exist —
 *  covers the gap between the server connecting and the renderer booting. */
const READY_TIMEOUT_MS = 30_000

export interface DriveBridgeOptions {
  /**
   * The window to drive, created if there is not one.
   *
   * Passed in rather than found with `BrowserWindow.getAllWindows()[0]` because
   * a drive call now has a LIFECYCLE effect (slice
   * `hidden-launch-show-on-drive`): it reveals the hidden window, and rebuilds
   * one the person closed. Those are index.ts's decisions, not the bridge's —
   * the bridge only needs to be handed something to talk to.
   */
  ensureWindow(): BrowserWindow
}

export function createDriveBridge(options: DriveBridgeOptions): DriveBridge {
  let nextId = 1
  const pending = new Map<number, (response: DriveResponse) => void>()

  // WHICH PAGE is listening, not merely whether one ever was.
  //
  // The drive host announces itself from the renderer entry, so readiness is a
  // property of a loaded page rather than of the app: a page that is still
  // loading has no handler installed, and a request sent to it is simply
  // dropped. Two things make that a real case rather than a theoretical one —
  // the e2e harness reloads the page on every launch, and in server mode a
  // closed window is rebuilt on demand. Keying on the webContents id and
  // clearing it when that page starts loading again is what turns both from a
  // silent timeout into a short wait.
  const readyContents = new Set<number>()
  const waiters = new Set<() => void>()
  const watched = new Set<number>()

  ipcMain.on(MCP_DRIVE_CHANNELS.ready, (event) => {
    readyContents.add(event.sender.id)
    for (const waiter of [...waiters]) waiter()
  })

  ipcMain.on(MCP_DRIVE_CHANNELS.response, (_event, response: DriveResponse) => {
    const resolve = pending.get(response.id)
    if (resolve === undefined) return // timed out and reported; drop late answer
    pending.delete(response.id)
    resolve(response)
  })

  /** Follow one window's page lifecycle, once. */
  function watch(win: BrowserWindow): void {
    const contents = win.webContents
    if (watched.has(contents.id)) return
    watched.add(contents.id)
    contents.on('did-start-loading', () => readyContents.delete(contents.id))
    contents.on('destroyed', () => {
      readyContents.delete(contents.id)
      watched.delete(contents.id)
    })
  }

  function waitForReady(win: BrowserWindow): Promise<void> {
    const id = win.webContents.id
    if (readyContents.has(id)) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const check = (): void => {
        if (!readyContents.has(id)) return
        clearTimeout(timer)
        waiters.delete(check)
        resolve()
      }
      const timer = setTimeout(() => {
        waiters.delete(check)
        reject(new Error('the app window did not finish loading — is the app still starting?'))
      }, READY_TIMEOUT_MS)
      waiters.add(check)
    })
  }

  async function callNow(action: DriveAction, timeoutMs: number): Promise<DriveResult> {
    const win = options.ensureWindow()
    watch(win)
    await waitForReady(win)
    if (win.isDestroyed()) {
      throw new Error('the app window closed while it was being driven — try again')
    }

    const id = nextId++
    const response = await new Promise<DriveResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('the app did not answer in time'))
      }, timeoutMs)
      pending.set(id, (answer) => {
        clearTimeout(timer)
        resolve(answer)
      })
      win.webContents.send(MCP_DRIVE_CHANNELS.request, { id, action })
    })

    if (!response.ok) throw new Error(response.error)
    return response.result
  }

  // The serialization chain. Failures are caught per-link so one failed call
  // cannot poison every call after it.
  let chain: Promise<unknown> = Promise.resolve()

  return {
    call(action, timeoutMs = DEFAULT_CALL_TIMEOUT_MS) {
      const result = chain.then(() => callNow(action, timeoutMs))
      chain = result.catch(() => undefined)
      return result
    }
  }
}
