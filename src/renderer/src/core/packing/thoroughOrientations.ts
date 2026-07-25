import { minimalObb } from './obb'
import { AXIS_ROTATIONS, aabbOrientations, mulMat3, rotatedAabb } from './orientations'
import type { OrientationOption, OrientationProvider, Vec3 } from './types'

// thorough-placement-and-rotations (ADR-0003 phase 4): the thorough tier's
// OrientationProvider. The part is first taken into its minimal-OBB frame, then
// laid against the carton axes in each of the 6 axis permutations — so every
// candidate's rotation is ONE composed matrix the placement/render pipeline can
// apply directly.
//
// The conventions this file must not get wrong (each renders plausibly while
// silently wrong, which is why the slice carries a verify):
//  - Composition ORDER: the contract applies rotations as v' = M · v, so
//    "OBB frame first, then permutation" is composed = R · M_obb — never the
//    transpose or the swapped product. det = det(R) · det(M_obb) = +1 stays
//    proper by construction.
//  - Extent and rotatedMin come from rotating the OBB-frame box [rotatedMin,
//    rotatedMin + extent] by the signed permutation R — exact for 90°-multiple
//    rotations, and exactly what `translation = corner − rotatedMin` needs for
//    the OBB-local → carton hand-off.
//  - SUPERSET guarantee: the 6 fast-tier AABB candidates are always included.
//    A smaller-volume OBB can still grid-pack FEWER copies (floor() effects on
//    mismatched dims), so "thorough never beats fast downward" must hold by
//    construction, not by luck. OBB candidates are listed first so equal-count
//    ties resolve to the OBB orientation.

export const thoroughOrientations: OrientationProvider = (part) => {
  const obb = minimalObb(part.positions)
  const obbMax: Vec3 = [
    obb.rotatedMin[0] + obb.extent[0],
    obb.rotatedMin[1] + obb.extent[1],
    obb.rotatedMin[2] + obb.extent[2]
  ]
  const obbOptions = AXIS_ROTATIONS.map((r): OrientationOption => {
    const box = rotatedAabb(obb.rotatedMin, obbMax, r)
    return {
      rotation: mulMat3(r, obb.rotation),
      rotatedMin: box.min,
      extent: [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]]
    }
  })
  return [...obbOptions, ...aabbOrientations(part)]
}
