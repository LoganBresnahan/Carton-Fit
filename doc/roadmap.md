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

- [x] 7. Persistence — better-sqlite3 in the main process behind IPC (ADR-0007):
      `configurations` (named presets) + `estimates` (history); save/load UI;
      migrations via `PRAGMA user_version`; open-with-recovery
      (ADR-0007 shipped in six plan phases. **ADR-0013 supersedes its prebuild
      assumption**: the pinned version both ADRs named is not on npm and no npm
      release has an Electron-ABI-148 prebuild, so better-sqlite3 is compiled
      from source — `npmRebuild` + `buildDependenciesFromSource`, with Windows
      compiling under MSVC in CI. Packaging hid three separate silent failures
      that each shipped an unloadable module; `e2e/native-module.spec.ts` now
      guards them. The DB tests caught a data-loss bug where a database written
      by a newer build was quarantined instead of refused. Save/load UI plus
      auto-recorded history, keyed on a SHA-256 content hash so history survives
      a rename.)
      — carry-in **resolved by ADR-0016** (see item 11): history volume under
      auto-run. Implemented literally on purpose at ship time; the answer turned
      out to be explicit save, not the collapse-consecutive-rows guess this
      carry-in originally recorded.
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
- [x] 9. Polish — error states, app icon, window state persistence (ADR-0014)
      (All six slices shipped 2026-07-25; README.md written at close, with the
      recovered icon as its hero.)
      Scoped 2026-07-25 against what actually exists:
      - [x] **open-mesh volume warning** — shipped as **ADR-0015** (flag an
        unmeasurable input, do not refuse the estimate). `isClosedMesh` had been
        written and tested in item 2 but never called, so density mode over an
        open mesh reported a wrong weight silently — and weight is a hard
        constraint, so it became a wrong part count stated with full confidence.
        `openMeshParts` now gates it, scoped to the parts actually packed and
        skipped outside density mode; the results panel qualifies the whole
        answer, not just the weight line. New golden `cube-10x10-open.stl` (the
        cube minus its +z face: perfect 10 mm bbox, 666.67 mm³ instead of 1000 —
        33% light) pins it at the unit, golden, and e2e layers, and the e2e was
        mutation-tested to prove it can fail. Last known silent-wrong-answer
        path in the product, now closed.
      - unparseable-file errors and pack failures are ALREADY surfaced
        (`ImportResult`, `ResultsPanel`) — the item text was stale.
      - [x] **`storageError` visible outside the configurations panel** —
        `StorageBanner` is pinned above the scroll region, so it shows whether or
        not that panel is on screen; the panel's own copy is gone, leaving one
        canonical place. Two things surfaced while doing it: **history failures
        only ever reached `console.warn`**, so VISION's "every estimate is
        recorded" could silently stop being true, and the banner text leaked
        Electron's IPC wrapper (`Error invoking remote method '…': Error: …`)
        over the sentence actually written for the user — `storageMessage`
        strips it. Reported on every failure rather than once, because
        `setConfigurations` clears `storageError` on any success and a
        report-once warning could be erased while still true. E2E breaks storage
        the way a real downgrade does (stamping `user_version` 999 straight into
        the SQLite header, since better-sqlite3 in the test process has the wrong
        ABI) and asserts the banner stays in view at both scroll extremes;
        mutation-tested.
      - [x] app icon — wired in `electron-builder.yml`, verified by extracting
        the icon resources back out of the packaged `.exe` (7 sizes, 16→256).
        The source art needed real work first: it was **not transparent** (the
        checkerboard was painted into the image), carried a generator watermark,
        and filled only 63% of its canvas. See `build/ICON.md`; the unprocessed
        art is kept as `build/icon-source.png`.
      - [x] window state persistence per ADR-0014 (JSON in userData, NOT SQLite
        — bounds are needed before the lazily-opened database exists). Size,
        position and maximized survive a restart; bounds are validated against
        the displays attached RIGHT NOW, so a position on an unplugged monitor
        is dropped rather than opening the window somewhere unreachable. A
        corrupt or hand-edited file falls back to defaults field by field.
        Implementing it surfaced a real bug that "does it restore?" would never
        have caught: the window crept +6,+27 EVERY launch on WSLg, because the
        reported position includes the window frame but the constructor's does
        not — twenty launches walked it off the screen. See ADR-0014's
        consequences; the e2e guard is three launches, mutation-tested.
      — carry-in **closed as WON'T DO** (2026-07-25): translucent carton walls.
      Prototyped and screenshotted before deciding, both sparse (one 10 mm cube
      in a 12 in carton) and dense (343 cubes in a 3 in carton). Dense is
      pixel-identical — the parts occlude every wall. Sparse gains a tint so
      faint it takes flipping between the two images to see. The technique is
      fighting the dark theme: a translucent wall can only tint toward
      slightly-lighter grey, and the opacity needed to read clearly is the
      opacity that hazes the parts behind it. Depth already comes from the
      shaded parts, not the container. VISION amended to say wireframe, so this
      stops reading as unfinished work.
      - [x] **the installer shipped the 7.6 MB OCCT wasm twice** — fixed, and it
        was the smaller half of the problem. electron-builder includes
        production deps whatever the `files` list says, so the app carried all
        12 MB of occt-import-js (duplicate wasm, C++ sources, 3.9 MB of tests)
        AND all 28 MB of better-sqlite3 (the sqlite3 amalgamation, plus 15 MB of
        compiler object files), against 54 KB and 2.2 MB actually used at
        runtime. Exclusions are written as removals, never an allow-list,
        because the pruned copy carries the LGPL texts ADR-0011's notices cite
        by name — an over-broad exclude here is a licence violation, not a size
        win. **MEASURED: install footprint 62 MB → 35 MB; the Windows zip only
        141.7 MB from 149.3 MB, because C++ sources compress to nearly nothing
        while the wasm is incompressible** — so the download win really is just
        the duplicate wasm, and the other 20 MB is disk after install. Verified
        by the full packaged e2e (30/30, STEP import and storage both exercise
        the pruned tree) and both ADR-0011 compliance checks.
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

