import { EPS } from '../core/geometry'
import type {
  BindingConstraint,
  MaxQuantityResult,
  PackRequest,
  PackResult,
  Vec3
} from '../core/packing/types'
import { lengthUnitLabel, type UnitSystem } from '../core/units'
import { decimal, dimsText } from '../export/format'
import { kindOf } from './kinds'
import type { ApproximateVolumes } from './request'

// Result presentation (roadmap item 4). Lives on the RENDERER side, not in
// core/packing, because it is presentation rather than engine math — and
// because a component importing core/packing/pack.ts would pull the whole
// engine graph (hull search, strategies) into the main-thread bundle, defeating
// the worker boundary. This module imports engine TYPES only — plus the unit
// boundary and `export/format`'s number formatting, which depend on nothing in
// packing, so there is no cycle and no second spelling of "120 × 80 × 40".

/**
 * The heuristic labeling ADR-0003 mandates. The epistemic direction differs by
 * outcome, and the wording carries it precisely:
 *  - a POSITIVE result (parts fit / N copies placed) is a constructive proof —
 *    we hold a concrete, overlap-free arrangement;
 *  - a NEGATIVE or count result understates: a cleverer arrangement might place
 *    the unplaced parts, or fit more copies. That is the claim the ADR forbids
 *    presenting as certain.
 */
/**
 * @param unitPartName which part a max-quantity count replicated — `null`
 *   for the whole file as one unit, which is the one case the count had no
 *   noun for (11th dogfood: a preset changed the unit under a reader and
 *   "1 fit" named nothing, where "3 fit · of plate" names the plate).
 *   `undefined` means the caller does not know, and the sentence stays as it
 *   was rather than guessing.
 */
export function verdictCaption(result: PackResult, unitPartName?: string | null): string {
  if (result.mode === 'fit-check') {
    const total = result.placements.length + result.unplaced.length
    if (result.fits) {
      return total === 0
        ? 'Nothing to pack.'
        : `All ${total} part${total === 1 ? '' : 's'} fit — a concrete arrangement was found.`
    }
    return (
      `${result.placements.length} of ${total} parts placed; ${result.unplaced.length} ` +
      `did not fit. Heuristic placement — not a proof the rest cannot fit.`
    )
  }
  // "both limits" exactly when the binding note says both land (19th dogfood):
  // the caption and the note are read together, and were disagreeing.
  const limit = bothLimitsProven(result.binding, result.count, result.geometryBound)
    ? 'both limits'
    : result.binding === 'weight'
      ? 'weight-limited'
      : 'space-limited'
  // The noun, when the unit is the whole file: "1 fit" of what? A chosen part
  // is named beside the count everywhere else (the picker, the receipt); the
  // whole file as one unit was named nowhere.
  const noun = unitPartName === null ? ' — the whole file as one unit' : ''
  // A ZERO NAMES ITS LIMIT LIKE EVERY OTHER COUNT (2026-09-04, 6th dogfood).
  //
  // "in this carton" is a claim about SPACE, and this branch used to make it
  // without consulting the space bound — so a cap of 35 lb against a hand-typed
  // 40 lb part printed a verdict about the carton while `geometryBound: 3` in
  // the same payload said the carton takes three. The reader found it in an
  // EXPORT, two lines above a binding note that contradicted it, and named the
  // cost exactly: someone reading it buys a bigger carton, and a bigger carton
  // still holds zero.
  //
  // So the carton claim is now licensed by the bound that can back it, and
  // every other zero borrows the same `limit` word its non-zero siblings use.
  // Absent bound keeps the old sentence rather than sharpening: no bound
  // establishes nothing, and "weight-limited" would be the same unbacked move
  // in the other direction.
  if (result.count === 0) {
    const cartonTakesNone = result.geometryBound === undefined || result.geometryBound === 0
    return cartonTakesNone ? 'None fit in this carton.' : `None fit (${limit}).`
  }
  const count = result.count.toLocaleString()
  // THE HEDGE IS DROPPED WHEN THE BOUND SAYS IT IS FALSE (2026-09-03 dogfood).
  //
  // "a mixed arrangement may fit more" beside `upperBound: 3` and `count: 3` is
  // a payload arguing with itself, and the reader that found it was being sent
  // to look for a fourth unit the same reply had already ruled out. The bound is
  // rigorous under the limits as given — that is exactly what makes it able to
  // retire the hedge — so when the count meets it, the answer is optimal and
  // says so instead. `upperBoundLabel` below has always described this case
  // ("when they meet, the answer is optimal"); this line is that sentence
  // finally being true of the caption too.
  //
  // NOT `>=` out of caution: `pack()` clamps the bound up to the count, so they
  // can only ever meet, never cross. Written as a meeting because a bound below
  // its count would be a bug elsewhere that this must not paper over.
  const atBound = result.upperBound !== undefined && result.upperBound === result.count
  if (atBound) {
    // "At least" would be true and misleading — it invites a search that cannot
    // succeed. The limits are named because optimality is relative to THEM: a
    // bigger carton or a higher cap is still a different question.
    return `${count} fit${noun} (${limit}) — no arrangement beats this under these limits.`
  }
  return `At least ${count} fit${noun} (${limit}). Heuristic — a mixed arrangement may fit more.`
}

