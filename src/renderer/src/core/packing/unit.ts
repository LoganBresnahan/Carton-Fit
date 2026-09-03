import type { PackPart } from './types'

// max-quantity-unit-selection (ADR-0003 phase 5): in max-quantity mode the answer
// is "how many copies of ONE unit fit". That unit is either a single selected part
// or the whole file treated as one rigid unit. The renderer decides WHICH parts
// make the unit (a picker, or all of them) and passes them in the request; this
// function fuses them into a single PackPart the orientation providers consume.
//
// Fusing = concatenating the parts' position buffers. Because occt bakes world
// transforms into each part's coordinates (ADR-0002 addendum), the concatenation
// is the parts in their assembled arrangement — a genuine rigid unit, not parts
// piled at the origin. Concatenation is also the general form of the "composite
// AABB (min/max fold)": the fast tier's AABB of the union equals the min/max fold
// of the per-part AABBs, while the thorough tier gets the true convex hull of the
// union for free. Weights sum.

/**
 * The name a fused whole-file unit carries, and the test for it.
 *
 * Exported because the packed VIEW has to recognise it (2026-09-03 dogfood):
 * a placement named "18 parts" matches no real part, and the scene builder's
 * stale-data guard skipped it — so a max-quantity answer with no unit part
 * selected rendered an empty carton beside a count of 1, in both AI clients.
 * A convention two modules share has to be written down once, not matched by
 * string in the second.
 */
export function fusedUnitName(partCount: number): string {
  return `${partCount} parts`
}

export function isFusedUnit(name: string, partCount: number): boolean {
  return partCount > 1 && name === fusedUnitName(partCount)
}

export function composeUnit(parts: readonly PackPart[]): PackPart {
  if (parts.length === 0) {
    throw new Error('composeUnit: need at least one part to form a unit')
  }
  if (parts.length === 1) return parts[0]

  let totalFloats = 0
  let weightG = 0
  for (const p of parts) {
    totalFloats += p.positions.length
    weightG += p.weightG
  }
  const positions = new Float32Array(totalFloats)
  let offset = 0
  for (const p of parts) {
    positions.set(p.positions, offset)
    offset += p.positions.length
  }
  return { name: fusedUnitName(parts.length), positions, weightG }
}
