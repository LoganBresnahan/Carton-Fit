import { BrowserWindow, ipcMain } from 'electron'
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

export function createDriveBridge(): DriveBridge {
  let nextId = 1
  const pending = new Map<number, (response: DriveResponse) => void>()

  // Raised when the renderer's drive host announces itself; re-raised on every
  // page load (the e2e harness reloads the page), never lowered — a call that
  // races a reload times out and reports, which beats guessing.
  let ready = false
  let signalReady: (() => void) | null = null
  ipcMain.on(MCP_DRIVE_CHANNELS.ready, () => {
    ready = true
    signalReady?.()
    signalReady = null
  })

  ipcMain.on(MCP_DRIVE_CHANNELS.response, (_event, response: DriveResponse) => {
    const resolve = pending.get(response.id)
    if (resolve === undefined) return // timed out and reported; drop late answer
    pending.delete(response.id)
    resolve(response)
  })

  function waitForReady(): Promise<void> {
    if (ready) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signalReady = null
        reject(new Error('the app window did not finish loading — is the app still starting?'))
      }, READY_TIMEOUT_MS)
      signalReady = () => {
        clearTimeout(timer)
        resolve()
      }
    })
  }

  async function callNow(action: DriveAction, timeoutMs: number): Promise<DriveResult> {
    await waitForReady()
    const win = BrowserWindow.getAllWindows()[0]
    if (win === undefined || win.isDestroyed()) {
      throw new Error('the app window is gone — relaunch Carton Fit to drive it')
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