/**
 * The bound that travels with a count (ADR-0022 §7): `47 fit (upper bound 54)`,
 * the achieved count first and authoritative, the bound parenthetical.
 *
 * Stated flatly, with no hedge, because unlike the count it is NOT a heuristic —
 * `quantityBound` derives it from volume, per-axis and weight limits that no
 * arrangement can beat. The gap between the two numbers is the honest measure of
 * how much a cleverer arrangement could still recover; when they meet, the answer
 * is optimal and the two identical numbers say so.
 *
 * Null when the result carries no finite bound (a weightless zero-extent unit),
 * never a guess.
 */
export function upperBoundLabel(result: PackResult): string | null {
  if (result.mode !== 'max-quantity' || result.upperBound === undefined) return null
  // The bound folds the weight cap in (ADR-0017 addendum 3 said so in the
  // CSV's rows; the 13th dogfood read *2 fit (upper bound 2)* beside a
  // sentence saying the carton takes 3 and called it a contradiction). When
  // the cap is what stopped the count, the label says the bound is under it.
  const underCap = result.binding === 'weight' ? ' under the cap' : ''
  return `upper bound ${result.upperBound.toLocaleString()}${underCap}`
}

/** Extents descending, so two triples compare by eye down the line (ADR-0022 §7)
 *  instead of the reader having to match axes that mean nothing here — the
 *  engine's x/y/z is its own placement choice, not a property of the part. */
function descending(extent: Vec3): Vec3 {
  const e = [...extent].sort((a, b) => b - a)
  return [e[0], e[1], e[2]]
}

/** Would a part of extents `need` go into a space of dims `space`, in SOME axis
 *  assignment? Comparing both sorted descending is exactly that test. */
function wouldFit(need: Vec3, space: Vec3): boolean {
  const a = descending(need)
  const b = descending(space)
  for (let axis = 0; axis < 3; axis++) {
    if (a[axis] - b[axis] > EPS) return false
  }
  return true
}

/** The two triples behind the non-fit explanation, sorted for presentation, with
 *  the comparison gate already applied — or null when there is nothing honest to
 *  report. Separate from the sentence because the CSV states the same facts in
 *  its own Field,Value shape and must not re-derive them. */
export interface FreeSpaceReport {
  /** Largest usable free space left by this arrangement, descending. */
  spaceMm: Vec3
  /** The smallest leftover part, present only when it genuinely would not go
   *  into that space. */
  need?: { name: string; extentMm: Vec3 }
}

/**
 * The EMS-backed non-fit explanation (ADR-0022 §7), or null when it has nothing
 * to say.
 *
 * THE GATE IS THE SUBTLE PART. The engine reports the smallest leftover part as
 * data, whether or not it would have fit the space; pairing the two triples only
 * makes sense when it would NOT. On a weight-bound non-fit the leftovers usually
 * fit the space perfectly well — the cap stopped them, not the geometry — and
 * printing "largest free space 250 × 180 × 100 — smallest orientation of bolt
 * needs 8 × 8 × 5" invites the reader to conclude the app cannot do arithmetic.
 * The free space alone is still worth saying there: it is true, and next to a
 * weight binding it reads correctly as "there is room, the scale stopped you".
 */
export function freeSpaceReport(result: PackResult): FreeSpaceReport | null {
  if (result.mode !== 'fit-check' || result.fits) return null
  const space = result.largestFreeSpace
  if (space === undefined) return null

  const report: FreeSpaceReport = { spaceMm: descending(space) }
  const smallest = result.smallestUnplaced
  if (smallest !== undefined && !wouldFit(smallest.extentMm, space)) {
    report.need = { name: smallest.name, extentMm: descending(smallest.extentMm) }
  }
  return report
}

/**
 * The non-fit explanation as a sentence, in the on-screen units like every other
 * figure — *"Largest free space: 120 × 80 × 40 mm — smallest orientation of
 * “bracket” needs 150 × 60 × 30 mm."*
 *
 * Two numbers side by side and no verdict between them, deliberately: placement
 * is heuristic (ADR-0003), so a cleverer arrangement might still fit the part,
 * and any phrasing that concluded something — "too small", "cannot fit" — would
 * be a proof of non-fit the engine did not produce. It explains where THIS
 * attempt stopped, and the caption above it already says that is not the last
 * word.
 */
export function freeSpaceNote(result: PackResult, units: UnitSystem): string | null {
  const report = freeSpaceReport(result)
  if (report === null) return null
  const unit = lengthUnitLabel(units)
  const space = `Largest free space: ${dimsText(report.spaceMm, units)} ${unit}`
  if (report.need === undefined) return `${space}.`
  return (
    `${space} — smallest orientation of “${report.need.name}” needs ` +
    `${dimsText(report.need.extentMm, units)} ${unit}.`
  )
}

