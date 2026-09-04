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

/**
 * Float dust off a converted value, and nothing else.
 *
 * A carton typed as 6 in is stored as 6 × 25.4 = 152.39999999999998 mm and
 * comes back as 5.999999999999999 in — an exact binary round-trip of a value
 * that has no exact binary form. It changed no answer (3 plates need 2.86 in
 * of a 3.5 in span), but the 5th dogfood read it in an ECHO of its own input
 * and had to reason about whether the app had understood the number. A reply
 * that makes a reader re-derive its own input has cost more than it saved.
 *
 * 1e-10 is the threshold because it is unambiguous in both directions: float
 * dust here is ~1e-15 relative, and 1e-10 in is 2.5 picometres — below any
 * dimension a carton, a part or a scale will ever carry, so nothing real is
 * ever rounded away. The panel does the same thing at the same boundary with
 * `round4` (InputsPanel.tsx); this is the reply's counterpart, and it is
 * deliberately four orders finer, because a display may round for legibility
 * and a payload may only round away what is not information.
 *
 * Applied at CONVERSION, not at computation: the engine keeps full precision
 * and every arithmetic check a reader does still reconciles.
 */
const tidy = (x: number): number =>
  Number.isFinite(x) ? Math.round(x * 1e10) / 1e10 : x

export const toMm = (length: LengthValue): number => lengthToMm(length.value, systemOf(length.unit))
export const fromMm = (mm: number, unit: LengthUnit): LengthValue => ({
  value: tidy(mmToLength(mm, systemOf(unit))),
  unit
})

export const toG = (weight: WeightValue): number => weightToG(weight.value, weight.unit)
export const fromG = (g: number, unit: WeightUnit): WeightValue => ({
  value: tidy(gToWeight(g, unit)),
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
    x: tidy(mmToLength(mm[0], system)),
    y: tidy(mmToLength(mm[1], system)),
    z: tidy(mmToLength(mm[2], system)),
    unit
  }
}

/** Volume units track the length unit rather than being chosen separately: a
 *  reply quoting inches and cubic millimetres would be arithmetically correct
 *  and useless. */
export const volumeUnitFor = (unit: LengthUnit): VolumeUnit => (unit === 'in' ? 'in3' : 'mm3')
export const volumeFromMm3 = (mm3: number, unit: LengthUnit): VolumeValue => ({
  value: tidy(mm3ToVolume(mm3, systemOf(unit))),
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
