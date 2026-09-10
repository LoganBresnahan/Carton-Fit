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
 * How far, as a fraction either way, a tessellation whose facets turn by at
 * most `turnDeg` at a step can misstate the volume it encloses.
 *
 * A chord across an arc of θ radians loses 1 − sin θ/θ of the sector it
 * spans (segment over sector: (θ − sin θ)/θ); a doubly curved surface — a
 * fillet, a sphere — loses it in both directions, hence the 2. About 1.06%
 * per direction at 14.5°, the reference bolt's step. EITHER WAY: an inscribed
 * polygon understates a convex surface and overstates a hole. 0 when planar.
 */
export function tessellationTolerance(turnDeg: number): number {
  if (turnDeg <= PLANAR_TURN_DEG) return 0
  const theta = (turnDeg * Math.PI) / 180
  return 2 * (1 - Math.sin(theta) / theta)
}
