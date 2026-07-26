# ADR-0007: Storage — better-sqlite3 in the main process, reference-app patterns

Date: 2026-07-24
Status: Accepted

## Context

The app must save named configurations (box dims, wall thickness, clearances, max
weight, mode/quality) and keep a queryable history of past estimates. The maintainer's
reference app (`~/oof/deepseek-vscode-extension`) provides field-tested guidance:

- It **started on sql.js (WASM SQLite) and migrated away** — its
  `docs/plans/completed/db-change.md` documents the pain: whole-DB-in-WASM-memory
  (2.5–3× DB size, 4–5× during saves), manual save-to-disk plumbing, and an async-init
  chain existing solely to locate the WASM file in a bundled app. That post-mortem
  rules sql.js out here.
- It landed on a **prebuilt N-API SQLite addon** (`@signalapp/sqlcipher`, the Signal
  Desktop pattern) with a small, proven integration surface: bundler-external the
  native module, `PRAGMA user_version` migrations in one `migrations.ts`, WAL +
  `busy_timeout` + `foreign_keys` at open, open-with-recovery that quarantines corrupt
  DB files.

Encryption is not needed here (packing configurations are not secrets), so SQLCipher
itself is out; the maintainer wants plain SQLite.

## Decision

Use **better-sqlite3** — the plain-SQLite package whose API the reference app's own
wrapper was explicitly designed to mimic — and port the reference patterns:

- DB lives in the **main process** (`src/main/db/`), at `app.getPath('userData')/
  carton-fit.db`; the renderer talks to it over IPC. `core/` stays pure.
- Open sequence: `journal_mode = WAL`, `busy_timeout = 5000`, `foreign_keys = ON`,
  with open-with-recovery (quarantine a corrupt file and recreate rather than crash).
- Schema versioned via `PRAGMA user_version`; one `migrations.ts` is the single source
  of truth; prepared statements owned by their store classes.
- v1 schema: `configurations` (named presets) and `estimates` (file name + content
  hash, settings snapshot, result JSON, timestamp).
- The native module is externalized in the electron-vite config (the reference's
  webpack-externals line, translated); electron-builder fetches the platform prebuilt
  (win32-x64 included) at package time — no MSVC toolchain in WSL.

## Consequences

- Synchronous, fast, battle-tested SQL with zero WASM/memory overhead; no async init.
- We adopt a native module: the ABI is pinned to the Electron version. Prebuilds make
  this routine, but we **don't chase new Electron majors** until better-sqlite3
  prebuilds exist for them (checking this is part of any Electron upgrade).
  - **Amended by ADR-0010 (2026-07-25), then SUPERSEDED by ADR-0013 (same day).**
    ADR-0010 said to pin a version that ships prebuilds — naming v12.12.0. Building
    it proved that version **is not on npm at all** (GitHub release only); the
    highest npm 12.x is 12.11.1, whose prebuilds stop at ABI 146 while Electron 43
    needs **148**. No npm-installable version has a prebuild for us. **ADR-0013 is
    the live decision: compile from source** (`npmRebuild: true`), pin 12.11.1 only
    for its *Node*-ABI prebuild (fast `npm ci`), and let CI's Windows runner build
    with MSVC. Read ADR-0013 before touching the storage dependency.
- No wrapper layer: no legacy call sites to preserve, so better-sqlite3's API is used
  directly.

## Alternatives considered

- **sql.js (WASM)** — rejected on the reference app's documented post-mortem.
- **Plain JSON files** — zero-dep and fine for presets alone, but no querying for
  history, and the reference shows the SQLite pattern's real cost is low.
- **@signalapp/sqlcipher** — proven, but encryption is machinery without a requirement.
- **`node:sqlite` (Node built-in)** — the zero-dependency endgame, but availability is
  gated on the Node version inside Electron; not dependable today.

## Revisit triggers

- An Electron upgrade whose ABI has no better-sqlite3 prebuilds yet → wait or pin.
- `node:sqlite` becomes stable in our Electron's Node → consider dropping the native
  dep entirely (re-evaluate this ADR).
- Estimate history grows features (search, tags, sync) → schema grows via
  `migrations.ts`, not ad-hoc DDL.
