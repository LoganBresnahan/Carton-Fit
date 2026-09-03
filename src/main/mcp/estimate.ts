import { pack } from '../../renderer/src/core/packing/pack'
import {
  sanitizeClearances,
  TIERS,
  type PackMode,
  type PackRequest,
  type PackResult,
  type QualityTier
} from '../../renderer/src/core/packing/types'
import { buildPackRequest, openMeshParts } from '../../renderer/src/packing/request'
import type { PartWeightOverrides } from '../../renderer/src/packing/kinds'
import type { PackingSettings } from '../../renderer/src/packing/settings'
import { DEFAULT_MAX_WEIGHT_G } from '../../renderer/src/core/units'
import {
  freeSpaceReport,
  openMeshWarning,
  packedWeightG,
  truncatedLayoutNote,
  verdictCaption
} from '../../renderer/src/packing/verdict'
import type { ImportedPart } from '../../renderer/src/workers/import-protocol'
import {
  dimsFromMm,
  dimsToMm,
  fromG,
  fromMm,
  resolveOutputUnits,
  toG,
  toMm,
  type DimensionsValue,
  type LengthValue,
  type OutputUnits,
  type WeightValue
} from './wire'

// `estimate` (ADR-0029 v1) — the app's answer, without the app.
//
// STATELESS AND SECOND-HAND ON PURPOSE. It owns no packing logic: it translates
// a call into the same `PackingSettings` the inputs panel produces, hands them
// to the same `buildPackRequest`, and calls the same pure `pack()`. Anything the
// screen would say about the answer is read back through `packing/verdict.ts`,
// the module the results panel and the exporter already share. Three consumers,
// one wording — which is the whole reason ADR-0017 put that module there.
//
// What this file DOES own is the qualification contract: every hedge the screen
// carries has to survive the trip, structurally, or an AI client will restate a
// heuristic count as a fact. See `EstimateQualifications`.

/** How the caller supplies part weight. Exactly one, or neither. */
export interface WeightSource {
  /** Weight of one part, applied to every part in the file. */
  partWeight?: WeightValue
  /** Material density in g/cm³, from which weight = density × mesh volume.
   *  Wrong rather than approximate on an open mesh — hence the qualification. */
  densityGPerCm3?: number
}

export interface EstimateInput {
  mode: PackMode
  tier: QualityTier
  carton: {
    dimensions: DimensionsValue
    /** Whether `dimensions` are the inside of the box or the outside. Inner is
     *  the physical truth (ADR-0004); outer needs `wallThickness` to get there. */
    measured: 'inner' | 'outer'
    wallThickness?: LengthValue
  }
  clearances?: {
    betweenParts?: LengthValue
    wall?: LengthValue
  }
  /** Hard cap on the packed weight. Defaults to the app's own 35 lb default. */
  maxWeight?: WeightValue
  weight?: WeightSource
  /** Per-kind weight overrides (ADR-0018), keyed by the kind names
   *  `inspect_model` reports. */
  overrides?: ReadonlyArray<{ kind: string; weight: WeightValue }>
  /** Max-quantity only: which part to replicate. Omitted means the whole file
   *  fused into one rigid unit (ADR-0003). */
  unitPart?: string
  outputUnits?: Partial<OutputUnits>
}

export interface EstimateReport {
  /** Every input as the engine actually understood it — the caller's own values
   *  converted, defaulted and clamped. A reply that only carried the answer
   *  would leave a mis-set carton indistinguishable from a surprising result. */
  request: {
    mode: PackMode
    tier: QualityTier
    innerCarton: DimensionsValue
    clearances: { betweenParts: LengthValue; wall: LengthValue }
    maxWeight: WeightValue
    packedWeight: WeightValue
  }
  outcome: EstimateOutcome
  binding: {
    constraint: 'geometry' | 'weight'
    /** Whether that constraint actually STOPPED anything. False on a fit where
     *  everything was placed: `constraint` is then the one with the least
     *  headroom, which is useful, and `note` says so instead of claiming a
     *  stop that never happened. */
    bound: boolean
    /** What the OTHER constraint was doing — the field the note is no longer
     *  allowed to assert without (ADR-0029 phase-2 amendment 2). "The weight
     *  cap stopped this, not the carton — there is room left" was prose the
     *  engine had never checked, and on a plate that saturates both limits at
     *  3 it was simply false. Absence is the common case and says so: proving
     *  the carton has room would take an arrangement nobody attempted, and a
     *  loose upper bound is not that arrangement. */
    otherConstraint: Known<{ atLimit: boolean }>
    note: string
  }
  utilization: { fraction: number; percent: string }
  qualifications: EstimateQualifications
  units: OutputUnits
}

