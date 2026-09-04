import { pack } from '../../renderer/src/core/packing/pack'
import {
  sanitizeClearances,
  TIERS,
  type PackMode,
  type PackRequest,
  type PackResult,
  type QualityTier
} from '../../renderer/src/core/packing/types'
import { buildPackRequest, openMeshParts, partsForRequest } from '../../renderer/src/packing/request'
import { overrideForPart, type PartWeightOverrides } from '../../renderer/src/packing/kinds'
import type { PackingSettings } from '../../renderer/src/packing/settings'
import { DEFAULT_MAX_WEIGHT_G } from '../../renderer/src/core/units'
import {
  bindingReport,
  freeSpaceReport,
  openMeshWarning,
  packedWeightG,
  truncatedLayoutNote,
  verdictCaption,
  type BindingReport
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
    /** Which part a max-quantity count replicates — `null` is the whole file
     *  fused into one unit. The one input the report used to leave out, which
     *  is what made a count of 1 after `load_model` a count of nothing in
     *  particular (2026-09-04). Always present, `null` in fit-check. */
    unitPart: string | null
  }
  outcome: EstimateOutcome
  /** Which limit is closest, whether it bound, what the other one was doing
   *  and with what kind of evidence — `bindingReport`, shared with the panel
   *  and both exports so the app cannot disagree with itself about it. */
  binding: BindingReport
  utilization: { fraction: number; percent: string; basis: 'bounding-boxes' }
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
       *  the count beside it. **The weight cap is folded into it**, so on a
       *  weight-limited answer it equals the count for a reason that says
       *  nothing about the carton. `geometryBound` is the number to reason
       *  about space with. */
      upperBound: Known<{ count: number }>
      /** The same cap with the weight term removed — space alone.
       *
       *  Exposed because two independent dogfood clients reached for
       *  `upperBound` as evidence about the carton and drew opposite
       *  conclusions from it (2026-09-03); a field they cannot compute is a
       *  field they will guess at. Equality with `count` PROVES no arrangement
       *  fits another copy; a value above it proves nothing, because a bound is
       *  allowed to be loose — this one is, routinely, by more than one. */
      geometryBound: Known<{ count: number }>
      /** The same search with the cap lifted (ADR-0033). Above `count` it is
       *  an arrangement we hold — room, proven constructively. Equal to it,
       *  the search found no more: evidence, not proof. Absent, with the
       *  reason, when the question did not arise. */
      spaceOnlyCount: Known<{ count: number }>
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
    | {
        supplied: true
        /** The MODE that was set — `direct` or `density`. It is an input, not
         *  a description of the answer: a per-kind override reaches the engine
         *  whatever this says. */
        source: 'direct' | 'density'
        overriddenKinds: string[]
        /** Where the grams this answer actually counted came from (2026-09-03
         *  dogfood). `source` alone said `density` for a max-quantity count
         *  whose one unit part was priced by hand — true about the setting,
         *  false about the answer, and this is the field a script reads.
         *  `override` when every counted part was priced by hand, `mixed` when
         *  some were, otherwise the mode that derived them. */
        countedWeightFrom: 'direct' | 'density' | 'override' | 'mixed'
      }
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
    geometryBound:
      result.geometryBound === undefined
        ? {
            known: false,
            reason: 'no finite bound exists on what the carton alone could hold'
          }
        : { known: true, count: result.geometryBound },
    spaceOnlyCount:
      result.spaceOnlyCount !== undefined
        ? { known: true, count: result.spaceOnlyCount }
        : {
            known: false,
            reason:
              result.binding !== 'weight'
                ? 'not asked — the carton, not the cap, stopped this count'
                : result.geometryBound !== undefined && result.geometryBound <= result.count
                  ? 'not needed — the geometry bound already proves the carton is full'
                  : 'no finite cap to lift'
          },
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

/**
 * Where the weights behind THIS answer came from, as opposed to which mode the
 * caller set.
 *
 * Scoped to the parts the engine actually weighed — `partsForRequest`, the same
 * selection the pack used — because a max-quantity count replicates ONE unit,
 * and the density mode of four kinds it never counted says nothing about it.
 * That was the finding: `source: "density"` beside a count whose every gram came
 * from a hand override on the unit part.
 *
 * Fit-check counts the whole file rather than only the placed parts: every
 * part's weight took part in deciding what fit, and a provenance that changed
 * depending on which parts happened to be placed would be a moving answer to a
 * question about inputs.
 */
function countedWeightFrom(
  context: LiveEstimateContext
): 'direct' | 'density' | 'override' | 'mixed' {
  const { parts, settings, overrides } = context
  const names = new Set(parts.map((part) => part.name))
  const counted = partsForRequest(parts, settings, context.unitPart)
  if (counted.length === 0) return settings.weightMode
  const overridden = counted.filter(
    (part) => overrideForPart(part, names, overrides) !== null
  ).length
  if (overridden === counted.length) return 'override'
  if (overridden === 0) return settings.weightMode
  return 'mixed'
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
          overriddenKinds: Object.keys(overrides),
          countedWeightFrom: countedWeightFrom(context)
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
      packedWeight: fromG(packedWeightG(result, request), units.weight),
      unitPart: request.mode === 'max-quantity' ? context.unitPart : null
    },
    outcome: outcomeOf(result, units),
    binding: bindingReport(result, request),
    utilization: {
      fraction: result.utilization,
      percent: `${Math.round(result.utilization * 1000) / 10}%`,
      basis: 'bounding-boxes'
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
