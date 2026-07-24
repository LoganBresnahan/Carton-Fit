# Packaging Estimator — Vision

## Problem

Given a 3D model of a part (or an assembly of parts) and a shipping carton, answer the
questions packaging engineers actually ask: **does it fit, in what orientation, and how
many can I ship per box** — without doing the math by hand or mocking it up physically.

## What it is

A cross-platform desktop application (Windows-first; macOS and Linux supported) with a
normal download-and-install experience. The user drags a CAD file onto the app, enters
the carton's dimensions and constraints, and gets an answer plus a 3D visualization of
the packed carton.

## Inputs

| Input | Details |
|---|---|
| 3D model | Drag-and-drop `.stp`/`.step` (required; may contain multiple parts). `.stl` supported as a bonus. More formats later. |
| Box dimensions | **Inside** dimensions by default; optional **wall thickness** field so outside dimensions can be entered instead. |
| Units | mm ⇄ inches toggle (weights in kg ⇄ lb correspondingly). |
| Clearances | Part-to-part and part-to-wall padding (dunnage/foam allowance). |
| Max package weight | User-settable, **default 35 lb**. |
| Part weight | Entered directly per part, **or** derived from a material/density selection using the mesh volume computed from the model. |

## Modes (user-selectable)

1. **Fit check** *(default)* — "Do all the parts in this file fit in this box?"
   Verdict, arrangement, total weight vs. the limit.
2. **Max quantity** — "How many copies of this part (or of the whole file treated as one
   unit) fit in this box?" Count is capped by both geometry and the weight limit,
   and the result says which constraint bound it.

## Packing quality tiers (selectable in the UI from day one)

1. **Fast** — axis-aligned bounding box, 6 orientations, grid/greedy placement. Instant.
2. **Thorough** — minimal oriented bounding box + rotation search. Seconds.
3. **True nesting** — pack real geometry so concave parts interlock. Visible in the UI
   but disabled and marked *experimental / coming later*; not part of v1.

## Output

- Fit verdict or max count, and whether geometry or weight was the limiting factor.
- Best orientation per part, volume utilization %, total package weight.
- 3D view: the carton (wireframe + translucent walls) with parts placed in their
  computed positions and orientations; toggle between model view and packed view.
- **Saved configurations & history**: box/constraint setups can be saved as named
  configurations and reloaded; every estimate is recorded (file, settings, result) as
  a queryable history.

## Non-goals for v1

- True shape nesting (tier 3) — designed for, not implemented.
- Mixing *different* parts to optimize a single carton's contents (fit check handles the
  parts a file contains; it does not search combinations).
- Pallet/stack planning, box selection/recommendation, cost estimation — all future.

## Technical direction

Electron + TypeScript + React with one Zustand store (lean-dependency rule: adding a
runtime dep requires an ADR), three.js viewport, `occt-import-js` (OpenCascade WASM)
for STEP parsing in a web worker, packing math in a worker, `better-sqlite3` in the
main process for configurations/history, `electron-builder` for installers (Windows
NSIS primary). Renderer code is plain web tech so the shell could move to Tauri later
without rewriting the app.
