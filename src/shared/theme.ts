// The theme contract, shared by all three processes (ADR-0025).
//
// Same discipline as `shared/update.ts` and `shared/exportFile.ts`: TYPES AND
// CONSTANTS ONLY, because this file is imported into the renderer bundle and
// must not drag Electron or node: modules in with it.
//
// The split of responsibility is the decision. MAIN owns `nativeTheme` and the
// persisted preference; the RENDERER owns only the select's current value. The
// stylesheet is not in this contract at all — it keys on `prefers-color-scheme`
// alone, which Electron points at `themeSource`, so there is one mechanism and
// no attribute for the two sides to disagree about.

/** `system` follows the OS; the other two pin it. */
export type ThemePreference = 'system' | 'light' | 'dark'

/** The membership test main validates a renderer-supplied value against. Every
 *  value crossing the wire is checked here, the same posture as `export:save`
 *  deciding the bytes while main decides the dialog. */
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

export const THEME_CHANNELS = {
  get: 'theme:get',
  set: 'theme:set'
} as const

export interface ThemeState {
  /** What the user chose — what the select shows. */
  readonly preference: ThemePreference
  /** What that currently RESOLVES to, i.e. `nativeTheme.shouldUseDarkColors`.
   *  Under `system` this is the OS's answer and can change without anyone
   *  asking; the viewport tracks it through `prefers-color-scheme` rather than
   *  by polling here (ADR-0025 §5). */
  readonly dark: boolean
}

export interface ThemeApi {
  /** The preference in force, and what it resolves to right now. */
  get(): Promise<ThemeState>
  /**
   * Pin or unpin the theme, and persist it.
   *
   * Takes effect immediately and is written to the window-state file straight
   * away rather than at quit — a preference the user set and then lost to a
   * crash is worse than a window that reopens a little off (ADR-0025 §3).
   *
   * Resolves to the new state. An unrecognised value is rejected in main and
   * leaves the preference untouched, so what comes back is the truth rather
   * than an echo of what was asked for.
   */
  set(preference: ThemePreference): Promise<ThemeState>
}
