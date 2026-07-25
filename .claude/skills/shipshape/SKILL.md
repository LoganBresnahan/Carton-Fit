---
name: shipshape
description: Verify packaging-estimator is shipshape — tests cover the public surface (suite green twice), docs (VISION/roadmap/ADRs/CLAUDE.md) match the code, and core-purity/units/worker conventions hold. Use after substantive changes, before commits, or when asked whether the project is in order.
---

# /shipshape — repo verification pass

Three gates: **Tests**, **Docs**, **Conventions**. Check all three even if one
fails early — the deliverable is the full report, not the first failure.
Propose fixes; do **not** apply them unless the user asks.

## 0. Scope the audit

```bash
git status --short && git diff HEAD --stat
```

Uncommitted work is the primary audit surface; spot-check the rest. If the
user asks for a full audit, the scope is the whole repo.

## 1. Tests gate

The suite must be green **twice in a row** (the flaky bar — worker- and
timing-sensitive tests must survive a loaded machine):

```bash
npx vitest run
npx vitest run
```

Also: `npm run typecheck` must be clean (tsc is half the test suite in a
geometry codebase), and once `e2e/` exists, `npx playwright test` must be green
— the Playwright-Electron specs and the unit tests share the golden fixtures in
`samples/` (committed parts with hand-computed expected results, ADR-0005).
E2E against the *packaged* build is `/deploy`'s job, not this gate's; here the
dev build suffices.

Coverage is judged by **behavior mapping**, not a percentage. Enumerate the
public surface in scope and name the test that pins each behavior:

- `core/units.ts`: mm ⇄ in and g ⇄ lb round-trips; formatting at the UI edge.
- `core/geometry.ts`: AABB from mesh; signed-tetrahedron mesh volume (closed
  mesh exact, open mesh flagged); minimal OBB volume ≤ AABB volume.
- `core/packing/fast.ts`: grid counts with part/wall clearances (including the
  `floor((usable + gap) / (dim + gap))` edge cases: exact fit, off-by-one,
  zero clearance); 6-orientation search picks the max; weight cap applied;
  **binding constraint (geometry vs weight) reported correctly**.
- `core/packing/thorough.ts`: OBB orientation results carry valid rotation
  matrices; never returns a worse count than fast tier on the same input.
- Fit-check placement: all-fit, one-doesn't-fit, and weight-limited cases.

A new or changed public behavior with no test naming it = **gap**.

Numeric rules (keep them true as tests pin them down):
- Comparisons against box limits use an explicit epsilon (`EPS` in
  `core/geometry.ts`) — never bare float `<=` on accumulated sums.
- Packing functions are deterministic: same input → same layout (no
  `Math.random` in `core/`).

## 2. Docs gate

**ADRs** (`doc/adr/NNNN-slug.md`, Nygard style: Context / Decision /
Consequences / Alternatives / Revisit triggers). Any **decision** in scope —
new dependency, changed algorithm or contract, pattern adopted or rejected —
needs an ADR, or an update marking an existing one superseded. Implementation
detail is not a decision.

**Roadmap** (`doc/roadmap.md`): shipped work is checked off; the frontier
matches reality; deferred sub-tasks are pinned as carry-ins, not dropped.

**VISION.md**: still describes what the app actually does — inputs, modes,
tiers, outputs. Scope changes land here, not just in code.

Drift check, per doc that names code artifacts:

```bash
git log -1 --format='%ct %h' -- doc/<doc>.md          # when the doc last changed
git log -1 --format='%ct %h' -- <files it describes>
```

If a source is newer than the doc, read the diff since the doc's commit and
either confirm the doc still matches or name the exact stale claim. Also grep
that files/symbols named in docs (and CLAUDE.md's Commands section) still exist.

## 3. Conventions gate

Three conventions, each grep-checkable — everything flagged is a violation
unless listed as an allowed escape:

**Core purity** — packing/geometry math is pure TS: no DOM, no three.js, no
Electron imports inside `core/`:

```bash
grep -rn "from 'three'\|from \"three\"\|document\.\|window\.\|electron" src/renderer/src/core
# expect: no hits
```

**Units discipline** — mm/g are canonical; conversion constants live only in
`core/units.ts` (ADR-0004):

```bash
grep -rn "25\.4\|453\.59\|0\.0393" src --include='*.ts' --include='*.tsx'
# expect: core/units.ts only
```

**Worker boundary** — heavy work never runs on the UI thread. The WASM parser
is imported only by the import worker; packing engines are imported only by the
pack worker and tests:

```bash
grep -rn "occt-import-js" src
# expect: workers/import.worker.ts only
grep -rn "^import \{" src/renderer/src --include='*.ts' --include='*.tsx' | grep "core/packing"
# expect: workers/pack.worker.ts (the engines) and components/ModeTierSelectors
# (MODES/TIERS — domain constants from the contract, not engine code).
#
# Match on VALUE imports: `import type` is erased at build, so type-only
# references to the contract from the store, the pack pipeline, the viewport and
# the results UI are correct and expected — that is the contract doing its job.
# What must never happen is engine CODE reaching the main thread. Confirm
# structurally after `npm run build`:
#   grep -c 'unconverged\|aabb-fallback' out/renderer/assets/index-*.js      # 0
#   grep -c 'unconverged\|aabb-fallback' out/renderer/assets/pack.worker-*.js # >0
```

## 4. Report

```
SHIPSHAPE REPORT
  tests        ✓|✗   <n>/<n> twice · typecheck clean · gaps: <behavior lacking a test, or none>
  docs         ✓|✗   ADRs current · roadmap frontier true · drift: <doc: stale claim, or none>
  conventions  ✓|✗   violations: <file:line, or none>
```

For every ✗, list the concrete fix (file:line, what to change). All green →
the ship is shipshape. 📦
