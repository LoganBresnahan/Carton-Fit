# Packaging Estimator

Desktop app: drag-and-drop a STEP file, enter carton dimensions and constraints, get the
best packing orientation, part count, and a 3D visualization of the packed box.

**`doc/VISION.md` is the source of truth for product intent** — inputs, modes, quality
tiers, and non-goals. Read it before making product-level decisions, and keep it updated
when scope changes.

## Stack

- Electron + TypeScript + React (electron-vite layout: `src/main`, `src/preload`, `src/renderer`)
- One Zustand store is the renderer's data spine; components are declarative islands
  subscribing to slices (ADR-0006). **Adding any runtime dependency requires an ADR** —
  the complete runtime list is react, react-dom, zustand, three, occt-import-js,
  better-sqlite3.
- three.js for the 3D viewport
- `occt-import-js` (OpenCascade WASM) for STEP parsing — runs in a web worker, never on the UI thread
- Packing/geometry math: pure TypeScript in `src/renderer/src/core/`, executed in a worker; unit-tested with vitest
- `better-sqlite3` (main process only, behind IPC) for configurations + estimate history
  (ADR-0007): `PRAGMA user_version` migrations in one `migrations.ts`, WAL, open-with-recovery
- `electron-builder` for installers — Windows NSIS is the primary target (cross-built from WSL), plus dmg and AppImage

## Conventions

- Documentation lives in `doc/`. `doc/roadmap.md` tracks build order (frontier = first
  unchecked item); check items off as they ship.
- **Every decision gets an ADR** in `doc/adr/NNNN-slug.md` (Nygard style: Context /
  Decision / Consequences / Alternatives / Revisit triggers). New dependency, changed
  algorithm or contract, pattern adopted or rejected — that's a decision. Implementation
  detail is not. Supersede rather than rewrite.
- Internal canonical units are **millimeters and grams**; conversion to inches/lb happens
  only at the UI boundary (`core/units.ts`).
- Packing algorithms are pure functions (no DOM, no three.js imports) so they stay
  testable and worker-friendly.
- Weight limit and geometric fit are both hard constraints; results must state which one
  was binding.
- Test pyramid (ADR-0005): vitest for `core/` math, Playwright-Electron e2e in `e2e/`,
  dogfooding on real parts after every deploy. Golden fixtures (committed sample parts
  with hand-computed expected results) live in `samples/` and are shared by all three.

## Skills & workflows

- `/orient` — session-start bearing: commits + roadmap + docs reconciled against memory. Read-only.
- `/shipshape` — pre-commit verification: tests green twice, docs current, conventions hold.
- `/deploy` — build installers, Playwright-smoke the *packaged* build against `samples/`
  goldens, stage to `dist-live/` (previous kept for rollback), hand off for dogfooding.
- `adr-plan` workflow (`.claude/workflows/adr-plan.js`) — decompose an accepted ADR into
  an effort-ranked, dependency-ordered build checklist before implementing it.

## Commands

Scaffold not yet generated. Once it is: `npm run dev` (develop), `npm test` (vitest),
`npm run build:win` (NSIS installer). Update this section when the scaffold lands.
