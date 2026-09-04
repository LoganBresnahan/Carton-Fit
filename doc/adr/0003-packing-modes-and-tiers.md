# ADR-0003: Two answer modes, three packing-quality tiers (nesting deferred)

Date: 2026-07-24
Status: Accepted

## Context

Users ask two distinct questions of a model file: "do all the parts in this file fit in
this box?" and "how many copies of this part fit?". Packing algorithms range from
instant bounding-box math to research-grade 3D nesting, and the ambition level had to
be chosen. The user explicitly wanted the ambition level to be *their* choice in the UI
rather than ours at build time.

## Decision

- **Two modes**, user-selectable: **Fit check** (default — can all parts in the file
  fit?) and **Max quantity** (copies of a selected part, or the whole file as a unit).
- **Three quality tiers**, presented in the UI from day one:
  1. **Fast** — axis-aligned bounding box per part, 6 orientations, grid fill
     (quantity mode) / greedy shelf placement sorted by volume (fit check).
  2. **Thorough** — minimal-volume oriented bounding box (convex hull + rotation
     search), then the same placement on OBB dims; results carry rotation matrices.
  3. **True nesting** — real-geometry interlocking. Visible but **disabled**, marked
     experimental/coming-later. Not part of v1.
- Heuristic results are labeled as heuristic: fit-check placement is greedy, not
  optimal, and the UI says so rather than implying a proof of non-fit.

**Amended 2026-07-27 — placement upgraded per ADR-0022 (roadmap item 16).** Both
shipped tiers now run *two* placement engines and return whichever packs more:
the greedy shelf described above, plus extreme-point placement, which keeps the
corners the shelf cursor abandons. Quantity mode is the same shape with the grid
as its incumbent. Three things this section said are worth restating precisely,
because only one of them changed:

- **The tier structure is unchanged, and the upgrade is invisible.** It lands
  *inside* tiers 1–2 through the existing `FitStrategy` seam; there is no
  placement selector, because ambition level is the tier ladder's job and a
  second dial would make the tier labels conditional on it (ADR-0022 §1).
- **The heuristic label STAYS, and its wording is unchanged.** The better of two
  heuristics is still a heuristic: a "doesn't fit" is still not a proof that no
  arrangement exists. What is new is that the panel can now *explain* the
  stopping point — the largest free space left, against what the smallest
  leftover part needs — and that explanation is deliberately worded as two
  numbers side by side with no conclusion drawn (ADR-0022 §7).
- **Quantity mode gained a claim that is NOT a heuristic**: a rigorous upper
  bound shown beside the count. That is the one place in the product where a
  packing figure may be stated flatly, because no arrangement can beat it.

The incumbent is kept permanently rather than replaced — as the floor that makes
"never a worse answer than before" structural, as the differential-test oracle,
and as the crash barrier (ADR-0022 §2).

## Consequences

- V1 ships useful answers immediately; the product concept (three tiers) is intact
  without gating release on the hardest problem.
- Packing stays pure TypeScript in `core/packing/`, worker-executed and unit-testable.
- A greedy fit-check can say "doesn't fit" when a cleverer arrangement exists — the
  labeling requirement mitigates trust damage.
  *(2026-07-27: still true after ADR-0022, and still mitigated the same way — a
  better search narrows this gap without closing it. Measured on a 240-case
  generated sweep, the upgrade improved the answer on about a third of the
  inputs and worsened none.)*

## Alternatives considered

- **Ship nesting in v1** — weeks of algorithm work, minutes of compute per run,
  hard-to-trust output; rejected as a v1 gate.
- **Single fixed algorithm, no tiers** — simpler, but contradicts the user's explicit
  product direction.

## Addendum, 2026-09-04 (sixth dogfood): a negative result must name its limit too

The heuristic-labeling rule this ADR mandates has always been about *epistemic
direction*: a positive result is a constructive proof, a negative one is not.
`verdictCaption` implements that carefully for every outcome except one. At
`count === 0` it returned early with **"None fit in this carton."** — before the
branch that names which limit stopped the count.

So a 35 lb cap against a hand-typed 40 lb part produced a verdict about the
*carton*, while `geometryBound: 3`, `spaceOnlyCount: 3` and
`binding.constraint: "weight"` in the same payload all said the carton takes
three. Because the panel, the MCP note and both exports read the one caption,
it reached an exported quote block whose next line but one read "the weight cap
stopped this at 0 — the carton itself would take 3". The artifact refuted
itself two lines apart.

**The rule this adds: "in this carton" is a claim about SPACE, and a claim
about space needs the space bound to license it.** The zero branch now consults
`geometryBound`; when the bound says the carton takes some, the caption names
the limit the way every non-zero sibling already does (`None fit
(weight-limited).`). An absent bound keeps the original sentence rather than
sharpening it — no bound establishes nothing, and asserting "weight-limited"
without one would be the same unbacked move in the other direction.

This is ADR-0029's phase-2 rule applied to a case that predates it: the fix is
a field plus a sentence that reads it, never a rewording. Worth recording that
the defect survived six months and five dogfood sessions because a zero looks
like a boring case — the reader who found it went looking specifically for
whether the zero-count wording reached an export, which is what a tier-3 reader
does that a test author does not.

Pinned by `tests/pack-verdict.test.ts`: both arms, since a fix that only ever
says "weight-limited" would trade one unbacked claim for another.

## Revisit triggers

- Users routinely pack concave parts where nesting would change the answer → fund
  tier 3 (likely as WASM/Rust; see ADR-0001 revisit triggers).
- ~~Greedy fit-check produces wrong verdicts on real cartons → upgrade placement
  (extreme-point or search-based) within tier 1/2.~~ **Discharged by ADR-0022**
  (accepted 2026-07-26, shipped 2026-07-27), deliberately *ahead* of this trigger
  firing: the design resolved in discussion faster than the dogfooding evidence
  would have arrived, and the upgrade benefits both shipped tiers regardless. The
  next placement step is tier 3 (ADR-0023), which warm-starts from tier 2 — so
  this work compounds into it rather than competing.
- Demand appears for optimizing *mixtures* of different parts per carton (explicitly a
  v1 non-goal in `doc/VISION.md`).
