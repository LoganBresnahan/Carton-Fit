# ADR-0031: A second packing stage — cartons onto a skid, through the same engine

Date: 2026-09-02
Status: Proposed (the request is a forwarded email; every input below that
the email did not specify is named as a default the user corrects, not as a
fact we know)

Extends ADR-0003 (the packing contract) and ADR-0016 (saved estimates, which
become the handoff between stages). Amends `VISION.md`, whose v1 non-goals
list "pallet/stack planning" — this ADR is the deliberate reversal of that
line, made now because the first customer request after the AI surface was
exactly this.

## Context

A program manager at a die-casting plant, 2026-08-27, forwarded by their
quality manager on 2026-09-02. Quoted so the request survives in its own words:

> after I have selected the type of box I want to use and understand how many
> pcs / box, if we could then take it a step further and work on skid
> formation and building out what a skid would look like.
>
> We typically have 2 skid sizes that are used. But I know that [a customer] wants
> us to introduce a new size for their parts. Can we be able to select the box
> with the pc count I like, then save that and then take that to the skid
> build out and select from 48”x45”, 26”x26”, & 40”x48” for the skid size.
>
> Then we will need to add in varying orientations for the packaging and how
> we would stack the boxes and how many stacks we are allowing. Options such
> as: Column stacking, Interlocking, Custom mixed stacking, Chimney stacking.
>
> Then it would be nice to have that calculate how many pcs / skid and
> provide a picture of what the skid with boxes looks like. I would want the
> program to take in account any overhang and flag that as non functional so
> we do not select that option. It would also be helpful to get the weight
> and overall dimensions of the skid with parts.

And on 2026-09-01, asked what the four patterns meant:

> We probably only use the Colmn stacking and interlocking stacking so those
> 2 should be good enough.

The narrowing is the most valuable sentence in the thread. Column and
interlock are the same operation — tile one carton footprint across the skid,
repeat per layer — differing only in whether alternate layers are rotated.
Chimney (pinwheel) is a specific hand-designed tiling, and custom mixed means
different cartons on one skid, which breaks the one-unit assumption every
quantity strategy in the engine rests on.

**What the engine already is.** `PackRequest` (`core/packing/types.ts`) is
container-agnostic: a `carton: Vec3`, `clearances`, a `maxWeightG`, and
`PackPart`s that become `PackBox`es — a name, a weight, and a list of allowed
orientations. The fit and quantity strategies are pluggable functions. Nothing
in the contract says "part" in a way that matters; a carton is a box with two
allowed orientations instead of twenty-four, and a skid is a container with an
open top. Column stacking is `gridFillQuantity` with orientations restricted.
The engine's honest-binding rules, the rigorous upper bound (ADR-0022), and
the weight cap all carry over unchanged.

**What the engine does not have.** A *layer*. Interlock is "layer k is layer
k−1 rotated"; a stack limit is a cap expressed in layers; overhang is a
tolerance on a wall rather than a wall. Those three are the whole addition.

Four product answers were given by the maintainer in conversation on
2026-09-02, recorded here as decisions rather than left in chat:

1. Stack limit as **both** a layer count and a height measurement — either,
   both, or neither; whichever binds first is reported.
2. Overhang as **one signed measurement** per skid — 0 means flush,
   positive allows that much past the deck edge, negative is an inset
   (shrink-wrap and corner-board setups are specified that way).
3. **Empty carton weight** is a user input.
4. **Per-layer footprint** is supported — in the sense of per-layer
   *orientation*, which is what interlock is, generalised. Different carton
   counts or different cartons per layer is custom mixed and stays out.

## Decision

**1. Packing has stages, and a stage is the existing contract with a
container that has faces.** A *stage* packs units from the previous stage
into a container under constraints. Stage 1 is what exists today — parts into
a carton. Stage 2 is cartons onto a skid. The types generalise, not
duplicate:

```ts
interface Container {
  inner: Vec3                       // footprint × height; height may be Infinity
  faces: FaceTolerances             // signed mm per face; carton = all zero
  maxHeightMm?: number              // stage 2: skid height cap, deck included
  maxLayers?: number                // stage 2: stack count
  maxWeightG: number                // gross — units + their tare + the container's tare
}
```

