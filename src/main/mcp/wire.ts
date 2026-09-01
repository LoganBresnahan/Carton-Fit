import {
  gToWeight,
  lengthToMm,
  mm3ToVolume,
  mmToLength,
  weightToG,
  type UnitSystem,
  type WeightUnit
} from '../../renderer/src/core/units'

// The unit vocabulary of the MCP wire (ADR-0029, slice `explicit-units-wire-contract`).
//
// THE RULE: no number crosses this boundary without its unit attached to it.
// Not "the call declared inches somewhere above", not "mm because that is
// canonical" — every value is a `{ value, unit }` pair, in both directions.
//
// The reason is what the reader is. A person mis-typing 12 mm for 12 in sees a
// carton the size of a sugar cube on screen and fixes it in a second; an AI
// client receives `304.8` and has no picture to check it against, so a missed
// conversion becomes a confident, plausible, wrong number in a packing quote.
// ADR-0015's rule — the app must not state what it cannot support — is what
// this implements at the wire.
//
// It also happens to make ADR-0024 free. Weight units are decoupled from length
// units (a carton in inches routinely holds parts weighed in grams), so a single
// `units: 'imperial'` field on the call would be wrong BY DESIGN. Because every
// value carries its own unit there is no such field to get wrong: the decoupling
// is structural rather than remembered.
//
// Conversion math itself lives where ADR-0004 says it lives — `core/units.ts`,
// the only file in the app allowed to contain a conversion constant. Nothing
// here computes; it only maps the wire's spelling of a unit onto that module's.

export type LengthUnit = 'mm' | 'in'
export type VolumeUnit = 'mm3' | 'in3'
/** Weight units are `core/units.ts`'s own `WeightUnit` — g, kg, lb. */
export type { WeightUnit }

export interface LengthValue {
  value: number
  unit: LengthUnit
}
export interface WeightValue {
  value: number
  unit: WeightUnit
}
export interface VolumeValue {
  value: number
  unit: VolumeUnit
}

/** A box, in the carton's own axes. Named x/y/z rather than length/width/height
 *  because the engine's `Vec3` is positional and any other naming would invite a
 *  silent transposition at the boundary — the axes are not interchangeable once
 *  clearances differ per face. */
export interface DimensionsValue {
  x: number
  y: number
  z: number
  unit: LengthUnit
}

/** The wire's length unit as `core/units.ts` spells unit systems. */
const systemOf = (unit: LengthUnit): UnitSystem => (unit === 'in' ? 'imperial' : 'metric')

export const toMm = (length: LengthValue): number => lengthToMm(length.value, systemOf(length.unit))
export const fromMm = (mm: number, unit: LengthUnit): LengthValue => ({
  value: mmToLength(mm, systemOf(unit)),
  unit
})

export const toG = (weight: WeightValue): number => weightToG(weight.value, weight.unit)
export const fromG = (g: number, unit: WeightUnit): WeightValue => ({
  value: gToWeight(g, unit),
  unit
})

export const dimsToMm = (dims: DimensionsValue): [number, number, number] => {
  const system = systemOf(dims.unit)
  return [
    lengthToMm(dims.x, system),
    lengthToMm(dims.y, system),
    lengthToMm(dims.z, system)
  ]
}

export const dimsFromMm = (
  mm: readonly [number, number, number],
  unit: LengthUnit
): DimensionsValue => {
  const system = systemOf(unit)
  return {
    x: mmToLength(mm[0], system),
    y: mmToLength(mm[1], system),
    z: mmToLength(mm[2], system),
    unit
  }
}

/** Volume units track the length unit rather than being chosen separately: a
 *  reply quoting inches and cubic millimetres would be arithmetically correct
 *  and useless. */
export const volumeUnitFor = (unit: LengthUnit): VolumeUnit => (unit === 'in' ? 'in3' : 'mm3')
export const volumeFromMm3 = (mm3: number, unit: LengthUnit): VolumeValue => ({
  value: mm3ToVolume(mm3, systemOf(unit)),
  unit: volumeUnitFor(unit)
})

/** What units a reply is written in. Length and weight are chosen independently
 *  (ADR-0024) and both default to canonical, so a caller that says nothing gets
 *  the app's internal truth rather than a guess about their locale. */
export interface OutputUnits {
  length: LengthUnit
  weight: WeightUnit
}

export const DEFAULT_OUTPUT_UNITS: OutputUnits = { length: 'mm', weight: 'g' }

export function resolveOutputUnits(requested?: Partial<OutputUnits>): OutputUnits {
  return {
    length: requested?.length ?? DEFAULT_OUTPUT_UNITS.length,
    weight: requested?.weight ?? DEFAULT_OUTPUT_UNITS.weight
  }
}