export type EstimateOutcome =
  | {
      mode: 'fit-check'
      fits: boolean
      placed: number
      total: number
      unplaced: string[]
      /** The biggest usable void this arrangement left (ADR-0022 §3). */
      largestFreeSpace: Known<{ size: DimensionsValue }>
      /** The smallest leftover part and what its tightest orientation needs —
       *  reported only when it would NOT fit the free space above, because
       *  pairing them otherwise reads as an arithmetic error (see
       *  `freeSpaceReport`). */
      smallestUnplaced: Known<{ name: string; size: DimensionsValue }>
    }
  | {
      mode: 'max-quantity'
      count: number
      /** A cap no arrangement can beat (ADR-0022 §7) — not a heuristic, unlike
       *  the count beside it. */
      upperBound: Known<{ count: number }>
      /** Whether the placements behind the count were all materialized. */
      layout: { complete: true } | { complete: false; shown: number; counted: number; note: string }
    }

/**
 * A value that may genuinely not exist, expressed so that its absence is a
 * STATEMENT rather than a missing key.
 *
 * The engine reports several figures as optional on purpose (`upperBound` is
 * absent when no finite bound exists; free space is absent when it cannot be
 * described honestly) — absence over misinformation. Passing that straight to
 * the wire as an omitted field would destroy the distinction ADR-0029 cares
 * about: a client cannot tell a figure that does not exist from a figure this
 * build forgot to send, and the second one is our bug. So absence is carried,
 * with its reason.
 */
export type Known<T> = ({ known: true } & T) | { known: false; reason: string }

export interface EstimateQualifications {
  /** ADR-0003: heuristic placement must be labeled, never sold as a proof. */
  heuristic: { heuristic: boolean; note: string }
  /** Whether a weight was supplied at all — with none, the cap cannot bind and
   *  `binding` says "geometry" for a reason the caller did not choose. */
  weightInput:
    | { supplied: true; source: 'direct' | 'density'; overriddenKinds: string[] }
    | { supplied: false; note: string }
  /** Clearances as honored. Negative and non-finite gaps clamp to zero
   *  (`sanitizeClearances`); saying so beats silently answering a different
   *  question than the one asked. */
  clearances: { asRequested: true } | { asRequested: false; note: string }
  /** Density weight over a mesh that is not watertight: a wrong weight against
   *  a hard constraint, so a wrong count stated with full confidence (ADR-0015). */
  openMesh: { affected: false } | { affected: true; parts: string[]; note: string }
}

/** Thrown for a call the engine should never see — a disabled tier, a
 *  contradictory weight source. The message is what the AI client shows. */
export class EstimateInputError extends Error {}

function settingsFrom(input: EstimateInput, units: OutputUnits): PackingSettings {
  const weight = input.weight ?? {}
  if (weight.partWeight !== undefined && weight.densityGPerCm3 !== undefined) {
    throw new EstimateInputError(
      'Give either a part weight or a density, not both — a density is only a way ' +
        'of deriving the same number.'
    )
  }
  const tierInfo = TIERS.find((entry) => entry.tier === input.tier)
  if (tierInfo === undefined) throw new EstimateInputError(`Unknown quality tier: ${input.tier}`)
  if (!tierInfo.enabled) {
    throw new EstimateInputError(
      `The ${tierInfo.label} tier is not available yet${tierInfo.note ? ` (${tierInfo.note})` : ''}. ` +
        'Use "fast" or "thorough".'
    )
  }

  const dims = dimsToMm(input.carton.dimensions)
  const outer = input.carton.measured === 'outer'
  if (outer && input.carton.wallThickness === undefined) {
    throw new EstimateInputError(
      'Outer carton dimensions need a wallThickness — inside dimensions are what a part ' +
        'actually has to fit into.'
    )
  }

  return {
    mode: input.mode,
    tier: input.tier,
    unitSystem: units.length === 'in' ? 'imperial' : 'metric',
    maxWeightUnit: units.weight,
    partWeightUnit: units.weight,
    boxDimsMm: dims,
    enterOuter: outer,
    wallMm: input.carton.wallThickness ? toMm(input.carton.wallThickness) : 0,
    clearancePartMm: input.clearances?.betweenParts ? toMm(input.clearances.betweenParts) : 0,
    clearanceWallMm: input.clearances?.wall ? toMm(input.clearances.wall) : 0,
    maxWeightG: input.maxWeight ? toG(input.maxWeight) : DEFAULT_MAX_WEIGHT_G,
    weightMode: weight.densityGPerCm3 !== undefined ? 'density' : 'direct',
    partWeightG: weight.partWeight ? toG(weight.partWeight) : 0,
    densityGPerCm3: weight.densityGPerCm3 ?? 0
  }
}