/** Short headline: the answer itself, before any qualification. */
export function verdictHeadline(result: PackResult): string {
  if (result.mode === 'fit-check') return result.fits ? 'Fits' : "Doesn't fit"
  return result.count.toLocaleString()
}

/**
 * The heading over the binding label. On a fit where everything was placed
 * nothing bound, and "Limited by" would claim a stop that never happened —
 * the constraint shown is the one with the least headroom (extremePointFit's
 * convention). Caught by an AI client on first contact (ADR-0029, 2026-09-02).
 */
export function bindingHeading(result: PackResult, request?: PackRequest | null): string {
  if (result.mode !== 'fit-check' || !result.fits) return 'Limited by'
  // "Closest limit" is a superlative, and on a space-only fit there is one
  // candidate (19th dogfood): no weight was given, or no cap applied, so only
  // space could have limited it. Say that, in the words the note beside it
  // uses. Without the request the heading cannot tell, and keeps the general form.
  if (request && (weightless(request) || !(Number.isFinite(request.maxWeightG) && request.maxWeightG > 0))) {
    return 'Only limit'
  }
  return 'Closest limit'
}

/**
 * The tie, from the three facts that prove it: a weight-bound count that the
 * geometry bound MEETS is full over every arrangement, so both limits landed.
 *
 * One predicate for the caption, the binding note and the receipt row (19th
 * dogfood, rule 5): the note said "Both limits land on 3" two lines under a
 * caption that said "(weight-limited)", and the caption is the CSV's *Result
 * note* — the line an engineer lifts into a quote alone, where "weight-limited"
 * invites a lighter alloy that buys nothing against 3.5 in of stack. The
 * receipt row had derived the same tie on its own since the 11th dogfood;
 * three copies of one claim is how the third drifts. Primitive arguments
 * because the receipt row reads untyped JSON from whatever build saved it.
 */
export function bothLimitsProven(
  binding: unknown,
  count: number | null | undefined,
  geometryBound: number | null | undefined
): boolean {
  return (
    binding === 'weight' &&
    count !== null &&
    count !== undefined &&
    geometryBound !== null &&
    geometryBound !== undefined &&
    geometryBound <= count
  )
}

/** Which hard constraint bound the result — ADR-0004 requires stating it. */
export function bindingLabel(binding: BindingConstraint): string {
  return binding === 'weight' ? 'weight' : 'space'
}

/**
 * What the constraint that did NOT get named was doing, with the KIND of
 * evidence behind the claim — because two of the four answers below are
 * proofs and one is a search, and a reader who cannot tell them apart will
 * repeat the search as a proof (ADR-0033's revisit trigger, pre-empted).
 *
 *   bound        the rigorous geometry-only bound meets the count: no
 *                arrangement anywhere fits another copy. A proof.
 *   arrangement  we HOLD a placement that settles it — more copies with the
 *                cap lifted (room exists), or everything placed under the cap
 *                (nothing bound). A proof, constructive.
 *   arithmetic   the weight side: a cap and a set of masses, exact either way.
 *   search       the same search, cap lifted, found no more. Honest evidence
 *                that the carton stops it too, and NOT a proof — worded as one
 *                it would be the sentence amendment 2 removed, back again.
 */
export type OtherConstraint =
  | {
      known: true
      atLimit: boolean
      evidence: 'bound' | 'arrangement' | 'arithmetic' | 'search'
    }
  | { known: false; reason: string }

export interface BindingReport {
  constraint: BindingConstraint
  /** Whether that constraint actually STOPPED anything. False on a fit where
   *  everything was placed: `constraint` is then the one with the least
   *  headroom, which is useful, and `note` says so instead of claiming a stop
   *  that never happened. */
  bound: boolean
  otherConstraint: OtherConstraint
  note: string
}

/** True when the request carried no weight at all — every part weightless.
 *  Derived from the request rather than the settings so this module needs no
 *  settings: a weight of zero on every part IS "no weight was given". */
export function weightless(request: PackRequest): boolean {
  return request.parts.every((part) => part.weightG === 0)
}

/**
 * The sentence for a pack that carried no weight at all — the panel, both
 * exports and the wire's `weightInput.note` read this one function (15th
 * dogfood: the wire said `supplied: false` while the summary export printed
 * *0 lb per part, entered directly* and the panel said the cap had room to
 * spare — three surfaces asserting a measurement nobody made, in the artifact
 * built for quotes). Null when a weight was given.
 */
export function weightlessWarning(request: PackRequest): string | null {
  if (request.parts.length === 0 || !weightless(request)) return null
  return (
    'No part weight was given: every part was packed as weightless, so the weight cap ' +
    'could not bind and no packed weight here is a measurement. This answer is about space only.'
  )
}

