# Roadmap

Frontier = first unchecked item under **Now**, else first under **Next**.
Check items off as they ship; pin carry-ins (deferred sub-tasks, open questions) to the
item they belong to. Product intent lives in `VISION.md`; decisions in `adr/`.

## Now

- [x] 0. Repo setup — vision doc, ADRs 0001–0004, CLAUDE.md, skills, this roadmap
- [ ] 1. Scaffold — electron-vite (React + TS) app boots; drag-drop reads a file and
      shows its name/size; `npm run dev` / `npm test` / typecheck all work
- [ ] 2. Import + view — STEP parsing via occt-import-js in a worker; parts listed;
      parts rendered in three.js with orbit controls; STL path too
- [ ] 3. Inputs panel — box dims (inner, or outer + wall thickness), mm ⇄ in toggle,
      clearances, max weight (default 35 lb), part weight (direct or density × volume),
      mode + quality selectors; values persisted (localStorage)
- [ ] 4. Fast engine + results — tier-1 packing in a worker; results panel (verdict /
      count / binding constraint / utilization); packed 3D view; vitest coverage for
      grid math, unit conversions, weight cap
- [ ] 5. Thorough engine — minimal OBB + rotation search; quality selector fully
      wired; nesting tier visible but disabled
- [ ] 6. E2E harness + golden samples — Playwright `_electron.launch()` specs in
      `e2e/`; `samples/` golden parts with hand-computed expected results shared by
      unit, e2e, and dogfood layers (ADR-0005); DropZone keeps the picker path e2e
      depends on

## Next

- [ ] 7. Persistence — better-sqlite3 in the main process behind IPC (ADR-0007):
      `configurations` (named presets) + `estimates` (history); save/load UI;
      migrations via `PRAGMA user_version`; open-with-recovery
- [ ] 8. Installers + /deploy live — electron-builder: Windows NSIS (primary) +
      linux-unpacked smoke target; `/deploy` skill runs end-to-end (packaged smoke,
      dist-live staging, dogfood handoff); mac build documented
- [ ] 9. Polish — error states (unparseable file, open mesh volume warning), app icon,
      window state persistence

## Later

- More import formats (OBJ, IGES — near-free via occt-import-js)
- Tier-3 true nesting (experimental; see ADR-0003 revisit triggers)
- Box tare weight; material density library (ADR-0004 revisit triggers)
- Auto-update via electron-updater
