import type { PackMode, QualityTier, Vec3 } from '../core/packing/types'
import {
  DEFAULT_MAX_WEIGHT_G,
  inToMm,
  legacyWeightUnit,
  type UnitSystem,
  type WeightUnit
} from '../core/units'

// The packing INPUTS, split out of the store (ADR-0029 phase 2).
//
// These were defined in `store.ts` and belong to it conceptually — the inputs
// panel writes them, they persist to localStorage, presets serialize them. What
// forced the split is that they are also the vocabulary of the MCP `estimate`
// tool, which runs in the MAIN process where `store.ts` cannot be imported at
// all: it pulls zustand and reads `localStorage` and `window`.
//
// So the DATA moves here (pure, no zustand, no DOM) and the STORE keeps
// everything stateful — the key, the read/write, the actions. `store.ts`
// re-exports these names, so every existing importer is untouched and there is
// still one definition of what a carton input is. That single definition is the
// point: an AI client setting a carton and a user typing one must be able to
// disagree about nothing.

/** All user-chosen packing inputs, in canonical units (mm, grams — ADR-0004). */
export interface PackingSettings {
  mode: PackMode
  tier: QualityTier
  /** Length display unit only; storage is always mm/g. Weights have their own
   *  per-input units (ADR-0024). */
  unitSystem: UnitSystem
  /** Display unit for the max-package weight and everything spent against it. */
  maxWeightUnit: WeightUnit
  /** Display unit for per-part weights: the Per part field, the per-kind
   *  overrides panel, and the per-part export columns. */
  partWeightUnit: WeightUnit
  /** Raw box dimensions the user typed (mm); interpreted as inner or outer per enterOuter. */
  boxDimsMm: Vec3
  /** When true, boxDimsMm are OUTER dims and inner = outer − 2×wall. */
  enterOuter: boolean
  wallMm: number
  clearancePartMm: number
  clearanceWallMm: number
  maxWeightG: number
  weightMode: 'direct' | 'density'
  partWeightG: number
  densityGPerCm3: number
}

export const DEFAULT_SETTINGS: PackingSettings = {
  mode: 'fit-check',
  tier: 'fast',
  unitSystem: 'imperial', // ADR-0004: the likely audience works in inches/lb
  maxWeightUnit: 'lb',
  partWeightUnit: 'lb',
  boxDimsMm: [inToMm(12), inToMm(12), inToMm(12)],
  enterOuter: false,
  wallMm: 0,
  clearancePartMm: 0,
  clearanceWallMm: 0,
  maxWeightG: DEFAULT_MAX_WEIGHT_G,
  weightMode: 'direct',
  partWeightG: 0,
  densityGPerCm3: 1.0
}

/** Merge a persisted settings blob over the defaults. A blob written before
 *  ADR-0024 has no weight units; they derive from its own toggle so the
 *  display stays exactly where that user left it. */
export function settingsFromStored(parsed: Partial<PackingSettings>): PackingSettings {
  const legacy = legacyWeightUnit(parsed.unitSystem === 'metric' ? 'metric' : 'imperial')
  return {
    ...DEFAULT_SETTINGS,
    maxWeightUnit: legacy,
    partWeightUnit: legacy,
    ...parsed
  }
}

/** Derived inner carton dimensions (mm), applying wall thickness when entering outer. */
export function innerCartonMm(s: PackingSettings): Vec3 {
  if (!s.enterOuter) return s.boxDimsMm
  const w = 2 * s.wallMm
  return [s.boxDimsMm[0] - w, s.boxDimsMm[1] - w, s.boxDimsMm[2] - w]
}