function overridesFrom(input: EstimateInput): PartWeightOverrides {
  const overrides: Record<string, number> = {}
  for (const entry of input.overrides ?? []) overrides[entry.kind] = toG(entry.weight)
  return overrides
}

/** Descending extents, matching how `freeSpaceReport` orders the pair it
 *  compares — two triples read side by side must be sorted the same way. */
function knownSpace(
  size: readonly [number, number, number] | undefined,
  units: OutputUnits,
  reason: string
): Known<{ size: DimensionsValue }> {
  if (size === undefined) return { known: false, reason }
  return { known: true, size: dimsFromMm(size, units.length) }
}

function outcomeOf(
  result: PackResult,
  units: OutputUnits
): EstimateOutcome {
  if (result.mode === 'fit-check') {
    const total = result.placements.length + result.unplaced.length
    const space = freeSpaceReport(result)
    return {
      mode: 'fit-check',
      fits: result.fits,
      placed: result.placements.length,
      total,
      unplaced: result.unplaced,
      largestFreeSpace: knownSpace(
        space?.spaceMm,
        units,
        result.fits
          ? 'everything fit, so no leftover space limited this answer'
          : 'the leftover space could not be described honestly for this arrangement'
      ),
      smallestUnplaced:
        space?.need === undefined
          ? {
              known: false,
              reason: result.fits
                ? 'everything fit'
                : 'the smallest leftover part would fit the free space above — the ' +
                  'arrangement stopped it, not its size'
            }
          : {
              known: true,
              name: space.need.name,
              size: dimsFromMm(space.need.extentMm, units.length)
            }
    }
  }
  const truncated = truncatedLayoutNote(result)
  return {
    mode: 'max-quantity',
    count: result.count,
    upperBound:
      result.upperBound === undefined
        ? {
            known: false,
            reason:
              'no finite bound exists for this input — a weightless part with no extent ' +
              'is limited by nothing'
          }
        : { known: true, count: result.upperBound },
    layout:
      truncated === null
        ? { complete: true }
        : {
            complete: false,
            shown: result.placements.length,
            counted: result.count,
            note: truncated
          }
  }
}

function qualificationsOf(
  context: LiveEstimateContext,
  units: OutputUnits
): EstimateQualifications {
  const { settings, request, result, parts, overrides } = context
  const requested = {
    betweenParts: settings.clearancePartMm,
    wall: settings.clearanceWallMm
  }
  const honored = sanitizeClearances(requested)
  const clamped =
    honored.betweenParts !== requested.betweenParts || honored.wall !== requested.wall

  const open = openMeshParts(parts, settings, context.unitPart, overrides)
  const openNote = openMeshWarning(open)
  // Overrides count as a supplied weight on their own: an ADR-0018 override
  // reaches the engine whatever the weight mode says, so a call carrying only
  // overrides can be weight-BOUND — and a "no weight was given, the cap could
  // not bind" note beside a weight-bound count would be a qualification that
  // lies (found writing the v2 drive spec; the v1 path had the same hole).
  const supplied = context.weightSupplied || Object.keys(overrides).length > 0
  const cap = fromG(request.maxWeightG, units.weight)

  return {
    heuristic: { heuristic: result.heuristic, note: verdictCaption(result) },
    weightInput: supplied
      ? {
          supplied: true,
          source: settings.weightMode,
          overriddenKinds: Object.keys(overrides)
        }
      : {
          supplied: false,
          note:
            'No part weight was given, so every part weighs nothing and the ' +
            `${Math.round(cap.value * 100) / 100} ${cap.unit} cap could not bind. ` +
            'This answer is about space only.'
        },
    clearances: clamped
      ? {
          asRequested: false,
          note:
            'A negative or non-finite clearance was clamped to zero — a negative gap ' +
            'offsets parts into each other rather than apart.'
        }
      : { asRequested: true },
    openMesh:
      openNote === null ? { affected: false } : { affected: true, parts: open, note: openNote }
  }
}

