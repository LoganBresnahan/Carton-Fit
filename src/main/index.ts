import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { resolveServerOptions, serveStdio } from './mcp/host'
import { createDriveBridge } from './mcp/driveBridge'
import { claimStdoutForProtocol } from './mcp/stdout'
import { registerStorageIpc, closeStorage, storageForTools } from './storage'
import { registerExportIpc } from './exportFile'
import { registerUpdateIpc, startUpdateCheck } from './updateCheck'
import { applyTheme, currentTheme, registerThemeIpc, windowBackgroundColor } from './theme'
import {
  attachWindowState,
  placeWindow,
  readWindowState,
  windowStateFile
} from './windowState'

// SERVER MODE (ADR-0029, slice `mcp-server-host-in-main`): launched with
// --mcp-server, the app additionally serves MCP on its own stdin/stdout — the
// same window, the same store, plus a protocol client attached. This is the
// mode the drive tier (v2) runs in: the server has to live beside the window
// it drives.
//
// Two things about this mode are decided in THIS file, both phase 4:
//
//   - stdout belongs to the protocol. Claimed at module load, before any
//     import can print, because the client's transport is reading our stdout
//     from the moment it spawned us (slice `stdout-protocol-discipline`).
//   - the window stays HIDDEN until a drive call needs it (slice
//     `hidden-launch-show-on-drive`). Claude Desktop starts its servers when
//     the app starts, and a window appearing because someone opened a chat is
//     an app taking over the screen unasked. Everything below marked "server
//     mode" follows from those two.
const MCP_SERVER_MODE = process.argv.includes('--mcp-server')
if (MCP_SERVER_MODE) claimStdoutForProtocol()

// The display name has a space; the userData directory must not (ADR-0019).
// Electron derives that path from the app name, and `createWindow` reads
// userData on its first line (ADR-0014) — so this runs at module load, ahead of
// whenReady, rather than anywhere it could be beaten to the path.
app.setName('Carton-Fit')

/** The window, or null between a close and the next `ensureWindow`. In server
 *  mode a closed window is not the end of the process, so this is genuinely
 *  nullable rather than a formality (see `window-all-closed`). */
let mainWindow: BrowserWindow | null = null
/** `ready-to-show` has fired for `mainWindow`. Showing before it paints a white
 *  rectangle, so a reveal asked for early has to wait for this. */
let windowPainted = false
/** Whether the window should be on screen. False only in server mode, and only
 *  until the first drive call. */
let wantsReveal = !MCP_SERVER_MODE

/**
 * Show the window if it is painted and wanted, and start the update check the
 * first time it actually appears.
 *
 * The check is gated on a VISIBLE window, not on a launched app (ADR-0021 §2).
 * That gate was originally about latency — an optional network request must not
 * sit between launch and a window — and hidden launch turns it into something
 * stronger: an app serving MCP with no window on screen has nobody to read a
 * banner, so it makes no request at all until it has one. `startUpdateCheck`
 * memoizes the promise, so calling it on every reveal is still one request per
 * launch.
 */
function maybeReveal(): void {
  const win = mainWindow
  if (win === null || win.isDestroyed() || !windowPainted || !wantsReveal) return
  // Guarded rather than unconditional: `show()` also raises and focuses, and a
  // drive call is not a reason to steal focus from whatever the person is
  // doing every single time. (A minimized window reports not-visible, so this
  // still restores one — which IS wanted: the tool is about to change what it
  // shows.)
  if (!win.isVisible()) win.show()
  startUpdateCheck()
}

