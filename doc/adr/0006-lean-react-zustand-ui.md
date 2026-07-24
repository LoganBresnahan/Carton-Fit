# ADR-0006: Lean UI stack — React + Zustand, and nothing else

Date: 2026-07-24
Status: Accepted

## Context

The renderer needs declarative, isolated components and simple state shared between an
inputs panel, a 3D viewport, and a results panel. The maintainer dislikes giant
dependency trees, and the project's transferability goal argues for a stack a stranger
already knows. The maintainer's captAInHook web UI set the precedent: its entire
runtime dependency list is `react + react-dom + zustand` ("React+Vite islands over one
Zustand store").

## Decision

Replicate that posture. Renderer runtime dependencies are **exactly**:

- `react`, `react-dom` — declarative isolated components
- `zustand` — one store, components subscribe to slices; no context towers, no reducers
- `three` — the 3D viewport (ADR-0001/0003)
- `occt-import-js` — STEP parsing (ADR-0002)

Plus `better-sqlite3` in the main process (ADR-0007). **That is the complete runtime
dependency list.** No router (single window), no UI-component kit, no CSS framework
(plain CSS), no form library, no state middleware.

**Guard rail: adding any runtime dependency requires an ADR.** Dev dependencies
(vite, vitest, playwright, electron tooling) are exempt but should stay boring.

## Consequences

- The store is the app's data spine: loaded parts, box spec, settings, results live in
  one Zustand store; workers and IPC write into it; components stay thin.
- Some conveniences get hand-rolled (a numeric input with unit display, a select).
  Acceptable: this app has one screen.
- Anyone who has read the captAInHook web UI can navigate this one, and vice versa.

## Alternatives considered

- **Preact** — smaller runtime, same API. Rejected: savings are irrelevant inside
  Electron, and mainline React keeps the transferability/knowledge story cleanest.
- **Redux / RTK** — rejected: boilerplate machinery for a one-store app.
- **Svelte/Solid** — fine frameworks, but break the "matches the maintainer's other
  repos" property that Zustand+React preserves.

## Revisit triggers

- The app grows real multi-view navigation → reconsider routing.
- Dependency-tree creep: any PR adding a runtime dep without an ADR is a `/shipshape`
  docs-gate violation.