/**
 * Everything the report assembly needs, however the pack came to exist.
 *
 * Two producers fill this in: `estimateParts` (v1 — it just ran `pack()`
 * itself) and the renderer's drive host (v2 — the LIVE result the auto-run
 * subscription computed, read out of the store). One assembly for both is the
 * point: an AI client asking the running app and an AI client asking the
 * stateless tool must receive the same wording for the same answer, or the
 * difference reads as a disagreement between the app and itself.
 */
export interface LiveEstimateContext {
  parts: readonly ImportedPart[]
  settings: PackingSettings
  unitPart: string | null
  overrides: PartWeightOverrides
  request: PackRequest
  result: PackResult
  /** Whether the caller supplied any part weight at all — the v1 call knows
   *  this from its own arguments; the live app reads it off the settings. */
  weightSupplied: boolean
}

/** Assemble the qualified report for a pack that already ran. */
/**
 * Which constraint bound, whether it BOUND AT ALL, and a sentence that does not
 * overstate either (ADR-0029 phase-2 addendum, amended 2026-09-02).
 *
 * The core's `binding` is deliberate: when everything is placed it names the
 * constraint with the least headroom (extremePointFit.ts). The old note wrapped
 * that in "the weight cap stopped this" — on a fit at 38% of the cap, with
 * nothing stopped. Claude read it on first contact and called it what it was:
 * "exactly the kind of thing someone would repeat in a packaging decision."
 * So `bound` is structural (the phase-2 rule: a qualification is never prose
 * only) and the note says what the number means. A max-quantity count is
 * always bound — it is, by definition, where a constraint stopped it.
 */
/**
 * What the constraint that did NOT get named was doing — and, far more often,
 * why that cannot be said (amendment 2, 2026-09-03).
 *
 * The asymmetry here is real and worth stating once, because it decides every
 * sentence below. **Weight is arithmetic**: a cap and a set of masses settle
 * the question exactly, in both directions. **Space is not**: the engine's
 * counts are heuristic arrangements and its bounds are allowed to be loose, so
 * a bound above the count proves nothing — an arrangement that fits one more
 * may exist or may not, and only trying would tell. Equality is the exception,
 * and the only one: a rigorous geometry-only bound EQUAL to the count means no
 * arrangement anywhere fits another copy.
 *
 * So "the carton is full too" is provable and gets said; "the carton has room"
 * is not, and does not — which is precisely the sentence that was wrong.
 */
function otherConstraintOf(
  result: PackResult,
  request: PackRequest,
  capApplies: boolean
): Known<{ atLimit: boolean }> {
  if (result.binding === 'weight') {
    if (result.mode !== 'max-quantity') {
      return {
        known: false,
        reason:
          'a fit-check packs a mixed set of parts, and no rigorous bound exists for how ' +
          'tightly that set could be made to sit — so whether the carton also ran out is open'
      }
    }
    const geometry = result.geometryBound
    if (geometry === undefined) {
      return { known: false, reason: 'no finite bound exists on what the carton could hold' }
    }
    if (geometry <= result.count) return { known: true, atLimit: true }
    return {
      known: false,
      reason:
        `the carton might hold as many as ${geometry}, but that is an upper bound, not an ` +
        `arrangement — nothing has placed ${result.count + 1}`
    }
  }
  if (!capApplies) return { known: false, reason: 'no weight cap was supplied' }
  if (result.mode === 'max-quantity') {
    // The engine's own label carries this: it says 'geometry' exactly when the
    // weight cap allows strictly more copies than the carton does
    // (quantityGrid.ts — a tie reports 'weight'). So the cap has headroom by
    // construction, and no second derivation is needed to say so.
    return { known: true, atLimit: false }
  }
  // Fit-check: every part, placed or not, would have to come in under the cap
  // for space to be the only thing in the way. Exact, so it is stated either way.
  const total = request.parts.reduce((sum, part) => sum + part.weightG, 0)
  return { known: true, atLimit: total > request.maxWeightG }
}

