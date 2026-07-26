// Canonical internal units are millimeters and grams (ADR-0004).
// Every conversion constant in the app lives in this file.

export const MM_PER_IN = 25.4
export const G_PER_LB = 453.59237
export const G_PER_KG = 1000

export const inToMm = (inches: number): number => inches * MM_PER_IN
export const mmToIn = (mm: number): number => mm / MM_PER_IN
export const lbToG = (lb: number): number => lb * G_PER_LB
export const gToLb = (g: number): number => g / G_PER_LB
export const kgToG = (kg: number): number => kg * G_PER_KG
export const gToKg = (g: number): number => g / G_PER_KG

/** 1 cm³ = 1000 mm³. Densities are quoted per cm³ but mesh volume is mm³
 *  (canonical), so this is the bridge — and, being a conversion constant, it
 *  lives here with the others (ADR-0004). */
export const MM3_PER_CM3 = 1000

/** Part weight from a material density and a mesh volume (ADR-0004's second
 *  weight source). Exact only for closed meshes — the open-mesh warning is
 *  roadmap item 9. */
export const densityWeightG = (densityGPerCm3: number, volumeMm3: number): number =>
  (densityGPerCm3 * volumeMm3) / MM3_PER_CM3

export type UnitSystem = 'metric' | 'imperial'

export const lengthToMm = (value: number, units: UnitSystem): number =>
  units === 'imperial' ? inToMm(value) : value
export const mmToLength = (mm: number, units: UnitSystem): number =>
  units === 'imperial' ? mmToIn(mm) : mm
export const weightToG = (value: number, units: UnitSystem): number =>
  units === 'imperial' ? lbToG(value) : kgToG(value)
export const gToWeight = (g: number, units: UnitSystem): number =>
  units === 'imperial' ? gToLb(g) : gToKg(g)

export const lengthUnitLabel = (units: UnitSystem): string => (units === 'imperial' ? 'in' : 'mm')
export const weightUnitLabel = (units: UnitSystem): string => (units === 'imperial' ? 'lb' : 'kg')

/** Volume for display (ADR-0017's CSV column). Cubing the length factor here
 *  rather than at the call site keeps ADR-0004's rule intact: every conversion
 *  constant in the app lives in this file, so `MM_PER_IN ** 3` cannot appear
 *  loose in an export module. */
export const mm3ToVolume = (mm3: number, units: UnitSystem): number =>
  units === 'imperial' ? mm3 / MM_PER_IN ** 3 : mm3
export const volumeUnitLabel = (units: UnitSystem): string =>
  units === 'imperial' ? 'in³' : 'mm³'

/** Default max package weight: 35 lb, stored canonically in grams (ADR-0004). */
export const DEFAULT_MAX_WEIGHT_G = lbToG(35)
