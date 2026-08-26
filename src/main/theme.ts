import { app, ipcMain, nativeTheme } from 'electron'
import { THEME_CHANNELS, type ThemePreference, type ThemeState } from '../shared/theme'
import {
  isThemePreference,
  readWindowState,
  windowStateFile,
  writeWindowState
} from './windowState'

// Light / dark / system (ADR-0025). Main owns the theme because
// `nativeTheme.themeSource` is a main-process property and it is what makes the
// renderer's `prefers-color-scheme` follow a PINNED choice — a renderer-only
// theme would leave native dialogs, menus and scrollbars on the OS setting.
//
// One mechanism, therefore one place: this module holds the preference, points
// nativeTheme at it, and answers both IPC calls. Nothing else in main reads
// `nativeTheme`.

/**
 * The window's `backgroundColor`, per resolved scheme.
 *
 * These are `--bg` from `styles.css` — dark `:root`, light the
 * `prefers-color-scheme: light` block — hand-copied because a stylesheet and a
 * BrowserWindow constructor argument cannot share a variable. They must stay
 * equal to the tokens: the whole point is that the frame Electron paints before
 * the first page frame is the same colour the page then paints, so no launch
 * flashes the other theme. `e2e/theme.spec.ts` compares the two and is what
 * catches a drift here.
 */
const WINDOW_BACKGROUND: Record<'dark' | 'light', string> = {
  dark: '#1b1e24',
  light: '#f4f6f9'
}

let preference: ThemePreference = 'system'

/**
 * Point `nativeTheme` at the saved preference.
 *
 * Called BEFORE the BrowserWindow is constructed, because
 * {@link windowBackgroundColor} is a constructor argument and reads the
 * resolution this sets up.
 */
export function applyTheme(saved: ThemePreference): void {
  preference = saved
  nativeTheme.themeSource = saved
}

/** The preference in force. Passed to `attachWindowState` as a GETTER so that a
 *  change made mid-session is what the next geometry save records. */
export function currentTheme(): ThemePreference {
  return preference
}

/** The resolved `--bg`, for `new BrowserWindow({ backgroundColor })`. */
export function windowBackgroundColor(): string {
  return WINDOW_BACKGROUND[nativeTheme.shouldUseDarkColors ? 'dark' : 'light']
}

function themeState(): ThemeState {
  // Asked of nativeTheme rather than derived from `preference`, because under
  // `system` only the OS knows the answer.
  return { preference, dark: nativeTheme.shouldUseDarkColors }
}

/** Where the preference is persisted — the ADR-0014 window-state file, read
 *  fresh each time so this write does not clobber geometry saved since launch
 *  (ADR-0025 §3). Resolved per call: `app.getPath` needs the app ready. */
function persist(): void {
  const file = windowStateFile(app.getPath('userData'))
  writeWindowState(file, { ...readWindowState(file), theme: preference })
}

export function registerThemeIpc(): void {
  ipcMain.handle(THEME_CHANNELS.get, (): ThemeState => themeState())

  ipcMain.handle(THEME_CHANNELS.set, (_event, requested: unknown): ThemeState => {
    // Validated against the three-member union, not trusted: this is a value
    // arriving from page content, and `themeSource` accepts only these three.
    // An unrecognised one is ignored rather than thrown — the reply carries the
    // preference that is actually in force, so a caller that asked for nonsense
    // learns it did not take.
    if (isThemePreference(requested)) {
      applyTheme(requested)
      // Written now rather than at quit: a preference the user set and then
      // lost to a crash or a kill is worse than a window that reopens slightly
      // off. The debounced geometry save records the same value again later.
      persist()
    }
    return themeState()
  })
}