function otherConstraintOf(
  result: PackResult,
  request: PackRequest,
  capApplies: boolean
): OtherConstraint {
  if (result.binding === 'weight') {
    if (result.mode !== 'max-quantity') {
      return {
        known: false,
        reason:
          'a fit-check packs a mixed set of parts, and no rigorous bound exists for how ' +
          'tightly that set could be made to sit — so whether the carton also ran out is open'
      }
    }
    // Proof first: a rigorous bound meeting the count needs no search.
    if (bothLimitsProven(result.binding, result.count, result.geometryBound)) {
      return { known: true, atLimit: true, evidence: 'bound' }
    }
    // Then the arrangement (ADR-0033): the same search with the cap lifted.
    //
    // UNCONDITIONAL SINCE ADR-0033 ADDENDUM 3, and this is where a pair of
    // `known: false` branches used to sit — "no finite bound exists…" and "the
    // space-only bound is N, which is a ceiling and not a placement". Both are
    // gone because both were ALREADY unreachable from the engine: they
    // described a weight-bound count with no space-only answer, and the rerun
    // ran in exactly that case. Making the field total only proved it. The
    // sentence they were fixing is still pinned — as the `arrangement` branch
    // below, which reports the placement instead of the ceiling, which is what
    // the two readers who disproved "might hold as many as" by hand were owed.
    return result.spaceOnlyCount > result.count
      ? { known: true, atLimit: false, evidence: 'arrangement' }
      : { known: true, atLimit: true, evidence: 'search' }
  }
  if (!capApplies) return { known: false, reason: 'no weight cap was supplied' }
  // With no weight given the cap "had room" against a zero that is an absent
  // input, not a measurement (15th dogfood). Whether the cap WOULD have bound
  // is not established, and that is the honest field.
  if (weightless(request)) return { known: false, reason: 'no part weight was given' }
  if (result.mode === 'max-quantity') {
    // The engine's own label carries this: it says 'geometry' exactly when the
    // weight cap allows strictly more copies than the carton does
    // (quantityGrid.ts — a tie reports 'weight'). So the cap has headroom by
    // construction, and no second derivation is needed to say so.
    return { known: true, atLimit: false, evidence: 'arithmetic' }
  }
  // Fit-check: every part, placed or not, would have to come in under the cap
  // for space to be the only thing in the way. Exact, so it is stated either way.
  const total = request.parts.reduce((sum, part) => sum + part.weightG, 0)
  return { known: true, atLimit: total > request.maxWeightG, evidence: 'arithmetic' }
}

/**
 * Which constraint bound, whether it BOUND AT ALL, what the other one was doing,
 * and a sentence that claims exactly as much as those fields establish.
 *
 * Lives HERE, beside the caption, because it has three consumers — the panel,
 * both exports and the MCP reply — and it spent its first two days in the MCP
 * layer alone, while the exports wrote "Limited by: weight" flat beside an
 * answer the wire refused to make (2026-09-03, both clients). One module, one
 * wording, is what ADR-0017 built this file for.
 *
 * The core's `binding` is deliberate: when everything is placed it names the
 * constraint with the least headroom (extremePointFit.ts). ADR-0029's phase-2
 * amendments are the history of every sentence below being wrong in turn —
 * "stopped" for "closest", "there is room left" for "not checked", "might hold
 * as many as 5" for "a bound of 5" — and the rule they converged on: no claim
 * about the constraint not named without a field that establishes it.
 */