function createWindow(): BrowserWindow {
  // Read BEFORE constructing the window — bounds are a constructor argument, and
  // applying them afterwards would show the window at the wrong size first
  // (ADR-0014). `screen` is only available after app.whenReady(), which is
  // where this is called from.
  const stateFile = windowStateFile(app.getPath('userData'))
  const state = placeWindow(
    readWindowState(stateFile),
    screen.getAllDisplays().map((display) => display.workArea)
  )

  // Before the window exists, for two reasons that are really one (ADR-0025):
  // `themeSource` is what points the renderer's `prefers-color-scheme` at a
  // PINNED choice, and `backgroundColor` — fixed at construction — has to
  // resolve through it, or every launch shows the other theme's background
  // until the page paints.
  applyTheme(state.theme)

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    backgroundColor: windowBackgroundColor(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // SERVER MODE ONLY. A window created with `show: false` is a hidden page
      // to Chromium, which throttles its timers and stops its animation frames
      // — and this mode's whole shape is a window sitting hidden for as long as
      // Claude Desktop is open, then being driven. Auto-run is debounced on a
      // timer and the viewport renders on rAF, so a throttled hidden page turns
      // the first drive call into a minutes-long wait for work that takes
      // milliseconds. The ordinary app keeps throttling: there, a hidden window
      // is a minimized one nobody is waiting on.
      backgroundThrottling: !MCP_SERVER_MODE
    }
  })

  // Maximize before showing, so the window does not visibly jump. Still true
  // with a DEFERRED show: this runs at construction either way, and a hidden
  // window that is already maximized reveals maximized (ADR-0014's sequencing
  // survives because nothing about it was tied to `ready-to-show`).
  if (state.maximized) win.maximize()
  attachWindowState(win, stateFile, {
    requestedPosition: state.x !== undefined && state.y !== undefined
      ? { x: state.x, y: state.y }
      : undefined,
    // A getter, not a value: every save rewrites the whole file, and the
    // preference can change any moment the user touches the header select, so
    // a value read here would undo their choice on the next resize.
    currentTheme
  })

  mainWindow = win
  windowPainted = false
  win.on('ready-to-show', () => {
    windowPainted = true
    maybeReveal()
  })
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
      windowPainted = false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

/**
 * The window a drive call is about to talk to — created if the person closed
 * it, and revealed either way.
 *
 * RECREATE RATHER THAN REFUSE. In server mode closing the window does not end
 * the process (the client still holds this server), so "the window is gone"
 * would otherwise be a permanent dead end for a session Claude Desktop keeps
 * open all day. The recreated window starts empty, which the reply says out
 * loud — `state.file.loaded` is false — rather than leaving the client to
 * wonder where its model went.
 */
function ensureWindow(): BrowserWindow {
  wantsReveal = true
  const win = mainWindow !== null && !mainWindow.isDestroyed() ? mainWindow : createWindow()
  maybeReveal()
  return win
}

app.whenReady().then(() => {
  // Before the window: the client is already waiting on the handshake, and
  // nothing the server needs waits on the renderer — v1 tools answer from disk
  // and core alone. Options come from the same __dirname derivation the
  // headless entry uses, NOT from `app` — one rule, so the two server modes
  // cannot disagree about the wasm path or the version (host.ts says why
  // `app.getVersion()` is also just wrong in an e2e launch). A failure to
  // serve is reported and NOT fatal: the person launched an app, and the app
  // half still works.
  if (MCP_SERVER_MODE) {
    // The drive bridge is what makes this mode more than the headless entry:
    // the v2/v3 tools reach the renderer's store through it (ADR-0029). Its
    // first call waits for the window's drive host to announce itself, so
    // starting the server ahead of createWindow() is safe.
    serveStdio({
      ...resolveServerOptions(__dirname),
      drive: createDriveBridge({ ensureWindow }),
      // The v3 data tier reads presets and saved estimates straight from
      // main's own database — the same connection the renderer's IPC uses, so
      // a list cannot disagree with what the panel shows.
      storage: storageForTools
    }).catch((err: unknown) => {
      console.error('carton-fit mcp server failed to start:', err)
    })
  }
  // Registers handlers only — the database itself opens on first use, so a
  // storage problem cannot delay or prevent the window appearing (ADR-0007).
  registerStorageIpc()
  // No lazy resource behind it — the dialog and the write are per-call
  // (ADR-0017), so registering costs nothing.
  registerExportIpc()
  // Handlers only; the request itself starts from the first reveal above.
  registerUpdateIpc()
  // Handlers only as well — `createWindow` applies the saved preference itself,
  // since it needs it before the window is constructed.
  registerThemeIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // SERVER MODE NEVER QUITS ON A CLOSED WINDOW. The process belongs to the MCP
  // client as much as to the person: quitting here would kill a server Claude
  // Desktop is still holding, and the next tool call would fail with a
  // transport error rather than an answer. `ensureWindow` builds a new window
  // when one is next needed — which is exactly how macOS has always treated a
  // closed window, now for the same reason on every platform.
  if (MCP_SERVER_MODE) return
  if (process.platform !== 'darwin') app.quit()
})

// Checkpoint the WAL and release the file rather than leaving it to process
// teardown.
app.on('will-quit', closeStorage)
