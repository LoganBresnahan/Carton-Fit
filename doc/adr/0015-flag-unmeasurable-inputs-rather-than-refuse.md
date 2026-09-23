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

## Addendum, 2026-09-09 (sixteenth dogfood): the bias this ADR does not flag

This ADR flags the *catastrophic* case — an open mesh, whose volume is wrong
rather than approximate — and says nothing about the systematic one. Mesh
volume is the volume of a tessellation, and a tessellation of a curved face
is inscribed in the true surface: a cylinder faceted `n` times around loses
`1 − (n/2π)·sin(2π/n)` of its cross-section, about 1.6% at twenty facets,
0.4% at forty. The importer runs at occt-import-js's default deflection —
nothing in `src/main/occt` sets one — so the facet count is whatever that
default gives each face.

A reader on the sixteenth run derived this and checked it against the
reference file: the plate is planar and its density weight reproduces a hand
figure to five significant digits; the bolts and rod are not, so the
whole-file 13.229 lb is low by a fraction nothing in the reply bounds.
Irrelevant at 38% of a cap; not at 98%. No run has found a wrong number
from it, and this addendum records the mechanism rather than a defect.

**What the honest field is, and is not.** A constant note ("mesh volumes of
curved parts run slightly low") is ADR-0029 amendment 12's constant and says
nothing a reader can act on. The field that can be false is *per kind*:
whether this kind has curved faces at all. The importer already returns
per-vertex normals; a kind whose adjacent triangles share a normal
everywhere is planar and exact, and one whose normals turn is faceted and
low. A bound on *how* low needs the deflection the importer used, which is
knowable if the import passes one explicitly instead of taking the default.

**Decision deferred**, as roadmap item 40: `inspect_model.kinds[]` and the
estimate's `weightInput` gain a per-kind `curvedFaces: boolean` (or a volume
tolerance derived from an explicit deflection), and the density line on
every surface reads it. Not built with the run's other findings because it
is a new qualification, and ADR-0029's rule for those is a claims table
before a sentence (`doc/wire-rules.md`, rule 14: derive the path from the
condition to the number first). The path here is real — density × a low
volume is a low weight against a hard cap — and the number it reaches is the
count.

## Addendum 2, 2026-09-09 — the decision: a per-kind field, read by the density line

Built as roadmap item 40. The probe that settled the shape: on the reference
assembly, occt-import-js emits *surface* normals — per vertex, from the
B-rep face — so on a cylinder the three normals of one triangle turn by the
facet's own subtended angle (14.5° on the bolt, 13.7° on the nut's thread
hole and the plate's bolt holes), and on the cube they do not turn at all.
That angle is the tessellation's coarseness, measured from the mesh the app
actually integrated, and it is a better basis for a tolerance than the
deflection parameter the addendum above proposed passing: the parameter says
what was asked for, the angle says what was produced.

**Three facts, three fields, per kind** (`core/geometry.ts`, read by
`inspect_model.kinds[].tessellation`):

- `curvedFaces` — any triangle's vertex normals turn by more than
  `PLANAR_TURN_DEG` (0.1°, a tolerance named for the one question it answers:
  is this triangle on a surface that turns). False on the cube, true on every
  kind of the reference assembly — **including the plate**, which the
  sixteenth reader called planar: its bolt holes are cylinders.
- `facetTurnDeg` — the largest such turn. 0 when planar.
- `volumeTolerance` — the fraction the enclosed volume can be off by, either
  way: `2·(1 − sin θ/θ)` at θ = the largest turn. A chord across an arc of
  θ loses `1 − sin θ/θ` of the sector it spans; a doubly curved surface
  (a fillet, a sphere) loses it in both directions, hence the 2. About 2.1%
  at 14.5°. *Either way*, because an inscribed polygon understates a convex
  surface and overstates a hole — the plate's mesh volume is high, the rod's
  low, and the sign per kind is not something this addendum claims to know.

The field is `Known<…>`: an STL is its mesh, there is no surface behind it to
be a tessellation *of*, so for a mesh-origin part the answer is
`known: false` with that reason — not `curvedFaces: false`, which would say
"exact" about a file that may be a twenty-facet cylinder. That is why
`ImportedPart` now carries `origin: 'brep' | 'mesh'`: the STL loader emits
facet normals that cannot be told from a planar solid's surface normals.

**The path to the count, and the gate on the sentence** (rule 14 of
`doc/wire-rules.md`). Density × an approximate volume is an approximate weight
against a hard cap, and that reaches the count only when the cap is within the
band. So the estimate carries `weightInput.meshVolumes` —
`approximateKinds` (counted, density-derived, closed, not overridden, with
curved faces: the same scoping as the open-mesh warning, and an open mesh is
excluded because its volume is wrong rather than approximate),
`volumeTolerance` (the largest over those kinds) and `couldChangeCount`,
which is the band test: for max-quantity, whether `count` units heavier by
the band would exceed the cap, or `count + 1` units lighter by it would fit
under a cap that bound; for fit-check, whether the file's total crosses the
cap inside the band. The warning on the panel, in both exports and in the
wire's note fires on `couldChangeCount` alone — at 38% of the cap the field
says false and the surfaces say nothing, which is what rule 14 asks. The
summary export's *Part weight: density × part volume* line reads
`approximateKinds` and names them with the tolerance whenever it is
non-empty: that line is a claim about where the grams came from, and "mesh
volume" without "approximate" is the omission the sixteenth reader found.

