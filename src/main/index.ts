import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { registerStorageIpc, closeStorage } from './storage'
import {
  attachWindowState,
  placeWindow,
  readWindowState,
  windowStateFile
} from './windowState'

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

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
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
      : undefined
  })

  win.on('ready-to-show', () => win.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Registers handlers only — the database itself opens on first use, so a
  // storage problem cannot delay or prevent the window appearing (ADR-0007).
  registerStorageIpc()
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