function bindingOf(result: PackResult, request: PackRequest): EstimateReport['binding'] {
  const bound = result.mode === 'max-quantity' || !result.fits
  const capApplies = Number.isFinite(request.maxWeightG) && request.maxWeightG > 0
  if (bound) {
    const other = otherConstraintOf(result, request, capApplies)
    const at = result.mode === 'max-quantity' ? ` at ${result.count}` : ''
    let note: string
    if (result.binding === 'weight') {
      note =
        other.known && other.atLimit
          ? `Both limits land on ${result.mode === 'max-quantity' ? result.count : 'this answer'}: ` +
            'the weight cap stopped it, and no arrangement fits another one in the carton either.'
          : `The weight cap stopped this${at}. Whether the carton has room for one more is ` +
            'not established here.'
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
  const note = capApplies
    ? `Nothing bound — all ${placed} parts placed at ${pct(packedWeightG(result, request) / request.maxWeightG)} ` +
      `of the weight cap and ${fill} of the carton. ` +
      `${result.binding === 'weight' ? 'Weight' : 'Space'} is the closer limit.`
    : `Nothing bound — all ${placed} parts placed, filling ${fill} of the carton; no weight cap applied.`
  // Nothing stopped the pack, so neither limit is at its limit — and that IS
  // knowable here: everything asked for was placed, under the cap.
  return {
    constraint: result.binding,
    bound: false,
    otherConstraint: { known: true, atLimit: false },
    note
  }
}

export function buildEstimateReport(
  context: LiveEstimateContext,
  outputUnits?: Partial<OutputUnits>
): EstimateReport {
  const units = resolveOutputUnits(outputUnits)
  const { request, result } = context
  const honored = sanitizeClearances(request.clearances)

  return {
    request: {
      mode: request.mode,
      tier: request.tier,
      innerCarton: dimsFromMm(request.carton, units.length),
      clearances: {
        betweenParts: fromMm(honored.betweenParts, units.length),
        wall: fromMm(honored.wall, units.length)
      },
      maxWeight: fromG(request.maxWeightG, units.weight),
      packedWeight: fromG(packedWeightG(result, request), units.weight)
    },
    outcome: outcomeOf(result, units),
    binding: bindingOf(result, request),
    utilization: {
      fraction: result.utilization,
      percent: `${Math.round(result.utilization * 1000) / 10}%`
    },
    qualifications: qualificationsOf(context, units),
    units
  }
}

/** Whether the LIVE app's settings amount to a supplied weight. The panel's
 *  own semantics: a blank (zero) weight field is "no weight", so the cap
 *  cannot bind and the answer is about space only. */
export function liveWeightSupplied(settings: PackingSettings): boolean {
  return settings.weightMode === 'density'
    ? settings.densityGPerCm3 > 0
    : settings.partWeightG > 0
}

/**
 * Estimate a packing for parts already read off disk.
 *
 * Split from the file read so the goldens can drive it directly and so the tool
 * layer can report an unreadable file separately from an unanswerable question.
 */
export function estimateParts(parts: readonly ImportedPart[], input: EstimateInput): EstimateReport {
  const settings = settingsFrom(input, resolveOutputUnits(input.outputUnits))
  const overrides = overridesFrom(input)
  const unitPart = input.unitPart ?? null
  const request = buildPackRequest(parts, settings, unitPart, overrides)
  if (request === null) {
    throw new EstimateInputError('That file contains no parts to pack.')
  }

  const weight = input.weight ?? {}
  return buildEstimateReport(
    {
      parts,
      settings,
      unitPart,
      overrides,
      request,
      result: pack(request),
      weightSupplied: weight.partWeight !== undefined || weight.densityGPerCm3 !== undefined
    },
    input.outputUnits
  )
}
