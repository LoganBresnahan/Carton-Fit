# ADR-0014: Window state persists in a JSON file, not in SQLite

Date: 2026-07-25
Status: Accepted
Relates to: ADR-0007 (storage), ADR-0013 (native module reality)

## Context

Roadmap item 9 wants the window's size and position to survive a restart. The
app already has a persistence mechanism — better-sqlite3 in the main process
(ADR-0007) — so the obvious move is to reuse it via a schema v2 migration and an
`app_state` key-value table.

Two things argue against the obvious move:

- **Window state is needed earlier than storage is ready.** Bounds must be known
  when `BrowserWindow` is constructed, which is the first thing that happens
  after `app.whenReady()`. The database is deliberately opened *lazily* and only
  on first storage IPC (ADR-0007 as implemented) so that a storage failure
  cannot delay or block the window appearing.
- **Storage is allowed to fail; window restore should not care.** ADR-0013 made
  the native module compile-from-source, and one `.node` serves one ABI, so in
  ordinary development the module is frequently unloadable in the very process
  that would need it here. A window that forgets its position whenever the
  database is unhappy is a worse outcome than two persistence mechanisms.

ADR-0007 also scoped SQLite to a specific purpose — "named configurations and a
queryable history of past estimates". Window geometry is neither, and reaching
for the database because it happens to exist is how a storage layer becomes a
junk drawer.

## Decision

Persist window state as **a small JSON file in `app.getPath('userData')`**,
written by the main process.

- Read synchronously before the window is created; on any failure (missing,
  unparseable, wrong shape) fall back to the documented defaults rather than
  throwing. A corrupt geometry file must never stop the app from opening.
- Write on close, debounced against resize/move noise.
- **Validate bounds against the current displays** before applying them. A saved
  position can put the window entirely off-screen: an external monitor that is
  no longer attached, or a resolution change. Restoring blindly makes the app
  appear not to launch at all, which reads as a crash.
- SQLite keeps ADR-0007's scope: configurations and estimate history.

## Consequences

- Two persistence mechanisms in the main process instead of one. That is the
  cost, and it is accepted deliberately: they have different availability
  requirements, and collapsing them would subordinate window restore to a
  subsystem designed to be allowed to fail.
- Window restore keeps working when storage does not — including throughout the
  ABI dance ADR-0013 makes routine in development.
- No schema migration, so item 9 does not touch the database at all.
- The file is trivially inspectable and deletable, which is a real support
  affordance for "the window opens somewhere strange".
- **Persisting geometry made the e2e suite stateful, and that had to be undone
  in the harness.** Most specs launched against the real profile, so once
  window state persisted they inherited whatever the previous run — or the
  developer's own dogfooding — left behind. A session that maximized the window
  onto a second monitor wrote `x: 2566, maximized: true`, and every later launch
  restored it: the window opened on a display nobody was looking at, and
  SwiftShader software-rendered a screen-sized canvas. The suite went from 53 s
  to 12.2 minutes **with nothing failing**. `launchApp` now gives every launch
  its own temp profile unless the caller supplies one. General lesson for this
  codebase: anything newly persisted to `userData` is a new input to every e2e
  spec, and has to be isolated the same way localStorage settings already were.
- **Measured while implementing: a saved position cannot be the reported
  position.** On WSLg, `BrowserWindow` interprets x/y as *excluding* the window
  frame while `getNormalBounds()` reports a position *including* it, so writing
  back what is reported adds the decoration size on every launch — +6,+27 each
  time, walking the window off the screen in about twenty launches. Timing
  cannot fix it: bounds read 0,0 before the window is mapped, then equal the
  requested position, and only later gain the offset — and on Windows they never
  gain it. So the rule is positional rather than temporal — a difference smaller
  than a window frame from the position we *asked* for is treated as the same
  position, and the offset it reveals is then applied to genuine user moves. The
  e2e guard is three launches asserting the third lands exactly where the second
  did, mutation-tested by restoring the naive behaviour.
- If a third piece of small main-process state appears, that is the signal to
  generalize this into a proper settings file rather than adding a third
  mechanism — noted as a revisit trigger rather than built speculatively.

## Alternatives considered

- **SQLite `app_state` table (v2 migration)** — one mechanism, reusing tested
  machinery including migrations and open-with-recovery. Rejected on ordering
  and availability: the database opens lazily *after* the window exists, so
  either the window waits on storage (undoing a deliberate ADR-0007 property) or
  the read happens too late to be used.
- **`electron-store`** — the conventional answer, and it handles atomic writes
  and schema validation. Rejected: it is a new runtime dependency requiring an
  ADR under CLAUDE.md's rule, for perhaps forty lines of code we would otherwise
  write once and never touch.
- **localStorage in the renderer** — where ADR-0004's input settings already
  live. Rejected: the renderer cannot influence the window's initial bounds, and
  by the time it could report them the window has already appeared at the wrong
  size.
- **Don't persist window state** — it is genuinely optional. Rejected because
  the app's whole layout is a wide inputs panel beside a 3D stage, and a user
  who resizes for their monitor expects it to stay resized.

## Revisit triggers

- A third piece of small main-process state wants persisting → generalize to one
  settings file (or reconsider `electron-store`) rather than growing a third
  mechanism.
- Multi-window support arrives → per-window keys, and this file's shape changes.
- `node:sqlite` replaces better-sqlite3 (ADR-0007's standing trigger) → the
  availability argument above weakens, and merging the two may become sensible.