- [x] 11. Saved estimates + input undo — **ADR-0016**, shipped 2026-07-25.
      History records on EXPLICIT save, not auto-run: the placeholder "collapse
      consecutive rows" answered the wrong question — dedup removes repetition,
      not noise, and nothing marked which row the user meant.
      - Save-estimate action in the results header (`storage/estimates.ts`),
        disabled while a re-pack is in flight so a superseded answer cannot be
        filed. `renderer/storage/history.ts` and its exactly-once machinery
        deleted; the auto-record e2e rewritten to assert the opposite, plus a
        regression spec proving three carton edits add NOTHING to history.
        Same row shape, same IPC, no schema change, no migration.
      - `SavedEstimatesPanel`: browsable list with one-line summaries
        ("500 fit · 12×12×12 in · weight-limited"). `packing/summary.ts` is
        defensive by design — rows are JSON written by older builds, so a
        missing or wrong-typed field degrades the sentence instead of throwing.
        Restore loads SETTINGS only; the e2e proves the result is recomputed
        (27,000 → 343 → restore → 27,000), never replayed.
      - Undo/redo (`history/undo.ts`): bounded in-memory stack, coalescing keyed
        on a change signature that names the changed ARRAY INDEX, so typing
        "125" into one dimension is one step but length-then-width is two. The
        keyboard binding is split from the tracking so the subtle half unit-tests
        without a DOM. Ctrl+Z inside a text field is left to the browser.
      - Vocabulary split: **Presets** ("reusable carton setups — no part
        attached") vs **Saved estimates**.
      — carry-in: export stays OUT (ADR-0016 §4). Copy-summary + packed-view PNG
      are cheap schema-free conveniences; CSV/PDF wait for a real dogfooding
      request.
      — **dogfood finding (2026-07-25), fixed**: both lists were written with
      `className="panel"` — the LEFT COLUMN's own class, carrying `width: 360px`
      and a `border-right`. Nested inside that same 360px column, which already
      spends 1.5rem on padding, they overhung both edges by ~24px and put a
      horizontal scrollbar on the inputs column. Every functional spec passed
      throughout — the controls were present, clickable and correct, just 24px
      into the margin. Now `.panel-section` (full width, `.inputs` spacing, and
      its `h2` folded into the same uppercase-label rule as CARTON and
      CLEARANCES). `e2e/panel-layout.spec.ts` guards it by RELATIONSHIP rather
      than pixel value — the column must not scroll sideways, and sections in
      one column share one left edge — and was mutation-tested by restoring the
      old class.
      — **e2e isolation bug found and fixed here**: window persistence (ADR-0014)
      had made the suite stateful, and a dogfooded maximized-on-second-monitor
      window made the packaged run take 12.2 minutes instead of 53 s WITH
      NOTHING FAILING. `launchApp` now gives every launch its own temp profile.

## Later

- More import formats (OBJ, IGES — near-free via occt-import-js)
- Tier-3 true nesting (experimental; see ADR-0003 revisit triggers)
- Box tare weight; material density library (ADR-0004 revisit triggers)
- Auto-update via electron-updater
