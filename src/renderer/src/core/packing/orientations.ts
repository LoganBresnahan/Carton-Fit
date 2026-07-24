import { computeAabb } from '../geometry'
import type { Mat3, OrientationOption, OrientationProvider, Vec3 } from './types'

// fast-aabb-orientations (ADR-0003): the 6 ways a part's axis-aligned bounding box
// can be laid against the carton axes. Each is a PROPER rotation (det +1, per the
// contract), so a placed mesh is never mirrored — the 6 come from the box's rotation
// symmetry group, not from reflections. This is the fast tier's OrientationProvider.

/** The 6 proper rotations that produce the 6 distinct extent permutations.
 *  Row-major, applied as v' = M · v. */
const ROTATIONS: readonly Mat3[] = [
  [1, 0, 0, 0, 1, 0, 0, 0, 1], //   identity            → (x, y, z)
  [0, -1, 0, 1, 0, 0, 0, 0, 1], //  90° about Z         → (y, x, z)
  [0, 0, 1, 0, 1, 0, -1, 0, 0], //  90° about Y         → (z, y, x)
  [1, 0, 0, 0, 0, -1, 0, 1, 0], //  90° about X         → (x, z, y)
  [0, 0, 1, 1, 0, 0, 0, 1, 0], //   120° about diagonal → (z, x, y)
  [0, 1, 0, 0, 0, 1, 1, 0, 0] //    120° the other way  → (y, z, x)
]

export function applyMat3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
  ]
}

/** Determinant — used to assert the rotations are proper (det +1). */
export function det3(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  )
}

/** AABB of an axis-aligned box after rotation by `m`, via its 8 transformed corners.
 *  Exact for the 90°-multiple rotations here (a rotated box is again axis-aligned). */
function rotatedAabb(min: Vec3, max: Vec3, m: Mat3): { min: Vec3; max: Vec3 } {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity]
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let cx = 0; cx < 2; cx++) {
    for (let cy = 0; cy < 2; cy++) {
      for (let cz = 0; cz < 2; cz++) {
        const p = applyMat3(m, [cx ? max[0] : min[0], cy ? max[1] : min[1], cz ? max[2] : min[2]])
        for (let a = 0; a < 3; a++) {
          if (p[a] < lo[a]) lo[a] = p[a]
          if (p[a] > hi[a]) hi[a] = p[a]
        }
      }
    }
  }
  return { min: lo, max: hi }
}

/** The fast tier's OrientationProvider: AABB → 6 oriented candidates. */
export const aabbOrientations: OrientationProvider = (part) => {
  const box = computeAabb(part.positions)
  return ROTATIONS.map((m): OrientationOption => {
    const r = rotatedAabb(box.min, box.max, m)
    return {
      rotation: m,
      rotatedMin: r.min,
      extent: [r.max[0] - r.min[0], r.max[1] - r.min[1], r.max[2] - r.min[2]]
    }
  })
}
