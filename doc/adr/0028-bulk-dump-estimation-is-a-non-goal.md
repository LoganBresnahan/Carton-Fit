# ADR-0028: Bulk-dump estimation is a non-goal — documented so it stays a decision, not an omission

Date: 2026-09-01
Status: Accepted

## Context

Users began asking (2026-09-01) about Carton Fit and Claude AI after a shared claude.ai
conversation in which a packaging engineer asked, of a real STEP casting (a ⊥-shaped
ribbed plate, 14.4% solid within its own bounding box), "can I bulk pack this part into
this gaylord?" — meaning parts *poured in loose*, landing in random orientations, rather
than placed by hand. Bulk dump is a real and common shipping method (zero labor per
part), and it is the one question in that conversation Carton Fit does not answer.

The conversation is also the best evidence available for *why* it doesn't. Claude's
deterministic geometry (bounding box, volume, stack pitch, ordered layer counts) held
up across three verification passes. Its bulk number did not: 4,600–6,275 parts, then
1,300–1,900, then 2,000–3,000 — three different answers, each stated confidently, the
first one *above the perfect-stacking ceiling* its own geometry implied. Its final
advice was correct and damning: "do not put my bulk figure on a packaging spec…
count 200 parts, dump them, measure the height."

The underlying fact: how randomly tumbled parts settle has no deterministic answer.
Geometry gives a rigorous **ceiling** (a random pile cannot beat a perfect ordered
stack for a part that doesn't nest) and the convex hull gives a defensible basis for a
*range*, but the number itself depends on how parts bridge and tangle — physics the
app cannot compute, only simulate expensively or measure cheaply.

## Decision

Carton Fit does not compute bulk-dump quantities. Every number the app states is one
it can stand behind (ADR-0020's promise; ADR-0022's upper bound is the model), and a
bulk count is structurally not such a number. VISION's non-goals list is amended so
this reads as a decision rather than a gap.

If bulk support is ever built, its acceptable shape is pre-decided here:

- an explicitly **labeled estimate range**, never a single figure — floor and ceiling
  derived from the part's own geometry (hull-based random-packing fraction below, the
  ordered-pack count as the hard ceiling), with the binding-constraint and warning
  conventions (ADR-0004, ADR-0015) intact;
- paired with **fill-trial guidance**: dump a counted sample, measure the height,
  extrapolate — and, as the genuinely useful version, let the user *enter* the trial
  measurement so the app stores a measured packing fraction per part and the estimate
  becomes data. Measurement entry is honest where computed physics is not.

## Consequences

- VISION.md gains a non-goals bullet citing this ADR.
- Any future AI-facing surface (ADR-0029) inherits this: the engine's answers to a
  bulk question are the ceiling, the hull, and "run a fill trial" — not a count.

## Alternatives considered

- **Packing-fraction heuristic as a computed answer** — rejected: the motivating
  transcript is a live demonstration of the failure mode, including a generic
  heuristic exceeding the geometric ceiling for a mostly-air part.
- **DEM / physics simulation of the dump** — rejected: a heavy dependency (ADR-0011)
  and a validation burden for a number a twenty-minute physical trial beats.
- **Silence** (leave it undocumented) — rejected: the question is now known to be
  asked, so an undocumented gap would be re-litigated from scratch.

## Revisit triggers

- Users asking for bulk numbers *from the app or its AI surface* (not just from
  Claude) with enough frequency that the estimate-range-plus-fill-trial shape above
  would earn its UI.
- A user actually running fill trials and wanting somewhere to keep the measured
  fractions — the measurement-entry half can ship without the estimation half.
