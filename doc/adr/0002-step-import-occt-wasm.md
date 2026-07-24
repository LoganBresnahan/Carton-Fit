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