export function bindingReport(result: PackResult, request: PackRequest): BindingReport {
  const bound = result.mode === 'max-quantity' || !result.fits
  const capApplies = Number.isFinite(request.maxWeightG) && request.maxWeightG > 0
  if (bound) {
    const other = otherConstraintOf(result, request, capApplies)
    const count = result.mode === 'max-quantity' ? result.count : null
    const at = count !== null ? ` at ${count.toLocaleString()}` : ''
    let note: string
    if (result.binding === 'weight') {
      if (other.known && other.atLimit && other.evidence === 'bound') {
        // Weight first, because `constraint` names the closest limit
        // (amendment 1); but as the FACT each limit establishes, not "the
        // weight cap stopped it" — two readers (20th, 21st runs) read that
        // verb as causal-exclusive and asked whether a bigger cap would ship
        // more. A fourth would exceed the cap AND would not fit; each limit
        // alone forbids it, which is what a tie is (amendment 25).
        note =
          `Both limits land on ${count !== null ? count.toLocaleString() : 'this answer'}: ` +
          'one more would exceed the weight cap, and no arrangement fits another one in the carton either.'
      } else if (other.known && other.atLimit) {
        // 'search': evidence, labelled as such, never dressed as the proof above.
        note =
          `The weight cap stopped this${at}, and lifting the cap does not change the count — ` +
          `the carton stops it${at} as well, as far as this search can tell.`
      } else if (other.known && result.mode === 'max-quantity') {
        note =
          `The weight cap stopped this${at} — the carton itself would take ` +
          `${result.spaceOnlyCount.toLocaleString()}: that many were placed with the cap lifted.`
      } else {
        note =
          `The weight cap stopped this${at}. Whether the carton has room for one more is ` +
          'not established here.'
      }
    } else if (other.known && other.atLimit) {
      note =
        'The carton stopped this — and the weight cap would have too: the parts together ' +
        'weigh more than the cap allows.'
    } else if (other.known) {
      note = `The carton stopped this${at}, not the weight cap — the cap has room to spare.`
    } else if (weightless(request) && capApplies) {
      note =
        `The carton stopped this${at}. No part weight was given, so whether the cap would ` +
        'have is not established.'
    } else {
      note = `The carton stopped this${at}; no weight cap applied.`
    }
    return { constraint: result.binding, bound: true, otherConstraint: other, note }
  }
  // ONE formatter for a share (17th dogfood): this sentence printed 3.1%
  // beside a Fill row that printed 3%, and the exports lost the digit in the
  // direction of looking emptier. `utilizationPercent` is what every surface
  // shows, so it is what this sentence says too.
  const pct = utilizationPercent
  const placed = result.placements.length
  const fill = pct(result.utilization)
  let note: string
  if (!capApplies) {
    note = `Nothing bound — all ${placed} parts placed, filling ${fill} of the carton; no weight cap applied.`
  } else if (weightless(request)) {
    // Three sessions flagged "Space is the closer limit" here: with no weight
    // given, the 0% it ranks against is an absent input, not a measurement.
    note =
      `Nothing bound — all ${placed} parts placed, filling ${fill} of the carton. ` +
      'No part weight was given, so only space could have limited this.'
  } else {
    // No ranking sentence (decided 2026-09-14, ADR-0029 amendment 25, after
    // readers on the 17th and 20th runs): "Weight is the closer limit"
    // compared a weight share to a bounding-box fill — two scales, one of
    // which cannot reach 100% — and drew a conclusion across them. The two
    // shares stand; `constraint` still names the closest limit on the wire,
    // and a reader who wants the ranking has both numbers in this sentence.
    note =
      `Nothing bound — all ${placed} parts placed at ${pct(packedWeightG(result, request) / request.maxWeightG)} ` +
      `of the weight cap and ${fill} of the carton.`
  }
  // Nothing stopped the pack, so neither limit is at its limit — and that IS
  // knowable here. The evidence names the side it is about (2026-09-04, a
  // reader filtering on evidence found a weight fact labelled 'arrangement'):
  // when the closest limit is weight the OTHER is space, settled by the
  // arrangement we hold; when it is space the other is weight, settled by
  // packed weight against the cap — arithmetic.
  // …except when no weight was given (15th dogfood): "the cap has room" is
  // then an arithmetic against an absent input, and the honest field is that
  // the weight side is not known.
  return {
    constraint: result.binding,
    bound: false,
    otherConstraint:
      capApplies && weightless(request)
        ? { known: false, reason: 'no part weight was given' }
        : {
            known: true,
            atLimit: false,
            evidence: result.binding === 'weight' ? 'arrangement' : 'arithmetic'
          },
    note
  }
}

/**
 * WHAT A FILL PERCENTAGE IS A SHARE OF — in one place, in the three spellings
 * its four surfaces need (2026-09-04, 6th dogfood).
 *
 * The number is bounding-box based: air trapped inside a part's box is not
 * usable by another part, so the box is what packing consumes. That is a real
 * qualification — on the reference plate the box is 32.95 in³ against 32.38 in³
 * of enclosed mesh, and the CSV prints BOTH of those volumes in its own rows
 * while its Fill silently uses one of them.
 *
 * It was disclosed on the wire (`basis`), on the panel (a hover tooltip), and
 * nowhere at all in the two exports — which are the artifacts that get pasted
 * into a quote, where nobody can hover and the wire is not present. A reader
 * called that out as a qualification the screen makes and the quote drops.
 * Every neighbouring CSV row names its unit; this one named nothing.
 *
 * One definition, three renderings: `token` is the wire's enum (kebab, pinned
 * by a zod literal), `label` is what a person reads, `note` is the sentence
 * behind the panel's tooltip.
 */
export const UTILIZATION_BASIS = {
  // The WIRE token cannot change: it is pinned by a zod literal, and changing
  // a value a client matches on is a break under ADR-0020 §3. It names the
  // numerator, which is what it always named.
  token: 'bounding-boxes',
  // The human halves name BOTH ENDS since the 8th dogfood. `basis:
  // "bounding boxes"` shipped for the 6th run and described the numerator
  // alone, so "34.3% full" still invited "65.7% still usable" — and the
  // denominator is the carton INTERIOR, not the clearance-reduced space a part
  // can actually reach. On the reference plate that is 288 in³ against
  // 223.125 in³, so the honest remaining-usable figure was 43%, not 65.7%.
  // Fixing the label rather than the number: the interior is the right
  // denominator for "how full is the box", and deducting clearances would make
  // the fill of an empty carton depend on a setting.
  label: 'part bounding boxes ÷ carton interior',
  note: 'Share of the carton interior filled by part bounding boxes — clearances are not deducted'
} as const

