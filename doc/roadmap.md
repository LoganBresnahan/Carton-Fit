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
- [ ] 6. E2E harness + golden samples — Playwright `_electron.launch()` specs in
      `e2e/`; `samples/` golden parts with hand-computed expected results shared by
      unit, e2e, and dogfood layers (ADR-0005); DropZone keeps the picker path e2e
      depends on
      — carry-in: **write the specs CI-ready** (ADR-0005 display consequences).
      Locally WSLg supplies the display; a GitHub runner will not, and `xvfb` is not
      installed anywhere yet — so specs must not assume a fixed-size display, and the
      SwiftShader flags must live in the harness config, never in app code. Goldens
      already hand-computed and verified against the production build during item 4:
      cube-10x10 → 30³ = 27,000 @ 95% fill in a 12 in box, 7³ = 343 @ 78% in 3 in;
      AS1 → 18 parts fit; 5 lb cap with 0.01 lb parts → exactly 500, weight-bound.

## Next

- [ ] 7. Persistence — better-sqlite3 in the main process behind IPC (ADR-0007):
      `configurations` (named presets) + `estimates` (history); save/load UI;
      migrations via `PRAGMA user_version`; open-with-recovery
- [ ] 8. Installers + /deploy live — electron-builder: Windows NSIS (primary) +
      linux-unpacked smoke target; `/deploy` skill runs end-to-end (packaged smoke,
      dist-live staging, dogfood handoff); mac build documented
- [ ] 9. Polish — error states (unparseable file, open mesh volume warning), app icon,
      window state persistence
      — carry-in: translucent carton walls (VISION says "wireframe + translucent
      walls"; item 4 shipped the wireframe only, which reads clearly against a
      dense pack — revisit when adding depth cues)

## Later

- **CI + GitHub releases** — run the three ADR-0005 layers on GitHub Actions and publish
  the Windows `Setup.exe` as a release artifact on tag. Known prerequisites, so the
  design work is already done: the runner needs **`xvfb`** (no WSLg there) plus the
  SwiftShader flags for Electron e2e; `vitest` and `typecheck` need nothing special.
  Pairs with item 8 — once installers build reproducibly, the release step is a tag
  trigger over the same command. Wire `/deploy`'s staging semantics to it rather than
  duplicating them. (ADR-0005 revisit trigger: "CI lands → wire the same three layers
  there; deploy grows a tag/release step.")
- More import formats (OBJ, IGES — near-free via occt-import-js)
- Tier-3 true nesting (experimental; see ADR-0003 revisit triggers)
- Box tare weight; material density library (ADR-0004 revisit triggers)
- Auto-update via electron-updater
