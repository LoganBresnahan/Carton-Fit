# ADR-0002: STEP import via occt-import-js (OpenCascade WASM) in a web worker

Date: 2026-07-24
Status: Accepted

## Context

STEP (`.stp`/`.step`) support is a hard requirement, and files may be assemblies
containing multiple parts that must be extracted individually. OpenCascade is the only
practical open-source STEP kernel. The parser must not freeze the UI on large
assemblies, and must not complicate the installer with native dependencies.

## Decision

Parse STEP with **occt-import-js** — OpenCascade compiled to WebAssembly — running in a
**renderer web worker**. The worker returns per-part triangle meshes (name, positions,
indices) as transferable typed arrays; the UI builds three.js geometry and computes
bounding boxes from them. STL (and later OBJ) load through three.js's own loaders.

## Consequences

- Zero native dependencies: the same WASM parser ships identically on all OSs inside
  the Electron bundle; no per-platform OpenCascade builds.
- Parsing is off the UI thread by construction; the app stays responsive during import.
- We get **tessellated meshes, not exact B-rep geometry**. Fine for v1: bounding-box
  packing and volume-from-mesh only need triangles. Exact geometry would only matter
  for tier-3 true nesting.
- IGES/BREP support comes nearly free later (occt-import-js reads them too).

## Alternatives considered

- **pythonocc / native OpenCascade sidecar** — full B-rep access, but drags a native
  runtime into the installer; rejected with the Python/Qt shell (ADR-0001).
- **Writing our own STEP parser** — not a serious option; STEP is enormous.

## Revisit triggers

- Tier-3 nesting gets built and needs exact geometry or better tessellation control.
- Real-world STEP files surface that occt-import-js mis-parses.
- Import time on large assemblies becomes a complaint (options: caching, native sidecar).

## Addendum (2026-07-24): assembly transforms are baked by the library

Planning assumed we would traverse occt's node tree composing per-node transform
matrices and baking them into vertices ourselves. Inspection of occt-import-js
0.0.23 (source + empirical dump of nested CAx-IF assemblies) shows the library
already does all of it internally: `EnumerateVertices` applies each face's fully
composed `TopLoc_Location` transformation, normals are transformed as directions
(rotation-only by construction), shared products are emitted as **separate
per-instance mesh entries** with world-space coordinates, and nodes carry **no
transformation field** at all.

**Decision:** trust occt's baked world coordinates; do no transform math in our
adapter. The node tree is used only for part *naming* (instance disambiguation).

**Consequences:** eliminates the highest-risk slice of the import plan (matrix
convention/composition-order bugs can't exist in code that doesn't exist);
per-instance duplication costs memory on huge assemblies — acceptable for v1,
already covered by the import-time revisit trigger above.

**Guard:** `tests/assembly-import.test.ts` parses `samples/as1-oc-214.stp` (a
nested, instanced assembly) and asserts instances land at distinct world
positions with volume preserved. If a future occt-import-js emits local
coordinates + node transforms instead, that test fails loudly — revisit here.