/** Whose boxes the fill counts (11th dogfood, 2026-09-08). */
export type UtilizationOf = 'parts' | 'unit-part' | 'whole-file'

/**
 * The fill's numerator, named for the mode that produced it.
 *
 * ONE LABEL COVERED TWO QUANTITIES (11th dogfood): fit-check sums the boxes of
 * every part placed, but max-quantity replicates a UNIT — one chosen kind, or
 * the whole file composed into one rigid block (`composeUnit`) — and reports
 * count × that unit's box. With no unit part, the block's box holds every
 * part AND the air between them, so the same eighteen parts in the same
 * carton read 25.8% in one mode and 53.4% in the other, both labelled "part
 * bounding boxes". The wire token stays (ADR-0020 §3); this names whose.
 */
export function utilizationBasis(
  mode: PackResult['mode'],
  unitPartName: string | null
): { of: UtilizationOf; label: string; note: string } {
  if (mode === 'max-quantity' && unitPartName === null) {
    return {
      of: 'whole-file',
      label:
        'whole-file bounding box ÷ carton interior — every part as one unit and the air between them counted',
      note:
        'Share of the carton interior filled by the whole file’s bounding box — all parts as one rigid unit, so the air between them is counted; clearances are not deducted'
    }
  }
  if (mode === 'max-quantity') {
    return {
      of: 'unit-part',
      label: `${unitPartName} bounding boxes ÷ carton interior`,
      note: `Share of the carton interior filled by ${unitPartName} bounding boxes — clearances are not deducted`
    }
  }
  return { of: 'parts', label: UTILIZATION_BASIS.label, note: UTILIZATION_BASIS.note }
}

/** Carton fill as a percentage. See `UTILIZATION_BASIS` for what it is a share
 *  of — the number alone does not say, and for two builds nothing else did
 *  either once it reached an export. */
export function utilizationPercent(utilization: number): string {
  const pct = utilization * 100
  // One decimal, trailing zero trimmed (21st dogfood): a whole percent printed
  // 1.66% as "2%", a fifth over at exactly the fill a quote reads. The wire's
  // own `percent` string read this function from the same day (item 44), so
  // every spelling of the share is one call.
  return pct > 0 && pct < 0.05 ? '<0.1%' : `${decimal(pct, 1)}%`
}

/**
 * Total packed weight in grams — what the user's max-weight cap is actually
 * being spent on (ADR-0004 makes weight a hard constraint, so a cap with no
 * running total is a limit you cannot steer by).
 *
 * Derived from the request's per-part weights rather than carried on the result:
 * in max-quantity the count can exceed the materialized placements
 * (MAX_GRID_PLACEMENTS), so summing placements would under-report the very
 * number the cap is judged against.
 */
export function packedWeightG(result: PackResult, request: PackRequest): number {
  if (result.mode === 'max-quantity') {
    const unitWeight = request.parts.reduce((sum, part) => sum + part.weightG, 0)
    return result.count * unitWeight
  }
  const weightByName = new Map<string, number>()
  for (const part of request.parts) weightByName.set(part.name, part.weightG)
  return result.placements.reduce(
    (sum, placement) => sum + (weightByName.get(placement.partName) ?? 0),
    0
  )
}

/**
 * The warning for parts whose density-derived weight rests on a meaningless
 * volume (see `packing/request.ts` `openMeshParts`), or null when there are none.
 *
 * Worded to say what to DO, because the user can fix this in one click by
 * entering the weight directly — and because "not watertight" alone reads as a
 * modelling nitpick rather than "the number above is wrong".
 */
export function openMeshWarning(openParts: readonly string[]): string | null {
  if (openParts.length === 0) return null
  const shown = openParts.slice(0, 3).map((name) => `“${name}”`)
  const rest = openParts.length - shown.length
  const list = rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ')
  const subject =
    openParts.length === 1 ? `${list} is not a closed mesh` : `${list} are not closed meshes`
  return (
    `${subject}, so the volume behind this weight is unreliable — and weight is a ` +
    `hard limit here. Enter the part weight directly for a trustworthy count.`
  )
}

/**
 * The warning for kinds whose instances arrive at DIFFERENT orientations, so
 * their bounding boxes differ — or null when every kind agrees with itself.
 *
 * Lives beside `openMeshWarning` because it is the same kind of thing and needs
 * the same reach. ADR-0029 amendment 10 put this qualification on the wire and
 * **only** on the wire, calling the screen a product question. The 8th dogfood
 * settled that: it changes what an answer is MADE of, so every surface that
 * presents an answer owes it. The reader's evidence was the CSV itself, which
 * printed `nut` at 0.118 × 0.591 × 0.787 for two instances and
 * 0.787 × 0.591 × 0.118 for six others — carrying the PROOF of the caveat while
 * suppressing the caveat.
 *
 * Worded like `openMeshWarning`: what it means for the number, not what is
 * unusual about the file. "Instances differ" is a modelling remark; "the count
 * depends on how the file was saved" is the thing a quote needs.
 */
