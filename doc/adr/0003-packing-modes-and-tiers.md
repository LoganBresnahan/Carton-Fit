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
