# ADR-0008: 3D viewport — imperative three.js in a single React island

Date: 2026-07-24
Status: Accepted

## Context

Roadmap item 2's second half needs a 3D viewport: imported parts rendered with orbit
controls, later reused for ADR-0003's packed-box result view. `three` is already in the
sanctioned runtime list (ADR-0006), but *how* the viewport is built is undecided, and
the mainstream alternative — react-three-fiber — would be a new runtime dependency,
which ADR-0006's guard rail makes an ADR-level event by itself.

The scene this app needs is not React-shaped. It has two coarse states, both derived
wholesale from store slices: an import lands → show these parts; a packing result
lands → show this layout. There is no fine-grained per-entity UI state, no
React-driven animation, and the geometry wraps typed-array buffers transferred from
the import worker — a resource whose disposal we treat as an explicit contract
(ADR-0002 protocol), not a framework convenience.

## Decision

Build the viewport as **imperative three.js inside one React island**, structured in
two layers:

- **Pure scene-builders** (`viewport/`): functions that take protocol/store data and
  build or mutate three objects — scene-from-parts, camera framing from AABBs, later
  scene-from-packing-layout. No DOM, no React; unit-tested in vitest the same way
  `viewport/partGeometry.ts` already is (three's data classes run under Node — proven
  in phase 2 of the ADR-0002 plan).
- **One lifecycle component**: owns the canvas, `WebGLRenderer`, `OrbitControls`,
  resize handling, and store subscription; on relevant slice changes it calls the
  scene-builders and explicitly disposes replaced geometries (whose buffers came from
  the worker). Render on demand (controls change / scene swap), not a continuous loop.

`three/examples/jsm` addons (OrbitControls now, STLLoader for the ADR-0002 plan's
`stl-loader-path` slice) are **allowed**: they ship inside the `three` package — no new
dependency — with the caveat that jsm paths are less version-stable than three core;
import them only via dedicated adapter modules so a path change on a three upgrade
touches one file each.

## Consequences

- No new runtime dependency; the ADR-0006 posture (react, react-dom, zustand, three,
  occt-import-js, better-sqlite3) holds.
- Renderer lifecycle, resize, and disposal are hand-managed. Mitigation is the
  two-layer structure above: the component stays lifecycle-only; anything with logic
  lives in pure, testable scene-builders. A viewport component accumulating scene
  logic is the smell that this ADR is being violated.
- Buffer ownership stays explicit end-to-end: transferred from the worker (ADR-0002),
  adopted by BufferGeometry (`partGeometry.ts`), disposed by the lifecycle component
  when replaced. No framework auto-dispose to reason about.
- Testing follows the existing pyramid (ADR-0005): scene-builders in vitest; the
  mounted canvas exercised by Playwright-Electron and dogfooding, like every other
  rendered surface.
- The stack stays boring under upgrades: three core + jsm inside pinned Electron,
  with no reconciler tracking React major versions.

## Alternatives considered

- **react-three-fiber** — the right tool when React state shapes the scene tree
  fine-grained: many reactive entities, per-entity pointer handlers as props,
  animation hooks, drei ecosystem. Rejected here: our scene is coarse
  data-to-group rebuilding (a loop over arrays), so the reconciler adds a layer
  without removing work; it is a new runtime dep that in practice pulls drei behind
  it (the exact dependency creep ADR-0006 rejects); r3f-without-drei means
  `extend()`-wrapping controls by hand — half-imperative with the overhead kept;
  testing needs `@react-three/test-renderer` (a third dep); and r3f majors track
  React majors, adding upgrade coupling.
- **Canvas-in-iframe / separate renderer process** — isolation nobody asked for;
  complicates store subscription for zero benefit at this scene size.

## Revisit triggers

- The viewport grows real per-entity interactivity — selection with gizmos, hover
  tooltips on individual parts, drag-to-rearrange — i.e. the scene tree starts
  mirroring fine-grained React state. That is the world where r3f re-earns its keep;
  reopen this ADR rather than growing an imperative event-dispatch layer by hand.
- A three upgrade breaks `three/examples/jsm` import paths (the adapter modules
  localize the damage; this trigger is about reconsidering vendoring or pinning).
- The lifecycle component exceeds its mandate (scene logic creeping in) — refactor
  back to the two-layer structure or revisit the decision.