export function mixedInstancesWarning(mixedKinds: readonly string[]): string | null {
  if (mixedKinds.length === 0) return null
  const shown = mixedKinds.slice(0, 3).map((name) => `“${name}”`)
  const rest = mixedKinds.length - shown.length
  const list = rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ')
  // "Instances of X" is plural whatever X is — one KIND still has several
  // instances, which is the only way it can disagree with itself.
  // Shape, not placement: a 90° placement is a permutation of one box and
  // both tiers try all six, so it cannot reach the answer (15th dogfood). What
  // is left is an instance whose box differs even when turned — a tilted
  // placement, or one product name over two shapes.
  return (
    `Instances of ${list} do not share one shape — their bounding boxes differ even when ` +
    `turned, and STEP geometry arrives with each instance's placement baked in. Each was ` +
    `packed with its OWN box, so this answer depends on how the file happened to build them.`
  )
}

/**
 * True when the reported count exceeds the placements actually materialized.
 * The engine caps materialization (MAX_GRID_PLACEMENTS) because a weightless
 * 1 mm part in a 600 mm carton counts 2e8 copies; `count` stays true, so the
 * panel must say the LAYOUT is partial rather than let the 3D view imply the
 * count is wrong.
 */
export function truncatedLayout(result: PackResult): result is MaxQuantityResult {
  return result.mode === 'max-quantity' && result.count > result.placements.length
}

/**
 * The sentence for a truncated layout, or null when the drawing is complete.
 *
 * Lives here rather than inline in the panel because ADR-0017 sends this
 * qualifier out with every export: a count whose picture shows a fraction of it
 * needs the same caveat in a quote as it has on screen, and two copies of the
 * wording would drift.
 */
export function truncatedLayoutNote(result: PackResult): string | null {
  if (!truncatedLayout(result)) return null
  return (
    `Showing ${result.placements.length.toLocaleString()} of ` +
    `${result.count.toLocaleString()} in the 3D view — the count is exact, the ` +
    `drawing is partial.`
  )
}

/**
 * Whether density-derived weights integrated over tessellations of curved
 * faces could reach THIS count — and which kinds, and by how much (ADR-0015
 * addendum 2). One report behind the panel, both exports and both estimate
 * tools (wire rule 5).
 */
export interface MeshVolumeReport {
  /** Counted kinds whose grams came from a closed, curved, un-overridden mesh. */
  approximateKinds: string[]
  /** The LARGEST tolerance over the kinds — a fraction either way, 0 when
   *  none. A headline, not the band: `perKind` is what the band and the
   *  exports read (18th dogfood, ADR-0029 amendment 23). */
  volumeTolerance: number
  /** Each kind's own tolerance, in `approximateKinds` order. */
  perKind: Array<{ kind: string; volumeTolerance: number }>
  /** The band test: whether the cap sits close enough to the packed weight that
   *  a volume error inside the tolerance could change the count. */
  couldChangeCount: boolean
  /** The same band applied to the ATTRIBUTION (21st dogfood, ADR-0029
   *  amendment 24): whether "which limit stopped it" could flip inside the
   *  band even where the count cannot — a weight-bound count whose next unit,
   *  lighter by the band, would clear the cap while the carton still forbids
   *  it. Max-quantity only; a fit-check's label under the band is item 41's
   *  open sentence. */
  couldChangeBinding: boolean
}

/**
 * The band test. The band is Σ(each kind's tolerance × its grams) over the
 * approximate kinds — a plate priced by hand beside a density-priced bolt
 * widens nothing, and the bolt's coarseness widens only the bolt's grams
 * (18th dogfood: one scalar times every gram quoted the bolt's 2.1% for a
 * pack that was 69% plate at 1.9%).
 *
 *  - max-quantity: `count` units heavier by the band would exceed the cap, or
 *    — when the cap was what stopped `count + 1` AND THE CARTON HAS ROOM FOR
 *    IT — that many units lighter by the band would fit under the cap. The
 *    room is `spaceOnlyCount > count`, ADR-0033's constructive field: what the
 *    engine returns with the cap lifted, so what it would return with a
 *    lighter unit. Not `geometryBound`, which a reader proposed: a loose bound
 *    says a fourth was not proven impossible, and the engine would still say
 *    3 because its own search found no room. The 18th dogfood found this
 *    branch reading only the weight, and the reply told an engineer to go
 *    weigh a plate the carton could not take a fourth of — rule 14 applied
 *    halfway, the path from the carton to the count never derived;
 *  - fit-check: the file's total, every part, crosses the cap inside the band.
 *    A lighter file changes the unplaced list even when the verdict stays,
 *    so no geometry gate here. The engine's actual placement is greedier
 *    than a total, so this is "could", stated as such.
 */