One report, every surface (`meshVolumeReport` in `packing/verdict.ts`,
rule 5): the panel, both exports and both estimate tools call it.

*Amended 2026-09-10 by ADR-0029 amendment 23, after the first run against
it:* the band test's *too few* branch also asks `spaceOnlyCount > count` —
the description above derived the path from the weight and not the path
from the carton, and the reply told an engineer to weigh a plate the carton
could not take a fourth of. The band is now Σ(each kind's tolerance × its
grams), and the tolerance rides the wire per kind with a percent sibling.

**Not done, on purpose:** the sign per kind, and a tighter tolerance from the
importer's deflection. Both are real work that no run has needed; the revisit
trigger above still stands, and `facetTurnDeg` on the wire is the number a
reader needs to do either by hand.

## Addendum 3, 2026-09-23 (twenty-third dogfood): the band is a bound on the curved faces, not a fraction of the block

The revisit trigger below fired for the first time — a density-derived weight
within a few percent of the cap on a part with curved faces — and the
addendum above was the bug, exactly as it said it would be. At a 36.5 lb
cap the plate's reply read *can run about 1.9% light or heavy… weigh one and
enter it directly to settle it*. The reader put the figure beside the part:
the plate's box is 180 × 150 × 20 mm (32.95 in³), its mesh volume 32.38 in³,
so every non-block feature on it — six Ø10 bolt holes — is 0.57 in³
together, and a 1.9% band is 0.61 in³: wider than all the holes put
together, let alone the sliver of each a facet can miss. The sentence
stated a whole-volume bound as a realistic spread, and the arithmetic sent
an engineer to weigh a plate the holes could not make that light.

**The bound, per triangle.** `2·(1 − sin θ/θ)` was the fraction of a
*sector* a chord loses, applied to the whole volume as if every face were
curved. The deflection bound this addendum deferred is computable from the
mesh alone (`tessellationErrorMm3` in `core/geometry.ts`): for each triangle
whose surface normals turn, and each of its edges, resolve the change in
normal along the edge — `d = (n_q − n_p)·ê`, which is `2·sin(φ_e/2)` for the
normal section's own angle — and take the sagitta of the circular arc
through both ends, `s = (L/2)·tan(φ_e/4)`. Resolving matters: a facet's
diagonal on a cylinder spans the same turn as its chord but is several times
longer, and the chord's turn taken as the diagonal's puts the arc off by
the square of that ratio (the first cut of this bound said 17% on the bolt
for exactly that reason). The volume between facet and surface is at most
the facet's area × its largest edge sagitta; summed over the mesh, that is a
bound on the enclosed volume's error, and `volumeTolerance` is it over the
volume. On a faceted cylinder the true error is two-thirds of the bound —
segment over chord × sagitta — which the geometry test pins on a 24-gon by
hand. On a doubly curved face the facet's centre can sit further off than
its edges' midpoints, but the error is an integral and the facet's average
deviation stays under the edge sagitta for any triangle a tessellator
produces; a deliberately sliver-triangulated sphere is the case this does
not promise.

**What it does to the numbers.** The bound scales with curved *area* over
volume, which is the property the reader was reaching for:

| kind | old (whole volume) | new (curved faces) | true, by hand |
| --- | --- | --- | --- |
| plate | 1.90% | 0.016% | ~0.010% (six hole-walls, 34 facets each) |
| l-bracket | 1.86% | 0.029% | — |
| nut | 1.90% | 0.31% | — |
| bolt | 2.13% | 0.88% | — |
| rod | 1.86% | 0.89% | ~0.5% (36 facets) |

Four plates lighter by the plate's band are 36.727 lb, over 36.5, so
`couldChangeBinding` is false there and the note is gone; the cap that
reaches inside the band is 36.73 lb, which is how far a faceted hole can
move it. The whole-file headline moves from the bolt's 2.1% to the rod's
0.9%, the kind whose volume is most nearly all cylinder. Nothing on the
wire changes name or shape (rule 7): `volumeTolerance` and its percent
sibling carry a smaller value, `facetTurnDeg` still says how coarse, and
`inspect_model`'s description of the field says what the number now is.
The goldens carry by-hand brackets for the plate and the rod (30–40 facets
around each cylinder), and the wire tests pin the app's figure inside them.

**Still not done:** the sign per kind. A hole overstates and a boss
understates, and the bound is either way; the band is symmetric. No run
has needed the sign, and the bound is now small enough on every kind of the
reference file that the symmetric version costs nothing a reader has
noticed.

## Revisit triggers

- **A density-derived weight lands within a few percent of the cap** on a
  part with curved faces — then the addendum above is the bug, and item 40
  is the fix. *Fired 2026-09-23 (twenty-third dogfood); addendum 3.* The
  trigger that remains is a **doubly curved part near the cap** — a sphere,
  a fillet-heavy casting — where the edge-sagitta bound is an estimate of
  the interior; the fix then is the deflection the importer was asked for,
  passed explicitly.
- Users report the warning firing on parts they consider closed → the weld
  tolerance in `defaultWeldTolerance` is the suspect, not this decision.
- A material/density library arrives (ADR-0004's trigger) → density mode gets
  more use, and the warning may deserve a place next to the density input too.
- A second unmeasurable input appears → generalize the presentation into one
  "qualifications" slot in the results panel rather than a second bespoke line.
