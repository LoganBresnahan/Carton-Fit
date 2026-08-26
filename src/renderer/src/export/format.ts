import { MODES, TIERS, type PackMode, type QualityTier } from '../core/packing/types'
import {
  gToWeight,
  mm3ToVolume,
  mmToLength,
  type UnitSystem,
  type WeightUnit
} from '../core/units'

// Number formatting for exports (ADR-0017).
//
// ONE RULE DOMINATES THIS FILE: exported numbers are never locale-grouped. A
// thousands separator is a column break in a CSV — `27,000` becomes two cells —
// and `Number()` rejects it on the way back in. The results panel groups
// digits because a human reads it; a file is read by a spreadsheet first, so
// grouping is the wrong default here even in the text summary, where a pasted
// figure often gets typed back into a quote.

/**
 * Plain decimal, trailing zeros trimmed: `12`, not `12.000`; `11.75` kept.
 *
 * Three places is the resolution the inputs panel itself offers — beyond it the
 * digits are float noise from a mm round-trip, not measurement.
 */
export function decimal(value: number, places = 3): string {
  if (!Number.isFinite(value)) return ''
  const fixed = value.toFixed(places)
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
}

export const lengthText = (mm: number, units: UnitSystem): string =>
  decimal(mmToLength(mm, units))

export const weightText = (g: number, unit: WeightUnit): string => decimal(gToWeight(g, unit))

/**
 * Two places, not three like lengths.
 *
 * Mesh coordinates are `Float32Array` (the import worker's transferable
 * format), so a volume — a product of three of them — carries float noise well
 * above the third decimal: a 131096.512 mm³ box computes as 131096.506. Printing
 * that digit claims resolution the input never had. Two places round the noise
 * away for any volume a carton can hold.
 */
export const volumeText = (mm3: number, units: UnitSystem): string =>
  decimal(mm3ToVolume(mm3, units), 2)

/** `10 × 4 × 10` — the dimension triple, unit label left to the caller so it is
 *  said once per line rather than three times. */
export function dimsText(mm: readonly number[], units: UnitSystem): string {
  return mm.map((value) => lengthText(value, units)).join(' × ')
}

/** Mode and tier as the UI names them, so an export never introduces a third
 *  spelling of a choice the user made from a labelled button. Falls back to the
 *  raw token rather than blanking, for a value written by an older build. */
export const modeLabel = (mode: PackMode): string =>
  MODES.find((info) => info.mode === mode)?.label ?? mode

export const tierLabel = (tier: QualityTier): string =>
  TIERS.find((info) => info.tier === tier)?.label ?? tier