A carton is the special case where every face tolerance is zero and the top
is closed. A skid is the case where four side faces carry the overhang
tolerance, the top is open, and height is bounded by whichever of the two
caps binds. Modelling faces on the container — rather than a `skid` flag —
is what lets a tote, an open crate, or a third stage (skids into a trailer)
appear as configuration, not architecture. The UI exposes one overhang
number; the per-face model exists so that stays a UI decision.

**2. A pattern is a repeating sequence of per-layer orientations.** Column is
the one-entry sequence `[A]`; interlock is `[A, B]` where B is A rotated 90°
about the vertical; a custom pattern is any sequence the user writes. All
three are one strategy, `layeredFill`, parameterised by the sequence. It
tiles the footprint for each distinct orientation once (the existing grid
math, restricted to upright orientations), then stacks layers in sequence
until a cap binds. Chimney is *not* in this family — a pinwheel layer mixes
two orientations in one tiling — and is a named revisit trigger, not a
strategy stub.

**3. The handoff is a saved carton estimate.** Stage 2 consumes a stage-1
estimate the user chose to keep (ADR-0016), and the estimate row's `settings`
and `result` JSON grow the fields the skid needs, named here so the exports
and the MCP schema agree:

- `carton.outer: Vec3` — exterior dimensions. Today the app takes inner, or
  outer plus wall thickness; stage 2 needs outer, so a stage-1 estimate whose
  wall thickness is unknown carries `outer = inner` and a warning, never a
  guess.
- `carton.tareG: number` — empty carton weight, new input on stage 1.
- `carton.grossG: number` — parts + tare, the number stage 2 stacks.
- `count` — pieces per carton, already present.

A stage-2 estimate references its stage-1 source by estimate id and by the
content hash ADR-0007 already keys history on, so a re-imported part still
finds its carton.

**4. The carton weight cap becomes gross.** Once tare exists, the 35 lb
default (ADR-0004) counts the carton too, because shipping caps are gross.
This can lower an existing part count by a piece; it is a behaviour change
users would notice and gets its CHANGELOG line. Tare defaults to 0 so nothing
changes until a user enters one.

**5. Overhang is a wall, not a warning.** A layout whose footprint exceeds
the deck by more than the tolerance is rejected during tiling, exactly as a
part exceeding the carton is — the requester asked that overhang be flagged as
non-functional, and a result the user cannot select is one the search never
offers. The binding enum grows: `'geometry' | 'weight' | 'height' | 'layers'`,
additive under ADR-0020, and `binding.bound` (567475d) keeps meaning "actually
rejected something".

**6. Skid presets, with the deck as data.** A preset is footprint, deck
height, and tare weight. Ship three, in the order the requester listed —
48×45 in, 26×26 in, 40×48 in — with a custom entry, mirroring how carton
dimensions work. Deck height defaults to 5.5 in and tare to 40 lb for all
three because we do not know theirs; both are visible, editable fields on the
preset, and the result's "overall dimensions" line says which deck height it
used. The 26×26 footprint is unusual enough (a half-pallet, or cut down) that
its defaults are the ones most likely wrong.

**7. Outputs, in the order they were asked for.** Pieces per skid (cartons × pieces per
carton), the skid picture (the existing viewport, instanced cartons instead of
instanced parts, skid deck drawn as a solid block under the wireframe
envelope), gross skid weight (cartons × carton gross + deck tare), overall
dimensions (footprint including any positive overhang, height = layers ×
carton outer height + deck). Every line carries the qualifications stage 1
already carries — the open-mesh warning on a density weight propagates
through the tare into the skid gross, since a wrong part weight is a wrong
skid weight eighteen hundred times over.

**8. The AI surface follows by parameter, not by tool.** `estimate` and the
v2 drive tools gain a `stage` argument; `capture_view` returns whichever
stage is on screen. Additive under ADR-0020 and the ADR-0029 schema rules.

## Open details

- **Whether 26×26 is a real deck or a half-pallet with a different height.**
  Resolution: ask; the preset is editable either way.
- **Interlock with an odd tiling.** A 90° rotation of a tiling that used the
  footprint unevenly (say 3×2 of a rectangular carton) may not fit the same
  count the other way. The strategy takes each layer's count from its own
  tiling; the result reports per-layer counts when they differ. Whether users
  *want* an interlock layer with fewer cartons or would rather be told "not
  interlockable at this size" is a dogfood question.
