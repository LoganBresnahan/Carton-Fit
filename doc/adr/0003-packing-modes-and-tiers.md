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

## Consequences

- V1 ships useful answers immediately; the product concept (three tiers) is intact
  without gating release on the hardest problem.
- Packing stays pure TypeScript in `core/packing/`, worker-executed and unit-testable.
- A greedy fit-check can say "doesn't fit" when a cleverer arrangement exists — the
  labeling requirement mitigates trust damage.

## Alternatives considered

- **Ship nesting in v1** — weeks of algorithm work, minutes of compute per run,
  hard-to-trust output; rejected as a v1 gate.
- **Single fixed algorithm, no tiers** — simpler, but contradicts the user's explicit
  product direction.

## Revisit triggers

- Users routinely pack concave parts where nesting would change the answer → fund
  tier 3 (likely as WASM/Rust; see ADR-0001 revisit triggers).
- Greedy fit-check produces wrong verdicts on real cartons → upgrade placement
  (extreme-point or search-based) within tier 1/2.
- Demand appears for optimizing *mixtures* of different parts per carton (explicitly a
  v1 non-goal in `doc/VISION.md`).
