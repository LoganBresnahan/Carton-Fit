# 0025 — Theme: light, dark, and system, owned by the main process

Status: Accepted (2026-08-26) — not yet built; see roadmap item 18

## Context

The app has one look: dark, via nine CSS custom properties on `:root` and
`color-scheme: dark` (`styles.css`). Dogfooding asked for light and dark, and
ideally "follow the system". The tokens make the stylesheet half of that
nearly free. What is not free:

- **The 3D viewport is not CSS.** Its background (`0x1b1e24`, a hand-copied
  `--bg`), the part material (`0x9aa3b5`, a hand-copied `--muted`), the carton
  wireframe (`0x7c88a0`) and the hemisphere ground light are hex constants set
  imperatively in three.js (ADR-0008 keeps three.js inside the viewport
  island). A theme that leaves them alone is a dark canvas floating in a
  white app. The PNG export (ADR-0017) captures the same scene, so its
  background follows whatever the viewport does.
- **A theme is needed before the renderer exists.** `BrowserWindow` paints
  its `backgroundColor` until the page's first frame; a dark user with a
  white default (or the reverse) sees a flash on every launch. This is the
  same "needed earlier than storage is ready" argument that put window bounds
  in a userData JSON file rather than SQLite (ADR-0014).
- **Where a preference lives is a contract.** `settings` is the packing
  inputs, and presets and saved estimates serialize it whole (ADR-0007,
  ADR-0016). A theme inside `settings` would be restored by "Restore inputs",
  which is exactly the wrong-home problem ADR-0018 §3 solved for overrides.
  Any new localStorage key is a versioned surface (ADR-0020).
- Native surfaces — the export save dialog, scrollbars, form controls — take
  their look from Chromium's `color-scheme`, which Electron derives from
  `nativeTheme`. A renderer-only theme would leave those on the OS setting.

## Decision

1. **A three-way preference: `system` | `light` | `dark`, default `system`.**
   Nothing changes for anyone on launch: a dark OS keeps the dark app.
2. **The main process owns the theme source.** On launch it reads the
   preference and sets `nativeTheme.themeSource` to it. The renderer's
   stylesheet keys on **`prefers-color-scheme` only** — Electron makes that
   media query follow `themeSource` — so there is one mechanism, no
   `data-theme` attribute, and native dialogs and scrollbars follow too.
   Light tokens are the `prefers-color-scheme: light` redefinition of the
   same nine variables; `color-scheme` is declared for both.
3. **Persisted in the ADR-0014 window-state file** as a `theme` field,
   validated like every other field there (unknown or missing → `system`).
   That file is read before the window is created, which is what lets
   `BrowserWindow.backgroundColor` be set to the *resolved* theme's `--bg` —
   no flash — and it is already the home for "how the app's chrome looks"
   as opposed to "what is being packed". ADR-0014's title still holds: it is
   a JSON file, not SQLite, and its reason (needed before storage) is this
   feature's reason too.
4. **One IPC pair, brokered through preload like every privileged call:**
   `theme:get` (current preference + resolved dark/light) and
   `theme:set(preference)`. The renderer never touches `nativeTheme`; a
   renderer-supplied *value* is validated in main against the three-member
   union, the same posture as `export:save` deciding the bytes but main
   deciding the dialog.
5. **The viewport re-tints from a palette, not from constants.** The four
   hex constants become one `viewportPalette(dark: boolean)` function in the
   viewport module, and the island subscribes to
   `matchMedia('(prefers-color-scheme: dark)')`, re-applying background,
   material and wireframe colors on change. three.js stays inside the
   viewport (ADR-0008); the palette derives from the same hex values as the
   CSS tokens and says so in a comment beside each, since a stylesheet and a
   WebGL scene cannot share a variable. PNG capture therefore follows the
   theme — a light-theme export has a white background, which is the better
   default for a quote.
6. **The control lives in the header status area** (ADR-0021's app-scope
   row): a compact three-option select, `System · Light · Dark`. It fits the
   header's fixed height with no growth, and a select shows all three states
   — a cycling button would hide "system" behind a label that reads as an
   action. It sits left of the status chips, which keep their right-anchored
   layout and truncation rules.
7. **Light palette.** Tokens re-picked for the light side rather than
   inverted: text and muted must meet WCAG AA on `--panel`; `--warn` and
   `--error` are re-chosen because the dark-side amber and salmon lose
   contrast on white. The accent stays recognisably the same blue so the
   segmented controls read as one product across themes.

## Consequences

- Two e2e specs, both by relationship: (a) pinning `dark` or `light`
  survives a restart *and* the window's `backgroundColor` matches the resolved
  `--bg` at creation (the flash guard — checked through `app.evaluate` before
  the page paints); (b) the viewport's clear color equals the stylesheet's
  resolved `--bg` after a theme switch, so deleting the viewport listener
  fails exactly one spec. `system` cannot be driven end-to-end (no OS theme
  in CI); its e2e asserts `themeSource === 'system'` and that the renderer's
  resolved scheme matches `nativeTheme.shouldUseDarkColors`.
- The window-state file gains a non-geometry field. `readWindowState`'s
  field-by-field fallback covers a file written by an older build (no field →
  `system`) and by a newer one (unknown value → `system`).
- The e2e harness's per-launch temp profile (item 11's isolation fix) means
  no spec inherits another's theme.
- Roadmap item 9's "translucent carton walls — WON'T DO" was argued on the
  dark theme ("can only tint toward slightly-lighter grey"). A light theme
  weakens that argument but does not reopen the decision: dense cartons were
  pixel-identical for a reason unrelated to theme.
- CHANGELOG: one entry (the theme), noting the PNG background change.

## Alternatives considered

- **Renderer-only: `data-theme` attribute + a localStorage key.** Simplest
  to write, and it is how a web page does it. Rejected because main needs
  the theme before the window exists (the flash), native dialogs would not
  follow, and it would be a second theme mechanism beside the
  `prefers-color-scheme` one the `system` mode needs anyway.
- **`nativeTheme` without persistence.** Resets every launch; a preference
  that has to be re-chosen is a bug report.
- **Theme in `settings`.** Presets and "Restore inputs" would carry it —
  wrong home (see Context).
- **Theme in SQLite.** Needed before the lazily-opened database exists, and
  storage is allowed to fail while theme restore should not care — ADR-0014's
  argument verbatim.
- **CSS `light-dark()`.** A fine implementation detail for the token
  definitions and may be used; it does not change the decision, since the
  viewport still needs the palette function and main still needs the source.
- **A menu item (View → Theme).** The native menu is auto-hidden
  (`autoHideMenuBar`), so it would be the least discoverable control in the
  app.

## Revisit triggers

- A request for high-contrast or a custom palette: promote `viewportPalette`
  and the token sets to a named-theme table rather than a boolean.
- Per-kind part coloring in the packed view: it would want the same palette
  module, and light/dark variants of each hue.
- If `nativeTheme.themeSource` ever stops driving `prefers-color-scheme` in
  a future Electron, the renderer needs the `data-theme` attribute after
  all; the e2e in Consequences (b) is what would notice.
