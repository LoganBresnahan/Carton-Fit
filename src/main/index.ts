import { app, BrowserWindow, screen } from 'electron'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:net'
import { join } from 'path'
import { resolveServerOptions, servePipeSessions, serveStdio, type ServerOptions } from './mcp/host'
import { createDriveBridge } from './mcp/driveBridge'
import { pipePath } from './mcp/pipePath'
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
// SPAWNED BY THE SHIM (slice `mcp-shim-single-instance`): same hidden server
// mode, with two differences that both follow from who launched it. Its stdio
// goes nowhere (the shim connected it to 'ignore', and on Windows a GUI
// process's stdio goes nowhere regardless — the finding that made the shim
// the mechanism), so serving stdio is skipped rather than served into a void;
// and no person chose to start it, so nobody would ever choose to stop it —
// it quits itself when idle instead (see maybeQuitIdleServer).
const MCP_SPAWNED = process.argv.includes('--mcp-spawned')
if (MCP_SERVER_MODE) claimStdoutForProtocol()

// The display name has a space; the userData directory must not (ADR-0019).
// Electron derives that path from the app name, and `createWindow` reads
// userData on its first line (ADR-0014) — so this runs at module load, ahead of
// whenReady, rather than anywhere it could be beaten to the path.
app.setName('Carton-Fit')

// ONE INSTANCE PER PROFILE (slice `mcp-shim-single-instance`). The pipe below
// makes this load-bearing rather than polite: the pipe's name is derived from
// the profile, so two instances on one profile would be two apps disputing one
// identity — and the person double-clicking the icon while a hidden server
// runs MEANS "show me the app", not "start a second one". The lock is
// userData-scoped (Electron's own rule), so e2e profiles and a dogfooder's
// real profile never contend.
const SINGLE_INSTANCE = app.requestSingleInstanceLock()

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
    // In server mode a closed window may have been the last thing keeping the
    // process meaningful — see the lifecycle arithmetic above whenReady.
    maybeQuitIdleServer()
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

// ── Server-mode lifecycle arithmetic (slice `mcp-shim-single-instance`) ──────
//
// A server-mode process has up to three reasons to stay alive: a stdio client
// (stdin still open), pipe sessions (shim-connected clients), and a window a
// person can see. When the LAST of them goes, staying alive is not
// persistence, it is an orphan — the exact thing mcpEntry's exit-on-close
// avoids for the headless entry, arriving here with more moving parts.
// Event-driven on purpose: nothing polls, every count change re-evaluates.
let pipeSessions = 0
let stdioClientPresent = false
let pipeServer: Server | null = null

function maybeQuitIdleServer(): void {
  if (!MCP_SERVER_MODE) return // normal launches quit via window-all-closed
  if (pipeSessions > 0 || stdioClientPresent) return
  const win = mainWindow
  if (win !== null && !win.isDestroyed() && win.isVisible()) return
  // Nobody is connected and nobody can see it. A visible window survives this
  // check deliberately: a drive call revealed it, so a person may be reading
  // what Claude did — the app is theirs now, and it lives until they close it
  // (at which point the 'closed' handler brings us back here).
  //
  // STOP ACCEPTING FIRST. A shim dialing during teardown must get REFUSED —
  // its retry loop then spawns a fresh app, which is the recovery that works —
  // rather than a connection to a process already half-gone, which is a dead
  // session it cannot distinguish from a working one until it times out.
  pipeServer?.close()
  pipeServer = null
  app.quit()
}

/** Where the server-mode pid is recorded — `<userData>/mcp-server.pid`. For a
 *  human asking "is one running", and for the e2e harness, which must be able
 *  to stop a detached app the shim started (it owns neither end of it). */
function pidFile(): string {
  return join(app.getPath('userData'), 'mcp-server.pid')
}