export function meshVolumeReport(
  result: PackResult,
  request: PackRequest,
  approximate: ApproximateVolumes
): MeshVolumeReport {
  const report: MeshVolumeReport = {
    approximateKinds: approximate.kinds,
    volumeTolerance: approximate.tolerance,
    perKind: approximate.perKind.map(({ kind, tolerance }) => ({ kind, volumeTolerance: tolerance })),
    couldChangeCount: false,
    couldChangeBinding: false
  }
  const cap = request.maxWeightG
  if (approximate.kinds.length === 0 || approximate.tolerance <= 0 || !Number.isFinite(cap)) {
    return report
  }
  // The kinds were resolved against the WHOLE file; a max-quantity request
  // over `bolt (2)` alone carries no `bolt` to strip the ordinal against, so
  // the kind names join the set the ordinal test reads.
  const names = new Set([...request.parts.map((part) => part.name), ...approximate.kinds])
  const toleranceOf = new Map(approximate.perKind.map(({ kind, tolerance }) => [kind, tolerance]))
  let total = 0
  let band = 0
  for (const part of request.parts) {
    total += part.weightG
    band += (toleranceOf.get(kindOf(part.name, names)) ?? 0) * part.weightG
  }
  if (band <= 0) return report

  if (result.mode === 'max-quantity') {
    const count = result.count
    const tooMany = count * (total + band) > cap + EPS
    const capStoppedNext = (count + 1) * total > cap + EPS
    const cartonHasRoom = result.spaceOnlyCount > count
    // The next unit lighter by the band would clear the cap. With room in the
    // carton that moves the COUNT; without it, it moves only the ATTRIBUTION —
    // the cap stopped nothing at that end of the band, the carton did, and
    // `constraint` would read "geometry" (21st dogfood).
    const lighterClearsCap = capStoppedNext && (count + 1) * (total - band) <= cap + EPS
    const tooFew = lighterClearsCap && cartonHasRoom
    report.couldChangeCount = tooMany || tooFew
    report.couldChangeBinding =
      result.binding === 'weight' ? lighterClearsCap || tooMany : tooMany
    return report
  }
  report.couldChangeCount =
    (total <= cap + EPS && total + band > cap + EPS) || (total > cap + EPS && total - band <= cap + EPS)
  return report
}

/** One formatter for the tolerance, wherever it is printed. */
export function toleranceText(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}

function kindList(kinds: readonly string[]): string {
  const shown = kinds.slice(0, 3).map((name) => `“${name}”`)
  const rest = kinds.length - shown.length
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ')
}

/**
 * The sentence for a count the tessellation could move — null otherwise.
 * Fires on `couldChangeCount` alone (wire rule 14): a 2% band around a weight
 * at 38% of the cap reaches nothing, and saying so on every answer would
 * teach readers to skip it.
 */
export function meshVolumeWarning(report: MeshVolumeReport): string | null {
  if (!report.couldChangeCount && !report.couldChangeBinding) return null
  const list = kindList(report.approximateKinds)
  const subject =
    report.approximateKinds.length === 1
      ? `The weight of ${list} comes from`
      : `The weights of ${list} come from`
  const spread = report.approximateKinds.length === 1 ? 'about' : 'up to about'
  const opening =
    `${subject} the mesh volume of curved faces, which can run ${spread} ` +
    `${toleranceText(report.volumeTolerance)} light or heavy at this facet size — and `
  // Count first when it can move; the attribution alone only when it cannot
  // (21st dogfood): "the cap stopped it" at the heavy end of the band and
  // "only the carton did" at the light end are both inside the tolerance.
  const reach = report.couldChangeCount
    ? 'this pack sits close enough to the weight cap for that to change the count.'
    : 'the count holds, but which limit stopped it is inside that band: a lighter unit ' +
      'would put the next one under the cap, and only the carton would stop it.'
  return `${opening}${reach} Weigh one and enter it directly to settle it.`
}

/**
 * The clause the summary export's density line carries whenever a counted
 * kind was priced from a curved mesh — null when none was. Always, not only
 * near the cap: that line is a claim about where the grams came from, and
 * "mesh volume" without "approximate" was the omission (16th dogfood).
 */
export function meshVolumeClause(report: MeshVolumeReport): string | null {
  if (report.perKind.length === 0) return null
  // Each kind with its own figure (18th dogfood): one number for five kinds
  // was the bolt's, quoted for the plate.
  const kinds = report.perKind
    .map(({ kind, volumeTolerance }) => `${kind} ${toleranceText(volumeTolerance)}`)
    .join(', ')
  return `mesh volumes of curved faces, approximate either way: ${kinds}`
}
