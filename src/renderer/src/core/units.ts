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

/** Default max package weight: 35 lb, stored canonically in grams (ADR-0004). */
export const DEFAULT_MAX_WEIGHT_G = lbToG(35)
