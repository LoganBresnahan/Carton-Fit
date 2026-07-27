# ADR-0022: Upgrade fit-check placement to extreme-point/EMS; greedy shelf stays as incumbent, oracle, and fallback

Date: 2026-07-26
Status: Accepted (2026-07-26; drafted Proposed earlier the same day)

## Context

ADR-0003 shipped fit check on greedy shelf placement (`core/packing/shelfFit.ts`) and
named its weakness in its own consequences: a greedy "doesn't fit" is not a proof of
non-fit. The shelf heuristic's cursors only move forward — the space above short parts
in a layer, and the ragged ends of rows, are abandoned permanently — so on
heterogeneous part sets (exactly fit check's input) it typically achieves rough
50–70% fill, and a carton that genuinely holds everything can come back "couldn't
find a fit." ADR-0003's revisit trigger anticipated the fix: *"Greedy fit-check
produces wrong verdicts on real cartons → upgrade placement (extreme-point or
search-based) within tier 1/2."*

This ADR records the design direction ahead of that trigger firing, because the shape
of the upgrade was worked out in design discussion (2026-07-26) and two of its
conclusions are decisions worth pinning now, independent of when the build happens.

Extreme-point placement tracks candidate *positions*: each placed box spawns new
corner points, each new part is tried at every point in every orientation with a real
overlap check, scored by a rule such as deepest-bottom-left. Empty-maximal-spaces
(EMS) is the dual: track the set of largest empty *volumes*, split them as parts are
placed, place each part into the best-fitting space. Both recover the gaps shelf
abandons; EMS additionally knows exactly what free space remains, which can explain a
non-fit and tighten quantity-mode bounds. Both are O(n²)-ish with collision checks —
irrelevant at carton scale, in a worker.

## Decision

Two things are decided now; the rest is listed as open.

1. **The placement engine is not a user-facing choice.** Modes say what question is
   being asked; tiers say how hard to try. The tier ladder is the product's one
   quality axis (ADR-0003: ambition level is the user's choice — *one* dial), and a
   second "simple vs. smart placement" knob would ask users a question about
   algorithm internals they cannot answer, and make the tier labels conditional on a
   second setting. The upgrade lands *inside* tiers 1–2, invisibly, through the
   existing `FitStrategy` seam — tier 2 reuses the same placement on OBB dims, so
   both tiers inherit it at once.

2. **Greedy shelf is kept, permanently, not replaced.** Its simplicity — overlap-free
   by construction, no collision code to be wrong, O(n), deterministic — is
   infrastructure value, in three roles:
   - **Incumbent/floor**: every tier runs shelf first and returns the better result,
     so the new placer structurally cannot ship a worse answer than shelf
     (tier monotonicity, one level down). Under auto-run (ADR-0009) shelf's instant
     result can show while the better placer refines; the on-screen number only
     improves.
   - **Differential-test oracle**: shelf's placements are correct by construction,
     so fuzzing both engines over random part sets — asserting the new placer never
     places fewer, and its placements pass an independent overlap check — gives a
     generative counterpart to the `samples/` goldens.
   - **Crash barrier** (the role first drafted as "fallback", renamed because it is
     not a mode): EP/EMS is the first placement code that needs an overlap check —
     the first that *can* be wrong in that sense. If it throws, emits an invalid
     placement, or trips the operation backstop on a pathological part count, the
     incumbent's answer is still standing and the app answers exactly as it did
     before this ADR — never worse, which is the only regression a user would
     actually notice, since engines are invisible and nothing ever promised
     "extreme-point quality" by name. There are exactly two triggers: a defect in
     the new code, or absurd scale (tens of thousands of instances; realistic
     cartons are tens of parts and EP finishes in milliseconds). Either firing on a
     real carton is a defect to fix — guarded by the differential fuzz — not a UX
     to design.

3. **Extreme points place; EMS explains** (resolved 2026-07-26). EP is the placement
   algorithm. EMS bookkeeping is carried only for its reporting value — the "largest
   remaining void" explanation on a non-fit, and tighter quantity-mode bounds — not
   as a second placer. If its cost ever outgrows that reporting value, it is the
   part to cut (see revisit triggers).

4. **Quantity mode participates, with the grid as its incumbent** (resolved
   2026-07-26). The grid engine keeps the role shelf plays in fit check: it answers
   instantly (count by multiplication) and is the floor EP must beat. EP refines —
   mixed orientations, leftover-space placement — within the deterministic operation
   backstop, which in quantity mode does double duty: pathological-input guard *and*
   the bound on refinement cost, since placing tens of thousands of copies
   individually is real compute that multiplication is not. Worst case is exactly
   today's instant grid answer.

5. **No new loading UI.** The compute window grows only in quantity mode, and the
   existing lifecycle already covers it: "Packing…" on first run, previous result
   dimmed (`.stale`) with Save/Copy/Export disabled during a re-pack. Rendering is
   unchanged — worker-side math, instanced packed view, truncated layouts. If
   dogfooding shows the dimmed window reading as a hang, that is a tuning note for
   the backstop size, not a spinner requirement.

6. **No wall-clock budget.** A millisecond timeout makes the answer depend on
   machine load — same input, different result on a busy machine — violating this
   ADR's own determinism requirement. The backstop is a deterministic **operation
   count** (placements attempted / overlap tests), sized far above any realistic
   carton so the same input trips it identically every run. Anytime-with-a-clock
   semantics belong to tier 3 only (ADR-0023).

7. **EMS-backed result wording** (resolved 2026-07-26). Plain dimensional language,
   no algorithm vocabulary — "void", "EMS", and "extreme point" never reach the UI:
   - Non-fit explanation, appended to the unplaced summary:
     *"Largest free space: 120 × 80 × 40 mm — smallest orientation of `bracket`
     needs 150 × 60 × 30 mm."* Dimensions in the on-screen units like every other
     figure, sorted descending on both sides so the two triples compare by eye.
     Stated only when EMS data exists; never phrased as proof (the placement is
     still heuristic, so a cleverer arrangement might fit — this explains *this*
     attempt's stopping point).
   - Quantity-mode bound: *"47 fit (upper bound 54)"* — the achieved count first
     and authoritative, the bound parenthetical. The bound is the min of the
     volumetric and per-axis bounds, which ARE rigorous, so the phrasing may state
     it flatly. The gap between the two numbers is the honest signal of how much a
     better arrangement could recover.
   - Both lines travel with exports unchanged (ADR-0017: qualified on screen stays
     qualified in a quote).

## Open at build time (measurement questions, not decision questions)

- Scoring rule (deepest-bottom-left vs. best-fit-volume) and its interaction with the
  per-part orientation loop — settle with the differential fuzz on real parts.
- The operation backstop's number (kind is settled: deterministic count, never wall
  clock). It also bounds quantity-mode refinement (§4), so sizing it is a
  responsiveness decision, not only a safety one — measure, don't guess.

## Consequences

- Fit-check verdicts improve on heterogeneous assemblies without any UI change; the
  heuristic label (ADR-0003) stays, because extreme-point is still not a proof of
  non-fit.
- `core/packing/` gains its first placement code that needs an overlap check —
  the differential oracle exists precisely to guard it.
- Pure TypeScript in `core/`, worker-executed, no new dependency; ADR-0011 untouched.
- Determinism across re-runs is a requirement, not a nice-to-have: same inputs must
  give the same placement (stable orderings, no unseeded randomness).

## Alternatives considered

- **A user-facing engine toggle** ("simple vs. smart") — rejected: second dial on the
  same tradeoff the tiers already own; breaks the meaning of tier labels.
- **Replace shelf outright** — rejected: discards the by-construction-correct
  implementation that makes the clever one testable, and the instant incumbent that
  makes auto-run feel responsive.
- **Jump straight to tier-3 nesting instead** — rejected: placement upgrade is the
  larger accuracy gain per effort, benefits two shipped tiers, and tier 3 warm-starts
  from tier 2 anyway (ADR-0023), so better placement compounds rather than competes.

## Revisit triggers

- Accepted 2026-07-26 ahead of ADR-0003's dogfood trigger, as a deliberate call —
  the design resolved faster than the evidence would have arrived, and the upgrade
  benefits two shipped tiers regardless. Amend ADR-0003's fit-check placement
  description when this ships.
- If EMS bookkeeping proves heavier than the explanation feature justifies, ship EP
  alone and record the cut here.
- If dogfooding shows quantity-mode refinement rarely beating the grid on real
  parts, drop quantity mode back out (§4) rather than paying its compute for
  nothing — the grid incumbent makes that a one-line retreat.
