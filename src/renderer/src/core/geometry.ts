// Pure mesh geometry for the import pipeline (ADR-0002). No three.js, no DOM —
// runs in workers and vitest. Inputs are protocol geometry (flat xyz triplets +
// triangle indices) in canonical millimeters.

/** Comparisons against box/weight limits use this explicit epsilon (canonical
 *  mm/g scale) — never a bare float <= on accumulated sums. */
export const EPS = 1e-6

export interface Aabb {
  min: [number, number, number]
  max: [number, number, number]
}

/** Axis-aligned bounding box of a vertex-position buffer (flat xyz triplets). */
export function computeAabb(positions: Float32Array): Aabb {
  if (positions.length === 0 || positions.length % 3 !== 0) {
    throw new Error(`computeAabb: expected non-empty xyz triplets, got ${positions.length} floats`)
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const v = positions[i + axis]
      if (v < min[axis]) min[axis] = v
      if (v > max[axis]) max[axis] = v
    }
  }
  return { min, max }
}

/** [x, y, z] extent of an AABB. */
export function aabbSize(box: Aabb): [number, number, number] {
  return [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]]
}

function assertTriangles(indices: Uint32Array): void {
  if (indices.length % 3 !== 0) {
    throw new Error(`expected triangle indices (multiple of 3), got ${indices.length}`)
  }
}

/**
 * Enclosed volume (mm³) via the signed-tetrahedron sum: each triangle forms a
 * tetrahedron with the origin, and the signed volumes cancel outside the solid.
 * Correct for any closed mesh with consistent winding, regardless of where the
 * origin sits. `Math.abs` makes it winding-direction agnostic. On an *open*
 * mesh the number is meaningless — gate it with {@link isClosedMesh}.
 */
export function meshVolume(positions: Float32Array, indices: Uint32Array): number {
  assertTriangles(indices)
  let sixVolume = 0
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3
    const b = indices[t + 1] * 3
    const c = indices[t + 2] * 3
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2]
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2]
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2]
    // a · (b × c)
    sixVolume += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
  }
  return Math.abs(sixVolume) / 6
}

/**
 * Is the mesh a watertight manifold (every edge shared by exactly two triangles)?
 *
 * THE TRAP (ADR-0002 verify): OpenCascade tessellates each face independently, so
 * a vertex on a shared edge appears as several *distinct indices* with equal
 * coordinates. An index-based edge check would see those as unmatched boundary
 * edges and call every real STEP solid "open". So we weld by *position*: quantize
 * each vertex to a tolerance and key edges by welded endpoints. The tolerance is
 * relative to the model's extent (float32 coincident-vertex noise scales with
 * coordinate magnitude), with an absolute floor for degenerate/zero-size meshes.
 */
export function isClosedMesh(
  positions: Float32Array,
  indices: Uint32Array,
  weldTolerance?: number
): boolean {
  assertTriangles(indices)
  if (indices.length === 0) return false

  const eps = weldTolerance ?? defaultWeldTolerance(positions)
  const invEps = 1 / eps

  // Map each vertex index to a welded-position id, so coincident-but-distinct
  // occt vertices collapse to one id before edges are counted.
  const weldId = new Map<string, number>()
  const vertexToWeld = new Int32Array(positions.length / 3)
  for (let v = 0; v < positions.length / 3; v++) {
    const key = quantKey(positions, v * 3, invEps)
    let id = weldId.get(key)
    if (id === undefined) {
      id = weldId.size
      weldId.set(key, id)
    }
    vertexToWeld[v] = id
  }

  const edgeCount = new Map<string, number>()
  for (let t = 0; t < indices.length; t += 3) {
    const w0 = vertexToWeld[indices[t]]
    const w1 = vertexToWeld[indices[t + 1]]
    const w2 = vertexToWeld[indices[t + 2]]
    bumpEdge(edgeCount, w0, w1)
    bumpEdge(edgeCount, w1, w2)
    bumpEdge(edgeCount, w2, w0)
  }

  for (const count of edgeCount.values()) {
    if (count !== 2) return false
  }
  return true
}

function defaultWeldTolerance(positions: Float32Array): number {
  const box = computeAabb(positions)
  const [sx, sy, sz] = aabbSize(box)
  const diag = Math.hypot(sx, sy, sz)
  // 1e-5 of the diagonal comfortably clears float32 coincident-vertex noise
  // (~1e-6·coordinate) while staying far below any real feature size.
  return Math.max(diag * 1e-5, 1e-9)
}

function quantKey(positions: Float32Array, offset: number, invEps: number): string {
  const x = Math.round(positions[offset] * invEps)
  const y = Math.round(positions[offset + 1] * invEps)
  const z = Math.round(positions[offset + 2] * invEps)
  return `${x},${y},${z}`
}

function bumpEdge(edgeCount: Map<string, number>, a: number, b: number): void {
  const key = a < b ? `${a}_${b}` : `${b}_${a}`
  edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1)
}

/**
 * A triangle whose vertex normals turn by less than this is on a surface that
 * does not turn there. Named for the one question it answers (wire rule 6):
 * float32 unit normals on a planar face agree to ~1e-6 rad, so 0.1° is far
 * above the noise and far below any tessellation step a modeller would choose.
 */
export const PLANAR_TURN_DEG = 0.1

