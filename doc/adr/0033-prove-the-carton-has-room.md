# ADR-0033: Prove the carton has room by packing without the cap, not by bounding

Date: 2026-09-03

Status: **Accepted 2026-09-03** (Proposed the same evening; the measurement in
the addendum is what moved it, and the second two-client dogfood is what made
it urgent — see the addendum)

Extends ADR-0029 (phase-2 amendments 2 and 3) and ADR-0022 §7. Supersedes
nothing: it adds the half of the answer amendment 2 could not reach.

## Context

Amendment 2 gave `binding.note` a rule it could keep: never assert anything
about the constraint it did not name unless a field establishes it. The field it
got was `geometryBound` — the rigorous bound with the weight term removed. That
proves one direction and only one:

- `geometryBound === count` → **the carton is full.** No arrangement anywhere
  fits another copy. Sound, because the bound dominates every arrangement.
- `geometryBound > count` → **nothing.** A bound is allowed to be loose, so a
  gap between it and the count could mean room exists, or could mean the bound
  is slack. It cannot distinguish them.

The second case is the common one, and it is the case the dogfooders cared
about. On the carton both 2026-09-03 sessions ran — an 11 × 6 × 10 in outer box
holding 180 × 150 × 20 mm plates — the true maximum is 3, and both readers
derived it in a paragraph: only one orientation is admissible (150 mm exceeds
the 88.9 mm usable axis), so the stack is one column, and 4 × 20 + 3 × 6.35 =
99.05 mm > 88.9. Our volumetric bound says 5. So the app goes silent —
*"whether the carton has room for one more is not established here"* — about a
question two independent readers answered from the same numbers, correctly,
without the engine's help.

Silence is honest and it is not good enough. The reader that found it named the
cost precisely: an engineer reads the count, is told the box is a third full,
sources a lighter plate to get more units per carton, and ships 3 forever. The
number was right and the reason was missing.

The Claude session also proposed the mechanism, and unlike its `upperBound`
suggestion (which amendment 3 records as refuted), this one is sound: **run the
same pack with the cap lifted and compare counts.** That is not a bound — it is
an arrangement, and an arrangement is a constructive proof.

## Decision

**1. On a weight-bound max-quantity answer, pack a second time with
`maxWeightG = Infinity` and compare.** Three outcomes, each with a different
epistemic status, and the prose says which:

| Space-only count | Means | What the note may say |
| --- | --- | --- |
| `> count` | An arrangement of more copies EXISTS and we hold it | "the carton would take N — the cap is what stops it" |
| `=== count` | Our search finds no more, without the cap in the way | "raising the cap does not change this count" — heuristic, and labelled |
| `< count` | Impossible; a bug | assert, do not narrate |

The first row is the new capability: a proof of room, in the direction
`geometryBound` structurally cannot reach. The second is weaker than the
rigorous tie and must never be dressed as one — it is our heuristic failing to
find a fourth, which is evidence, not proof. `geometryBound === count` remains
the only sentence entitled to say the carton is *full*.

**2. The comparison runs only where the question exists.** Max-quantity, weight
binding, and only when `geometryBound` has not already settled it. A fit-check
has no unit to replicate; a geometry-bound answer already knows the cap has
headroom by the engine's own arithmetic (amendment 2); a rigorous tie needs no
second opinion.

**3. It rides the same `pack()` the first answer used**, with one field changed.
No second engine, no cheaper approximation — an approximation would introduce a
third answer to the same question, and the whole point is that this one is
comparable to the first.

**4. The cost is stated where it is paid.** A qualifying estimate packs twice.
The second pack is the same tier as the first, so a thorough-tier max-quantity
estimate roughly doubles — bounded by the same ADR-0022 §5 operation backstop
that bounds the first. If that proves too slow in the app's auto-run, the
fallback is to compute it for the MCP surface and the export only, where a
caller is asking a question rather than typing. **That decision needs a
measurement, not a guess**, and the measurement is the first slice.

## Consequences

- **The note gains the sentence it has never been able to say**, and it says it
  with a placement behind it rather than a bound.
- **Two heuristic claims now share a payload**, and their difference has to
  survive wording: "no arrangement beats this" (rigorous, from the bound) and
  "raising the cap does not change this count" (heuristic, from a search).
  Collapsing them would undo amendment 2's whole rule.
- **Auto-run gets slower on exactly one path.** Fit-check is untouched;
  space-limited counts are untouched; weight-limited counts pay double.
- **A new way to be wrong appears**: if the two packs ever disagree for a reason
  other than the cap, the comparison is garbage. The unbounded pack must differ
  from the first in that one field and nothing else, and a test has to pin that
  by running both and diffing the requests.

## Alternatives considered

- **Tighten `geometryBound` instead.** The gap here is volumetric slack: 254 in³
  of window over 46.85 in³ of haloed plate gives 5 where 3 is true. A
  per-orientation feasibility bound would close this case — but bounds are
  proofs, and every improvement to one has to be proven against the validator's
  tolerances. ADR-0022's own history says what that costs: two adversarial
  refutations, one of them 922 crafted inputs. The rerun gets the same answer
  from machinery already trusted.
- **Say nothing, as today.** Rejected by the finding: the silence is where the
  wrong purchasing decision lives.
- **Ask the reader to do it.** They already did — twice, correctly. An engine
  that leaves its most quotable sentence to the reader's arithmetic is an engine
  that will be quoted wrongly by the reader who does not do it.
- **Report the space-only count as a plain field with no prose.** Tempting and
  half-adopted: the field ships either way. But a bare number invites exactly
  the guessing amendment 3 was written about, so the note has to interpret it.

## Addendum, 2026-09-03 (acceptance): the measurement, and what the second dogfood added

