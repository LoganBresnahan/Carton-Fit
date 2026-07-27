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
  if (result.count === 0) return 'None fit in this carton.'
  const limit = result.binding === 'weight' ? 'weight-limited' : 'space-limited'
  return (
    `At least ${result.count.toLocaleString()} fit (${limit}). ` +
    `Heuristic — a mixed arrangement may fit more.`
  )
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

/** Which hard constraint bound the result — ADR-0004 requires stating it. */
export function bindingLabel(binding: BindingConstraint): string {
  return binding === 'weight' ? 'weight' : 'space'
}

/** Carton fill as a percentage. Bounding-box based: air trapped inside a part's
 *  box is not usable by another part, so the box is what packing consumes. */
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