/**
 * The largest angle, in degrees, by which the three vertex normals of any one
 * triangle disagree — 0 for a mesh whose every triangle lies flat on its
 * surface (ADR-0015 addendum 2).
 *
 * Only meaningful for SURFACE normals (`ImportedPart.origin === 'brep'`): the
 * importer evaluates the B-rep face's normal at each node, so on a cylinder
 * the normals across one triangle turn by exactly the facet's subtended
 * angle, and on a planar face they do not turn at all. Facet normals (an
 * STL's) are constant per triangle by construction and return 0 whatever
 * the shape — the caller has to know which it holds.
 */
export function facetTurnDeg(normals: Float32Array, indices: Uint32Array): number {
  assertTriangles(indices)
  let minDot = 1
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3
    const b = indices[t + 1] * 3
    const c = indices[t + 2] * 3
    const ab = normals[a] * normals[b] + normals[a + 1] * normals[b + 1] + normals[a + 2] * normals[b + 2]
    const ac = normals[a] * normals[c] + normals[a + 1] * normals[c + 1] + normals[a + 2] * normals[c + 2]
    const bc = normals[b] * normals[c] + normals[b + 1] * normals[c + 1] + normals[b + 2] * normals[c + 2]
    const d = Math.min(ab, ac, bc)
    if (d < minDot) minDot = d
  }
  if (minDot >= 1) return 0
  return (Math.acos(Math.max(-1, minDot)) * 180) / Math.PI
}

/**
 * A bound, in mm³, on how much volume a tessellation of curved faces can
 * misstate — the deflection bound ADR-0015 addendum 2 deferred and addendum 3
 * built, after the 23rd dogfood found the whole-volume fraction it shipped
 * with was wider than every curved feature on the plate put together.
 *
 * Per triangle whose surface normals turn: the facet is a chord across an arc,
 * and the arc sits at most one sagitta off the chord. For an edge of length
 * `L`, the turn that matters is the normal change RESOLVED ALONG THE EDGE —
 * `d = (n_q − n_p)·ê`, which is `2·sin(φ_e/2)` for the normal section's own
 * angle φ_e — and the sagitta of the circular arc through both ends is
 * `s = (L/2)·tan(φ_e/4)`. Resolving matters: on a cylinder a facet's diagonal
 * spans the same 15° as its chord but is four times longer, and the chord's
 * turn taken as the diagonal's would put the arc sixteen times further off
 * than it is. The volume between the facet and the surface is at most the
 * facet's area × the largest such sagitta over its edges. Summed over the
 * mesh, that is a bound on the enclosed volume's error, and it scales with
 * the CURVED area, which is what the old fraction did not: a plate that is a
 * block with six holes gets six hole-walls' worth, not 2% of the block.
 *
 * A bound by construction on a singly curved face (a cylinder's true error
 * is two-thirds of it: segment over chord × sagitta). On a doubly curved face
 * the facet's centre can sit further off than its edges' midpoints, but the
 * error is an integral and the facet's average deviation stays under the edge
 * sagitta for any triangle a tessellator produces — a deliberately
 * sliver-triangulated sphere is the case this does not promise. Either way in
 * sign: an inscribed polygon understates a convex surface and overstates a
 * hole. 0 on a planar solid.
 */
export function tessellationErrorMm3(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array
): number {
  assertTriangles(indices)
  // Below the planar threshold the normals agree to float32 noise, and a
  // sagitta computed from noise is noise: skip the edge.
  const planarHalfSine = Math.sin((PLANAR_TURN_DEG * Math.PI) / 360)
  let total = 0
  for (let t = 0; t < indices.length; t += 3) {
    const corners = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3]
    let sagitta = 0
    for (let e = 0; e < 3; e++) {
      const p = corners[e]
      const q = corners[(e + 1) % 3]
      const ex = positions[q] - positions[p]
      const ey = positions[q + 1] - positions[p + 1]
      const ez = positions[q + 2] - positions[p + 2]
      const length = Math.hypot(ex, ey, ez)
      if (length === 0) continue
      // The normal change along the edge: 2·sin(φ_e/2) for the normal
      // section's angle. Sign says convex or concave; the bound is either way.
      const along =
        ((normals[q] - normals[p]) * ex +
          (normals[q + 1] - normals[p + 1]) * ey +
          (normals[q + 2] - normals[p + 2]) * ez) /
        length
      const halfSine = Math.min(1, Math.abs(along) / 2)
      if (halfSine <= planarHalfSine) continue
      const turn = 2 * Math.asin(halfSine)
      sagitta = Math.max(sagitta, (length / 2) * Math.tan(turn / 4))
    }
    if (sagitta === 0) continue
    const [a, b, c] = corners
    const ux = positions[b] - positions[a]
    const uy = positions[b + 1] - positions[a + 1]
    const uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a]
    const vy = positions[c + 1] - positions[a + 1]
    const vz = positions[c + 2] - positions[a + 2]
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
    total += area * sagitta
  }
  return total
}

/**
 * The bound above as a fraction of the volume it qualifies — what a density
 * weight is multiplied by for its band. 0 when the volume is 0 (nothing to
 * be a fraction of) and 0 on a planar solid, where the error is 0.
 */
export function tessellationTolerance(errorMm3: number, volumeMm3: number): number {
  const volume = Math.abs(volumeMm3)
  if (volume === 0 || errorMm3 <= 0) return 0
  return errorMm3 / volume
}
