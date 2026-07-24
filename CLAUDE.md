# Packaging Estimator

Desktop app: drag-and-drop a STEP file, enter carton dimensions and constraints, get the
best packing orientation, part count, and a 3D visualization of the packed box.

**`doc/VISION.md` is the source of truth for product intent** — inputs, modes, quality
tiers, and non-goals. Read it before making product-level decisions, and keep it updated
when scope changes.

## Stack

- Electron + TypeScript + React (electron-vite layout: `src/main`, `src/preload`, `src/renderer`)
- three.js for the 3D viewport
- `occt-import-js` (OpenCascade WASM) for STEP parsing — runs in a web worker, never on the UI thread
- Packing/geometry math: pure TypeScript in `src/renderer/src/core/`, executed in a worker; unit-tested with vitest
- `electron-builder` for installers — Windows NSIS is the primary target (cross-built from WSL), plus dmg and AppImage

## Conventions

- Documentation lives in `doc/`.
- Internal canonical units are **millimeters and grams**; conversion to inches/lb happens
  only at the UI boundary (`core/units.ts`).
- Packing algorithms are pure functions (no DOM, no three.js imports) so they stay
  testable and worker-friendly.
- Weight limit and geometric fit are both hard constraints; results must state which one
  was binding.

## Commands

Scaffold not yet generated. Once it is: `npm run dev` (develop), `npm test` (vitest),
`npm run build:win` (NSIS installer). Update this section when the scaffold lands.
