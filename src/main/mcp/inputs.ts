import { TIERS, type PackMode, type QualityTier } from '../../renderer/src/core/packing/types'
import type { PackingSettings } from '../../renderer/src/packing/settings'
import { EstimateInputError } from './estimate'
import {
  dimsToMm,
  toG,
  toMm,
  type DimensionsValue,
  type LengthValue,
  type WeightValue,
  type WeightUnit
} from './wire'

// `set_inputs` → a PackingSettings patch (ADR-0029 v2, slice `v2-drive-tools`).
//
// PARTIAL UPDATES OVER LIVE STATE: everything is optional, and an absent field
// means "keep what the app has" — the same contract as a person editing one
// field of the inputs panel. That is why this converter produces a PATCH the
// drive host hands to `updateSettings` in ONE store write (one undo step,
// ADR-0016 §2), rather than a whole settings object: building the whole object
// would need the current state anyway and would turn every call into a rewrite
// of fields the caller never mentioned.
//
// Pure and Electron-free on purpose: the RENDERER runs this (it owns the
// current settings and the store), but the unit math stays wire.ts's, so an AI
// client setting a carton and a person typing one convert through the same
// lines of code.

export interface SetInputsRequest {
  mode?: PackMode
  tier?: QualityTier
  carton?: {
    dimensions?: DimensionsValue
    measured?: 'inner' | 'outer'
    wallThickness?: LengthValue
  }
  clearances?: {
    betweenParts?: LengthValue
    wall?: LengthValue
  }
  maxWeight?: WeightValue
  weight?: {
    partWeight?: WeightValue
    densityGPerCm3?: number
  }
  /** Display units — what the PANEL shows, not what this reply is stated in
   *  (that is `outputUnits`, like every tool). Length and the two weight units
   *  move independently (ADR-0024). */
  displayUnits?: {
    length?: 'mm' | 'in'
    maxWeight?: WeightUnit
    partWeight?: WeightUnit
  }
}

/** Validate a tier the way the stateless call does — worded for the client. */
export function assertTierEnabled(tier: QualityTier): void {
  const info = TIERS.find((entry) => entry.tier === tier)
  if (info === undefined) throw new EstimateInputError(`Unknown quality tier: ${tier}`)
  if (!info.enabled) {
    throw new EstimateInputError(
      `The ${info.label} tier is not available yet${info.note ? ` (${info.note})` : ''}. ` +
        'Use "fast" or "thorough".'
    )
  }
}

/**
 * Convert a validated `set_inputs` call into a settings patch.
 *
 * Throws `EstimateInputError` for the calls the engine must never see; the
 * message is what the AI client will read out loud.
 */
export function settingsPatchFrom(input: SetInputsRequest): Partial<PackingSettings> {
  const patch: Partial<PackingSettings> = {}

  if (input.mode !== undefined) patch.mode = input.mode
  if (input.tier !== undefined) {
    assertTierEnabled(input.tier)
    patch.tier = input.tier
  }

  if (input.carton?.dimensions !== undefined) patch.boxDimsMm = dimsToMm(input.carton.dimensions)
  if (input.carton?.measured !== undefined) patch.enterOuter = input.carton.measured === 'outer'
  if (input.carton?.wallThickness !== undefined) patch.wallMm = toMm(input.carton.wallThickness)

  if (input.clearances?.betweenParts !== undefined) {
    patch.clearancePartMm = toMm(input.clearances.betweenParts)
  }
  if (input.clearances?.wall !== undefined) patch.clearanceWallMm = toMm(input.clearances.wall)

  if (input.maxWeight !== undefined) patch.maxWeightG = toG(input.maxWeight)

  if (input.weight !== undefined) {
    const { partWeight, densityGPerCm3 } = input.weight
    if (partWeight !== undefined && densityGPerCm3 !== undefined) {
      throw new EstimateInputError(
        'Give either a part weight or a density, not both — a density is only a way ' +
          'of deriving the same number.'
      )
    }
    if (partWeight !== undefined) {
      patch.weightMode = 'direct'
      patch.partWeightG = toG(partWeight)
    } else if (densityGPerCm3 !== undefined) {
      patch.weightMode = 'density'
      patch.densityGPerCm3 = densityGPerCm3
    }
  }

  if (input.displayUnits?.length !== undefined) {
    patch.unitSystem = input.displayUnits.length === 'in' ? 'imperial' : 'metric'
  }
  if (input.displayUnits?.maxWeight !== undefined) {
    patch.maxWeightUnit = input.displayUnits.maxWeight
  }
  if (input.displayUnits?.partWeight !== undefined) {
    patch.partWeightUnit = input.displayUnits.partWeight
  }

  return patch
}
