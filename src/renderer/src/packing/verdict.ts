import { EPS } from '../core/geometry'
import type {
  BindingConstraint,
  MaxQuantityResult,
  PackRequest,
  PackResult,
  Vec3
} from '../core/packing/types'
import { lengthUnitLabel, type UnitSystem } from '../core/units'
import { dimsText } from '../export/format'

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
export function verdictCaption(result: PackResult): string {
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
  const limit = result.binding === 'weight' ? 'weight-limited' : 'space-limited'
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
    return `${count} fit (${limit}) — no arrangement beats this under these limits.`
  }
  return `At least ${count} fit (${limit}). Heuristic — a mixed arrangement may fit more.`
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
  return `upper bound ${result.upperBound.toLocaleString()}`
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
export function bindingHeading(result: PackResult): string {
  return result.mode === 'fit-check' && result.fits ? 'Closest limit' : 'Limited by'
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
function weightless(request: PackRequest): boolean {
  return request.parts.every((part) => part.weightG === 0)
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
    if (result.geometryBound !== undefined && result.geometryBound <= result.count) {
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
        note =
          `Both limits land on ${count !== null ? count.toLocaleString() : 'this answer'}: ` +
          'the weight cap stopped it, and no arrangement fits another one in the carton either.'
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
    } else {
      note = `The carton stopped this${at}; no weight cap applied.`
    }
    return { constraint: result.binding, bound: true, otherConstraint: other, note }
  }
  const pct = (fraction: number): string => `${Math.round(fraction * 1000) / 10}%`
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
    note =
      `Nothing bound — all ${placed} parts placed at ${pct(packedWeightG(result, request) / request.maxWeightG)} ` +
      `of the weight cap and ${fill} of the carton. ` +
      `${result.binding === 'weight' ? 'Weight' : 'Space'} is the closer limit.`
  }
  // Nothing stopped the pack, so neither limit is at its limit — and that IS
  // knowable here. The evidence names the side it is about (2026-09-04, a
  // reader filtering on evidence found a weight fact labelled 'arrangement'):
  // when the closest limit is weight the OTHER is space, settled by the
  // arrangement we hold; when it is space the other is weight, settled by
  // packed weight against the cap — arithmetic.
  return {
    constraint: result.binding,
    bound: false,
    otherConstraint: {
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
  token: 'bounding-boxes',
  label: 'bounding boxes',
  note: 'Share of the carton filled by part bounding boxes'
} as const

/** Carton fill as a percentage. See `UTILIZATION_BASIS` for what it is a share
 *  of — the number alone does not say, and for two builds nothing else did
 *  either once it reached an export. */
export function utilizationPercent(utilization: number): string {
  const pct = utilization * 100
  return pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`
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