- **Clearance between cartons.** Stage 1's `betweenParts` clearance has an
  obvious stage-2 analogue (cartons are rarely stacked with gaps, but
  stretch-wrap and slip sheets have thickness). Default 0; the field exists
  because the contract already has it.
- **Stage-1 estimates saved before this ADR** have no `outer` or `tareG`.
  Migration fills `outer` from `inner` + wall thickness when the settings
  carried one, else `inner` with the warning above; `tareG` = 0.
- **Whether the two stages share one viewport with a stage switch, or the
  results panel shows both.** One at a time, selected by stage, is assumed;
  it matches the pipeline shape and keeps the toggle set small.

## Consequences

- **VISION's non-goals line is split.** "Pallet/stack planning" leaves the
  list; "box selection/recommendation" and "cost estimation" stay. Custom
  mixed stacking and chimney join it, as decisions with revisit triggers.
- **One new concept in core** — the layer sequence — and one generalised one,
  the container's faces. No new runtime dependency; ADR-0011 untouched. The
  viewport reuses the instanced-mesh path (ADR-0008).
- **A second inputs panel** (skid preset, overhang, caps, pattern) and two
  new stage-1 fields (tare, and outer becoming a first-class output). ADR-0004
  is extended, not superseded.
- **The estimates table grows fields inside its JSON**, not columns; a
  `PRAGMA user_version` bump carries the backfill (ADR-0007).
- **The goldens grow a stage-2 layer.** A hand-computed skid for the 10 mm
  cube golden — small carton, known count, both patterns, one overhang case
  that must be rejected — shared by vitest, e2e, and dogfood (ADR-0005).
  Adversarial verification is reserved for the tiling-with-tolerance math
  and the gross-weight change, the two places a silent wrong number can hide.
- **Sizing.** Roughly item 7 (ADR-0007) in scope: core strategy + types,
  store slice, panel, viewport, persistence migration, exports, MCP
  parameter, goldens. Decompose with `adr-plan` after acceptance.

## Alternatives considered

- **A skid module beside the engine, with its own tiling code.** Faster to
  write, and it boxes the product into exactly two levels with two
  vocabularies for one operation. Rejected: the engine already packs boxes
  into a container, and the second copy would drift from the first on
  precisely the honesty rules (binding, upper bound, warnings) that make the
  numbers trustworthy.
- **A `skid` boolean on the request instead of face tolerances.** Rejected
  for the same reason ADR-0030 rejected a file-format plug-in: it enshrines
  the special case. Faces cost one small type and make the third container a
  data change.
- **Custom mixed stacking now.** Rejected: not requested (the requester said the
  two suffice), and it is the multi-item pallet problem — the same research
  character as tier 3 (ADR-0023), on a surface nobody asked for.
- **Chimney as a third strategy now.** Deferred rather than rejected; it is a
  fixed layer design, not a search, and belongs with a request. Named as a
  trigger so the omission stays a decision.
- **Overhang as a warning on an otherwise-accepted layout.** Rejected: the
  email says non-functional, and a warning is a result the user can still
  pick. Warnings stay for things that qualify an answer, not things that
  invalidate one.
- **Per-face overhang in the UI.** The model has it; the UI does not.
  Rejected for v1 because every knob is a state the user has to understand,
  and no one has asked for asymmetric overhang.
- **Estimating carton tare from dimensions and board grade.** Rejected for
  now: an input the user knows beats a table we would have to maintain.
  Revisit if tare turns out to be the number nobody has.

## Revisit triggers

- A request for chimney/pinwheel: add it as a fixed-layer strategy in the
  same family, with its own golden.
- A request for mixed cartons on one skid: that is a new contract
  (multi-unit quantity), its own ADR, and probably its own tier.
- A third stage (skids into a trailer or container): the container model
  should absorb it as data. If it needs code beyond a new preset kind, the
  stage abstraction was wrong and this ADR should be superseded.
- Dogfood reports that the interlock layer-count difference confuses rather
  than informs: switch to "not interlockable" and say why.
- Someone needs asymmetric overhang: expose the per-face fields the model
  already carries.
