# ADR-0023: Tier 3 is drop-in packing — voxelized geometry under an insertion-order constraint, warm-started from tier 2

Date: 2026-07-26
Status: Proposed

## Context

ADR-0003 deferred tier 3 as "real-geometry interlocking," borrowing the framing of 3D
nesting from additive manufacturing (powder beds, build plates), where parts float in
a volume and interlocked arrangements are fine because the medium is sieved away.
Design discussion (2026-07-26) concluded that framing is wrong for this product.
Carton Fit packs *shipping cartons*, and the carton version of the problem has three
constraints the printing version does not:

1. **A human packs the box.** The real feasibility condition is not "no collisions in
   the final state" but "there exists an insertion sequence — essentially top-down —
   where each part drops into place past the parts already there." Free nesting can
   return arrangements no packer can reproduce; those are wrong answers wearing high
   fill percentages.
2. **Clearance is big.** Dunnage/foam padding is a first-class input (VISION), and
   real geometry dilated by several mm per surface converges back toward its bounding
   volume. Real-geometry gains shrink in proportion to clearance.
3. **Weight often binds first.** When it does, geometric tightness is irrelevant, and
   the engine already knows which constraint bound (ADR-0004).

The insertion constraint is a gift, not a cost: it forbids unbuildable interlocks
automatically while still permitting the *good* nesting — spooned scoops, stacked
trays — because anything packable in sequence is unpackable in reverse. And it makes
the search space "drop-in packing," which is computationally far tamer than free 3D
nesting.

## Decision (proposed design)

- **Geometry model: voxel occupancy, not meshes or no-fit polygons.** Voxelize each
  part mesh (occt already produces the mesh) at roughly 2–5 mm, dilate by the
  clearance, collide via bitmask tests on a 3D grid. NFP-grade precision is pointless
  under dunnage clearances; voxels dodge the robustness swamp (degenerate polygons,
  floating-point predicates) entirely.
- **Warm start from tier 2.** Box-disjoint placements are trivially collision-free
  and trivially insertable, so tier 2's answer is always a legal tier-3 incumbent.
  Tier 3 is then improving-moves-only local search — gravity-settle, compaction,
  pairwise reseat, orientation tweaks — each move checked for voxel collision *and*
  top-down insertability of the resulting sequence. Monotone over tier 2 by
  construction, and an **anytime** algorithm: interrupt it whenever, the incumbent is
  always at least tier 2's answer. Visible time budget in the UI.
- **One objective per mode, identical across tiers** (count in quantity mode,
  verdict-plus-witness in fit check), so "never worse than Thorough" is a claim about
  the same number. Clearance semantics are defined once, at the finest model, with
  coarser tiers over-approximating — never the reverse.
- **Deterministic and ratcheting.** Seeded search; best-known result cached keyed on
  (mesh hashes, carton, clearances, mode, weight inputs), so the same estimate never
  gets worse across re-runs.
- **Advisory gating.** Tier 3 says when it cannot help, before spending the budget:
  when weight is the binding constraint, and when clearance is large enough that
  dilated parts are effectively their boxes — the same honesty move as tier 2's
  "parts are already axis-aligned."
- **The witness is packing instructions.** Because the algorithm works in insertion
  order, its output is an ordered sequence of (part, orientation, position). The
  three.js viewport can animate parts dropping into the carton one at a time —
  "pack it in this order, this way round." That is tier 3's product payoff, something
  no bounding-box tier can produce, and it survives even when the fill improvement
  over tier 2 is small.

## Open details (to resolve before Accepted)

- Voxel resolution policy (fixed vs. derived from part size/clearance), and memory
  bounds for large cartons at fine resolution.
- The insertability check's exact model (pure vertical drop vs. limited lateral
  slide-in), which sets how much real-world packing skill the witness assumes.
- Move set and acceptance schedule for the local search; whether plain improving
  moves suffice or a restart/perturbation layer earns its keep.
- Where the ratchet cache lives (in-memory vs. the estimates DB) given ADR-0016's
  explicit-save semantics.
- Whether performance demands WASM/Rust (ADR-0003 guessed it would) or worker-side
  TypeScript bitmask math suffices — the lean-dependency rule (ADR-0011) makes this
  a real decision, not an implementation detail.

## Consequences

- **Redefines tier 3**: from "real-geometry interlocking" to "real-geometry drop-in
  packing." On acceptance, VISION's tier list and ADR-0003's tier-3 line are amended
  to match — the disabled tier-3 button stops promising arrangements a human could
  not reproduce.
- The result schema grows sequence data (packing order) — a contract change for
  storage, export, and the viewport, which is part of why this is an ADR.
- Tier 3 inherits every improvement to tier 2's placement (ADR-0022) for free, since
  it starts from tier 2's answer; the two proposals compound.

## Alternatives considered

- **NFP / exact mesh-collision nesting** — rejected: research-grade robustness cost
  for precision that dunnage clearance erases; and still needs the insertion
  constraint bolted on to be shippable.
- **Free interlocking (the ADR-0003 framing)** — rejected: optimal-looking answers a
  packer cannot execute are the failure mode users won't forgive.
- **Metaheuristic from scratch (SA/GA over placements)** — rejected: abandons the
  warm start, so it can land worse than Thorough and is not anytime; stochastic
  variance across runs damages trust even when the mean is better.

## Revisit triggers

- ADR-0003's tier-3 trigger stands: users routinely packing concave parts where
  nesting would change the answer is what funds the build; flip to Accepted and run
  `adr-plan` then.
- If dogfooding shows typical clearances at or above ~10 mm, revisit whether tier 3
  is worth building at all versus promoting the packing-instructions animation to
  tiers 1–2 (their placements are sequences too).
- If voxel memory/time on real parts breaks the worker budget, revisit the WASM/Rust
  question with measurements in hand.
