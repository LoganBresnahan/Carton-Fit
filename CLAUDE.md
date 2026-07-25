# Packaging Estimator

Desktop app: drag-and-drop a STEP file, enter carton dimensions and constraints, get the
best packing orientation, part count, and a 3D visualization of the packed box.

**`doc/VISION.md` is the source of truth for product intent** — inputs, modes, quality
tiers, and non-goals. Read it before making product-level decisions, and keep it updated
when scope changes.

## Stack

- Electron + TypeScript + React (electron-vite layout: `src/main`, `src/preload`, `src/renderer`)
- One Zustand store is the renderer's data spine; components are declarative islands
  subscribing to slices (ADR-0006). **Adding any runtime dependency requires an ADR**
  *and* a line in `THIRD-PARTY-NOTICES.md` (ADR-0011 — that file ships inside the
  app, so an omission is a licence violation, not a doc gap). The complete runtime
  list is react, react-dom, zustand, three, occt-import-js, better-sqlite3.
- The project is **MIT** (`LICENSE`). `occt-import-js` is **LGPL-2.1**, which is why
  `asarUnpack` in `electron-builder.yml` keeps the OCCT `.wasm` outside `app.asar`:
  it makes the LGPL's replace-the-library right real. That setting is compliance,
  not optimization — see ADR-0011 before touching it.
- three.js for the 3D viewport
- `occt-import-js` (OpenCascade WASM) for STEP parsing — runs in a web worker, never on the UI thread
- Packing/geometry math: pure TypeScript in `src/renderer/src/core/`, executed in a worker; unit-tested with vitest
- `better-sqlite3` (main process only, behind IPC) for configurations + estimate history
  (ADR-0007): `PRAGMA user_version` migrations in one `migrations.ts`, WAL, open-with-recovery
- `electron-builder` for installers — Windows NSIS is the primary target, **built on
  `windows-latest` in CI, not cross-built** (ADR-0010/0012), plus a Linux AppImage.
  A dmg waits for a Mac to verify it on.

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

- `npm run dev` — Vite HMR + Electron window. **From a VSCode terminal, unset
  `ELECTRON_RUN_AS_NODE` first** (`env -u ELECTRON_RUN_AS_NODE npm run dev`): VSCode
  exports it, and it makes the Electron binary behave as plain Node — symptoms are a
  bogus `electron --version` (prints the embedded Node version) and electron-vite
  dying with "Error: Electron uninstall".
- `npm test` — vitest (run twice for the ship bar, per `/shipshape`)
- `npm run typecheck` — tsc (covers `src`, `tests`, `e2e`, `samples`)
- `npm run build` — electron-vite production build → `out/`
- `npm run package` — build + `electron-builder --linux dir` → `release/linux-unpacked`
  (the e2e smoke target)
- `npm run e2e` — Playwright-Electron specs against `out/`
- `npm run e2e:packaged` — the same specs against the packaged binary. **This is the
  deploy gate**: dev-mode green does not count (ADR-0005), because packaged builds
  fail in packaged-only ways — `file://` asset paths, WASM loading, workers.
- `PACKAGED_APP=<binary> npm run e2e:compliance` — the ADR-0011 licence checks in
  `e2e-compliance/`. Separate config on purpose: these specs **corrupt the packaged
  build** to prove the LGPL relink guarantee, so they must never join an ordinary
  e2e run. They restore it afterwards.

E2E needs a display and software GL (ADR-0005): WSLg supplies the display locally,
CI uses `xvfb-run`, and the SwiftShader flags live in `e2e/harness.ts` —
harness-only, never in shipped code.

## CI (ADR-0012)

- `.github/workflows/ci.yml` — every push to main and every PR: typecheck, vitest,
  package, then the packaged e2e under `xvfb`. `/shipshape`'s machine half, run on
  a clean machine.
- `.github/workflows/release.yml` — on `v*` tags (and `workflow_dispatch` for
  iteration): builds the Windows `Setup.exe` **natively on `windows-latest`**, runs
  the packaged e2e plus both ADR-0011 compliance checks there, builds the Linux
  AppImage, and attaches everything to a **draft** GitHub release. Publishing is a
  human act after dogfooding — dispatch runs never publish.

**Local builds stay wine-free** (ADR-0010): NSIS builds its uninstaller by
*executing* the installer, so the `nsis` target dies with `spawn wine ENOENT` on
Linux. wine was rejected rather than installed — it fixes one step today and does
nothing for the native modules arriving with ADR-0007. The installer is CI's
output; locally, `--win zip` cross-builds fine and `/deploy` fetches the CI
artifact when one exists for the sha.

Version pins: vite 7 + `@vitejs/plugin-react` 5 — electron-vite 5 doesn't support
vite 8 yet; revisit the pins when it does.
