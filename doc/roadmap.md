# Roadmap

Frontier = first unchecked item under **Now**, else first under **Next**.
Check items off as they ship; pin carry-ins (deferred sub-tasks, open questions) to the
item they belong to. Product intent lives in `VISION.md`; decisions in `adr/`.

## Now

- [x] 0. Repo setup — vision doc, ADRs 0001–0004, CLAUDE.md, skills, this roadmap
- [x] 1. Scaffold — electron-vite (React + TS) app boots; drag-drop reads a file and
      shows its name/size; `npm run dev` / `npm test` / typecheck all work
- [x] 2. Import + view — STEP parsing via occt-import-js in a worker; parts listed;
      parts rendered in three.js with orbit controls; STL path too
      (ADR-0002 import pipeline + ADR-0008 imperative-three viewport)
- [x] 3. Inputs panel — box dims (inner, or outer + wall thickness), mm ⇄ in toggle,
      clearances, max weight (default 35 lb), part weight (direct or density × volume),
      mode + quality selectors; values persisted (localStorage)
      (ADR-0003 contract + fast engines + selectors; ADR-0004 input fields)
- [x] 4. Fast engine + results — tier-1 packing in a worker; results panel (verdict /
      count / binding constraint / utilization); packed 3D view; vitest coverage for
      grid math, unit conversions, weight cap
      (ADR-0003 phase 5 engine + worker; ADR-0009 auto-run. Estimates follow the
      inputs — no compute button; results pinned as a panel footer; packed view
      instanced per part; max-quantity unit picker. Dogfooding through the real UI
      caught a unit-conversion off-by-one in the weight cap — 5 lb / 0.01 lb
      reported 499 — now floored tolerantly and pinned by test.)
- [x] 5. Thorough engine — minimal OBB + rotation search; quality selector fully
      wired; nesting tier visible but disabled
      (ADR-0003 phases 3–4. The tier selector now runs end-to-end: switching to
      Thorough re-packs through the OBB provider and renders the composed
      rotations. Nesting stays visible-but-disabled from phase 2.)
- [x] 6. E2E harness + golden samples — Playwright `_electron.launch()` specs in
      `e2e/`; `samples/` golden parts with hand-computed expected results shared by
      unit, e2e, and dogfood layers (ADR-0005); DropZone keeps the picker path e2e
      depends on
      (16 specs: `smoke.spec.ts` is the deploy gate — boot, both import paths, and
      one test per hand-computed golden in `samples/goldens.ts`; `packing-ui.spec.ts`
      covers auto-run, truncated layouts, unplaced parts, the unit picker, the view
      toggle, persistence, and unit conversion. Green against BOTH `out/` and the
      packaged `linux-unpacked` binary. Written CI-ready: no fixed-size display
      assumed, SwiftShader confined to `e2e/harness.ts`. `xvfb` remains the one
      unmet CI prerequisite.)

## Next

- [ ] 7. Persistence — better-sqlite3 in the main process behind IPC (ADR-0007):
      `configurations` (named presets) + `estimates` (history); save/load UI;
      migrations via `PRAGMA user_version`; open-with-recovery
- [x] 8. Installers + /deploy live — electron-builder: Windows NSIS (primary) +
      linux-unpacked smoke target; `/deploy` skill runs end-to-end (packaged smoke,
      dist-live staging, dogfood handoff); mac build documented
      (`/deploy` runs end-to-end and shipped its first build at 1ccc1fc: 143 MB
      Windows zip + linux-unpacked smoke target from one build, 16/16 e2e green
      against the PACKAGED binary, staged to `dist-live/` with rollback.)
      — carry-in **resolved by item 10**: the NSIS `Setup.exe` now exists, built
      natively on `windows-latest` (102 MB, first produced 2026-07-25 for
      `v0.1.0`). It is still unsigned, so SmartScreen warns on first run; code
      signing is the open piece, deferred until a certificate exists.
      — carry-in: **mac dmg still undocumented and unbuilt.** ADR-0012 declines a
      macOS runner on purpose — a dmg nobody can dogfood is an untested artifact
      wearing a ship label. Revisit when a Mac is available.
- [ ] 9. Polish — error states (unparseable file, open mesh volume warning), app icon,
      window state persistence
      — carry-in: translucent carton walls (VISION says "wireframe + translucent
      walls"; item 4 shipped the wireframe only, which reads clearly against a
      dense pack — revisit when adding depth cues)
      — carry-in: **the installer ships the 7.3 MB OCCT wasm twice.**
      `electron-builder.yml`'s comment claims the narrow `files` list means
      "nothing from node_modules at runtime", but electron-builder includes
      production deps regardless, so `app.asar` carries both the vite-emitted
      asset (the live one) and `node_modules/occt-import-js/dist/`. Excluding it
      would cut ~7 MB — but that copy also carries the LGPL text ADR-0011's
      notices cite, so the exclusion must keep `LICENSE.md`/`license.occt.txt`.
      Not urgent; the comment is wrong today either way.
- [x] 10. CI + GitHub releases — **owns the Windows `Setup.exe`** (ADR-0010). A GitHub
      Actions matrix builds each platform on its own runner: `windows-latest` produces
      the NSIS installer natively (no wine) and compiles native modules with MSVC when
      no prebuild matches, which also de-risks item 7. Publish installers as release
      artifacts on tag; `/deploy` then fetches the CI artifact for a sha instead of
      building it. Prerequisites already known: the runner needs **`xvfb`** (no WSLg
      there) plus the SwiftShader flags already in `e2e/harness.ts`; vitest and
      typecheck need nothing special. Reuse `/deploy`'s staging semantics rather than
      duplicating them.
      (Shipped 2026-07-25 as ADR-0012, five plan phases. `ci.yml` verifies every
      push — typecheck, vitest, packaged e2e under `xvfb` — and `release.yml`
      builds the `Setup.exe` natively on `windows-latest`, self-verifies there,
      builds the Linux AppImage, and attaches both to a **draft** release; a
      human publishes. The version gate and the draft-only rule were each proved
      by exercising their negative path, not by reading the YAML. Windows found
      a real harness bug on its first run — `ELECTRON_RUN_AS_NODE: ''` selects
      node mode there, because Electron tests presence, not truthiness. `/deploy`
      now fetches the CI artifact for a sha instead of building.)
      — carry-in **discharged**: both ADR-0011 checks now run on the Windows
      build every release, and both were verified capable of failing.
      `scripts/check-asar-integrity-fuse.mjs --self-test` mutates the fuse and
      requires the checker to notice; `e2e-compliance/` mutation-tests the LGPL
      substitution spec. Result: electron-builder *embeds* integrity hashes on
      Windows but Electron does not *enforce* them, so the relink guarantee
      holds on the ship platform.
      — carry-in: **code signing.** The `Setup.exe` is unsigned, so SmartScreen
      warns. ADR-0010 says certificates belong on this same runner; revisit how
      they are held before adding it.

## Later

- More import formats (OBJ, IGES — near-free via occt-import-js)
- Tier-3 true nesting (experimental; see ADR-0003 revisit triggers)
- Box tare weight; material density library (ADR-0004 revisit triggers)
- Auto-update via electron-updater