**The measurement.** A whole `estimate` round-trip on the plate case at the
thorough tier — STEP already parsed, pack, report assembly, in-memory
transport — is 150–250 ms on the development machine; the fused whole-file
unit is the same. The second pack is a fraction of that, and it runs only on a
weight-bound max-quantity count the geometry bound did not already settle. So
the split this ADR's revisit trigger reserved for — wire and exports only, the
panel keeping its silence — is not needed: the rerun lives in `pack()` itself,
and every consumer gets the answer.

**What the second dogfood added**, and it changes how this ADR should be read.
Both clients, on the same build, found that at 35 lb the app said *"whether the
carton has room for one more is not established here"* while at 100 lb — same
carton, same tier, same everything — it said *"the carton stopped this at 3."*
The app was not lacking a capability; it was declining to use one it already
had, one call away. That is an internal inconsistency, not a gap, and it is the
sentence an engineer would be shown after specifying a lighter alloy to get a
fourth plate that does not exist.

**Amendments to the Decision, from building it:**

1. **The evidence kind is a field.** `otherConstraint` gains
   `evidence: 'bound' | 'arrangement' | 'arithmetic' | 'search'`. The
   Consequences above said the two heuristic claims "have to survive wording";
   rule 3 of ADR-0029's phase-2 addendum says a qualification is never prose
   only, and the revisit trigger below already knew what happens when a reader
   promotes a search to a proof. So the distinction is structural from the
   first day rather than after the first conflation.
2. **`spaceOnlyCount` ships on the wire** beside the two bounds, as
   `Known<{count}>` — absent with its reason when the question did not arise
   (space bound the count; the geometry bound already settled it; no finite
   cap to lift).
3. **The wording moved to the shared module.** `bindingReport` now lives in
   `packing/verdict.ts` beside the caption, because the exports were writing
   "Limited by: weight" flat beside an answer the MCP layer refused to make.
   Three consumers, one sentence — the reason ADR-0017 built that module.
4. **The `known: false` reason stopped asserting possibility.** "The carton
   might hold as many as 5" claimed room from a number that only fails to
   exclude it; both readers disproved 4 by hand. It now says the bound is a
   ceiling, not a placement.

**On the plate case specifically**, the answer is now: *"The weight cap stopped
this at 3, and lifting the cap does not change the count — the carton stops it
at 3 as well, as far as this search can tell."* That is the second row of the
table above, labelled `search`, and it is deliberately weaker than what both
readers proved by hand — because what they did was a proof over one
orientation, and what the engine did was a search. The first row, where the
rerun places *more*, is the constructive claim this ADR was written for, and
it is what a roomy carton now gets instead of silence.

## Addendum 2, 2026-09-04 (fourth dogfood): the cap that does not bind

The rerun is gated on `winner.binding === 'weight'` (`pack.ts:395`), which was
the whole point — a rerun with no cap to lift is a wasted pack. The fourth
dogfood found the cost of that gate, and it is the sentence this ADR was
written against, aimed the other way.

Same carton, same part, same clearances, same tier. At a 35 lb cap:
`spaceOnlyCount: {known: true, count: 3}`. At a 100 lb cap on the identical
geometry: `spaceOnlyCount: {known: false, reason: "not asked — the carton, not
the cap, stopped this count"}`. The reader's objection is that the second reply
is *less* informative about the carton than the first, at exactly the cap where
the carton is the only thing that matters.

And the answer is free. When the cap did not bind, the count already IS the
space-only count: the capped count is `min(geometry, weight)` and the cap
allowed at least as many as space did, so removing it cannot place fewer — the
same argument the clamp on line 401 rests on. No second pack is needed; the
field is `known: true, count` with the run itself as its evidence, and the
`reason` string that exists today is answering a question nobody asked.

**Shipped 2026-09-04**, the same day it was found. The gate keeps its
optimisation and loses its silence: the rerun still runs only where a rerun can
change something, and the geometry-bound branch now sets `spaceOnlyCount` to
the count in hand. One `else if`, no second pack, no new field.

The gate was never wrong, only incomplete — it asked *is a rerun needed to
answer this?* when the question was *is the answer available?*

**What did NOT change, deliberately.** The `evidence` taxonomy is untouched.
`otherConstraint` consults `spaceOnlyCount` only on a weight-bound count, so a
geometry-bound run's new value reaches no sentence — and that is the point:
nothing was searched a second time here, so nothing may be labelled `search`.
Had the field fed the wording layer, "the run itself" would have needed a word
the taxonomy does not have, and that would have been a larger decision than
this one.

**One case still answers `known: false`**, and it is the case where a stronger
field already answers: a weight-bound count whose `geometryBound` meets it.
That equality proves the carton full over *every* arrangement, which is more
than any rerun could return, so the reason now names the field to read instead
of describing a rerun that did not happen. The rule the field follows is
therefore "present whenever the answer is available", not "present whenever a
rerun ran" — which is what a reader was entitled to assume all along.

Pinned by `tests/packing-quantity-bound.test.ts` (both caps side by side, plus
a sweep asserting `spaceOnlyCount >= count` at six caps) and
`tests/mcp-qualifications.test.ts` on the wire. Mutation-tested: disabling the
new branch fails three specs, two of them at the wire.

## Revisit triggers

- **If the measurement says the second pack is not affordable in auto-run**,
  this ADR splits: the field and the sentence ship on the MCP surface and the
  exports, and the panel keeps today's silence until the engine is faster.
- **If `geometryBound` is ever tightened** to the point where it settles the
  common cases on its own, the rerun becomes redundant for those and should be
  gated behind the bound rather than run beside it.
- **If a session reports the two sentences being conflated** — a reader treating
  "raising the cap does not change this" as a proof — the wording failed and the
  distinction needs to become structural, the way `bound` and `otherConstraint`
  did before it.
