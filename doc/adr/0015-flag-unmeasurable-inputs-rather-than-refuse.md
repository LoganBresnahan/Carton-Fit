# ADR-0015: An unmeasurable input is flagged, not refused

Date: 2026-07-25
Status: Accepted
Relates to: ADR-0003 (heuristic verdict labeling), ADR-0004 (units and weight)

## Context

Density mode derives part weight from mesh volume, and `meshVolume`'s
signed-tetrahedron sum is only correct on a closed mesh: the tetrahedra cancel
outside the solid because every edge is shared by exactly two triangles. Give it
an open shell and it still returns a number. Nothing throws, the bounding box is
still right, and the part still renders — the volume is just wrong.

`isClosedMesh` was written and unit-tested in item 2 and then never called, so
until item 9 the app spent that wrong volume without comment. Weight is a *hard*
constraint (ADR-0004), so the error did not stay in the weight field: it changed
the part count and could mis-attribute the binding constraint. A confident wrong
answer, which is the failure mode this project treats as worst.

Open meshes are not exotic. Scanned parts, surface models, exports that dropped
a face, and STLs assembled by hand all arrive this way, and CAD users do not
generally think of "watertight" as a property they are asserting when they hand
over a file.

The question is what the app does when an input it needs cannot be measured.

## Decision

**Compute the answer, show it, and say plainly which number underneath it cannot
be trusted — with the one-click fix named.** Do not refuse, do not silently
substitute, do not quietly switch modes on the user's behalf.

Concretely, for this case:

- `openMeshParts` (renderer, `packing/request.ts`) names the parts whose weight
  is being derived from a meaningless volume. Scoped to the parts the request
  actually packs and empty outside density mode, so the warning fires exactly
  when a wrong number is on screen.
- The results panel shows it above the facts, not beside the weight line: a
  wrong weight produces a wrong count, so it qualifies the whole answer.
- The wording states the consequence and the remedy ("enter the part weight
  directly"), because "not a closed mesh" alone reads as a modelling nitpick
  rather than "the count above is wrong".

This extends ADR-0003's stance rather than inventing one. That ADR already says
the app states what it can prove and qualifies what it cannot; this applies the
same rule one level down, to an *input* the app cannot measure rather than an
arrangement it cannot prove optimal.

## Consequences

- The last known silent-wrong-answer path in the product is closed. An open mesh
  now costs the user a glance, not a wrong shipment.
- Correctness of the warning is now load-bearing. `isClosedMesh` welds by
  position for a reason (occt emits coincident-but-distinct vertices per face);
  if that check regressed to index-based, every real STEP solid would warn and
  users would learn to ignore it. `samples/cube-10x10-open.stl` plus the closed
  cube pin both directions at the unit, golden, and e2e layers.
- Closedness is computed on the main thread, memoized per part alongside volume.
  Same order of cost as the volume it qualifies, and skipped entirely in
  direct-weight mode.
- A pattern now exists for the next unmeasurable input (self-intersecting
  meshes, unit-less STEP files, zero-area triangles): name the affected parts,
  qualify the answer, keep the answer.

## Alternatives considered

- **Refuse to estimate and force direct weight.** Honest, and briefly tempting
  since the number really is wrong. Rejected: geometry may not be what the user
  is asking about at all — they may be fit-checking with weight far from
  binding, in which case refusing withholds a correct answer to protect them
  from an irrelevant one. It also punishes the common case of "I know it's a
  shell, I just want the count".
- **Silently switch to direct-weight mode on import.** Rejected outright: it
  changes the user's inputs behind their back, and the resulting weight (zero by
  default) would be *more* wrong while looking deliberate.
- **Approximate the volume instead — cap the shell, or use the convex hull.**
  Rejected: an unrequested approximation is exactly what got us here. The hull
  is already available (ADR-0003's OBB search) and would overstate a concave
  shell badly, and neither figure is one the user asked for.
- **Warn at import time instead of in the results.** Rejected as too early and
  too easy to dismiss: at import the app does not yet know whether the volume
  will be used at all, and the warning would be stale the moment the user
  switched weight modes.

## Revisit triggers

- Users report the warning firing on parts they consider closed → the weld
  tolerance in `defaultWeldTolerance` is the suspect, not this decision.
- A material/density library arrives (ADR-0004's trigger) → density mode gets
  more use, and the warning may deserve a place next to the density input too.
- A second unmeasurable input appears → generalize the presentation into one
  "qualifications" slot in the results panel rather than a second bespoke line.