app.whenReady().then(() => {
  if (!SINGLE_INSTANCE) return // quitting; see the lock above
  // Before the window: the client is already waiting on the handshake, and
  // nothing the server needs waits on the renderer — v1 tools answer from disk
  // and core alone. Options come from the same __dirname derivation the
  // headless entry uses, NOT from `app` — one rule, so the two server modes
  // cannot disagree about the wasm path or the version (host.ts says why
  // `app.getVersion()` is also just wrong in an e2e launch). A failure to
  // serve is reported and NOT fatal: the person launched an app, and the app
  // half still works.
  // The drive bridge is what makes an in-app server more than the headless
  // entry: the v2/v3 tools reach the renderer's store through it (ADR-0029).
  // Its first call waits for the window's drive host to announce itself, so
  // starting servers ahead of createWindow() is safe. ONE options object for
  // every transport, so a stdio client and a pipe client cannot be answered by
  // servers that disagree about anything.
  const serverOptions: ServerOptions = {
    ...resolveServerOptions(__dirname),
    drive: createDriveBridge({ ensureWindow }),
    // The v3 data tier reads presets and saved estimates straight from
    // main's own database — the same connection the renderer's IPC uses, so
    // a list cannot disagree with what the panel shows.
    storage: storageForTools
  }

  if (MCP_SERVER_MODE && !MCP_SPAWNED) {
    stdioClientPresent = true
    serveStdio(serverOptions)
      .then((server) => {
        // stdin closing is the stdio client hanging up — one of the three
        // stay-alive reasons gone.
        server.server.onclose = () => {
          stdioClientPresent = false
          maybeQuitIdleServer()
        }
      })
      .catch((err: unknown) => {
        stdioClientPresent = false
        console.error('carton-fit mcp server failed to start:', err)
      })
  }

  // EVERY launch listens on the profile's pipe, not just server mode — the
  // ADR's launch-order promise runs both directions: a person who opened the
  // app first, then asked Claude, connects to the app they are looking at.
  // Failure is reported and non-fatal for the same reason stdio's is: the
  // person launched an app, and the app half still works.
  servePipeSessions(pipePath(app.getPath('userData')), serverOptions, {
    onSessionStart: () => {
      pipeSessions += 1
    },
    onSessionEnd: () => {
      pipeSessions -= 1
      maybeQuitIdleServer()
    }
  })
    .then((server) => {
      pipeServer = server
    })
    .catch((err: unknown) => {
      console.error('carton-fit mcp pipe failed to start:', err)
    })

  if (MCP_SERVER_MODE) {
    // Best-effort on both ends: a pidfile that cannot be written costs the
    // harness its cleanup, never the user their app.
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(pidFile(), `${process.pid}\n`, 'utf8')
    } catch {
      // Nothing to do.
    }
  }

  if (MCP_SPAWNED) {
    // The orphan backstop: spawned to serve a shim that then never connected
    // (killed between spawn and dial, crashed, gave up). Sessions arriving or
    // a reveal make this timer a no-op; without either, a process nobody knows
    // exists should not wait for a reboot to find that out.
    setTimeout(maybeQuitIdleServer, 60_000)
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

if (!SINGLE_INSTANCE) {
  // Some other process owns this profile. Electron has already delivered the
  // 'second-instance' event to it — this process's only job was to carry that
  // message, and lingering would mean two apps disputing one pipe and one
  // database. (A second --mcp-server launch on the SAME profile also lands
  // here and its client gets nothing; the shim route never does this — it
  // connects to the existing instance instead of launching a rival.)
  app.quit()
}

app.on('second-instance', () => {
  // A person launched the app while an instance — perhaps a hidden server —
  // already owned this profile. They mean "show me the app": reveal the
  // window the running instance has, or build one if Claude's session closed
  // it. Guarded on ready because the event can in principle race our own
  // boot, and ensureWindow needs `screen`.
  if (!app.isReady()) return
  const win = ensureWindow()
  if (win.isMinimized()) win.restore()
  win.focus()
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
app.on('will-quit', () => {
  closeStorage()
  if (MCP_SERVER_MODE) {
    try {
      unlinkSync(pidFile())
    } catch {
      // Never written, or already gone — either way, done.
    }
  }
})
