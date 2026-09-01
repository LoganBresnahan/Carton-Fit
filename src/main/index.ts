import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { resolveServerOptions, serveStdio } from './mcp/host'
import { registerStorageIpc, closeStorage } from './storage'
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
// it drives. In this mode stdout belongs to the protocol; anything printed
// there corrupts the first handshake (the stdout guard and the hidden-launch
// behaviour are phase 4's slices, so today the window still shows normally).
const MCP_SERVER_MODE = process.argv.includes('--mcp-server')

// The display name has a space; the userData directory must not (ADR-0019).
// Electron derives that path from the app name, and `createWindow` reads
// userData on its first line (ADR-0014) — so this runs at module load, ahead of
// whenReady, rather than anywhere it could be beaten to the path.
app.setName('Carton-Fit')

function createWindow(): void {
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
      sandbox: false
    }
  })

  // Maximize before showing, so the window does not visibly jump.
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

  win.on('ready-to-show', () => {
    win.show()
    // AFTER the window is up, never before it (ADR-0021 §2). The check is
    // entirely optional — the app is fully usable without it — so it must not
    // sit between launch and a visible window on a slow network.
    startUpdateCheck()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
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
    serveStdio(resolveServerOptions(__dirname)).catch((err: unknown) => {
      console.error('carton-fit mcp server failed to start:', err)
    })
  }
  // Registers handlers only — the database itself opens on first use, so a
  // storage problem cannot delay or prevent the window appearing (ADR-0007).
  registerStorageIpc()
  // No lazy resource behind it — the dialog and the write are per-call
  // (ADR-0017), so registering costs nothing.
  registerExportIpc()
  // Handlers only; the request itself starts from `ready-to-show` below.
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
  if (process.platform !== 'darwin') app.quit()
})

// Checkpoint the WAL and release the file rather than leaving it to process
// teardown.
app.on('will-quit', closeStorage)
