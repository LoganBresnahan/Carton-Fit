import { convexHull3d } from './convexHull3d'
import type { HullFace } from './convexHull3d'
import { IDENTITY_MAT3 } from './types'
import type { Mat3, Vec3 } from './types'

// obb-rotation-search (ADR-0003): minimal-volume oriented bounding box via convex
// hull + hull-face-aligned rotation search. For each candidate axis w (a hull face
// normal), the best box with a face ⊥ w has its in-plane axes given by the minimal-
// area enclosing rectangle of the projected hull (rotating-calipers theorem: that
// rectangle shares a direction with a 2D hull edge). Face-aligned search is the
// classic heuristic — the true optimum can require edge-pair directions (O'Rourke),
// which is one reason thorough-tier results stay labeled heuristic.
//
// Guards against the silent failure modes this slice was rated for:
//  - The returned box is ALWAYS re-measured over every input point, not just hull
//    vertices — it contains the part even if quickhull mis-classified a point.
//  - The identity (AABB) orientation always competes, so volume ≤ AABB volume by
//    construction and `thorough ≥ fast` survives downstream.
//  - Handedness: every candidate basis is (u, v, w) with v = w × u and in-plane
//    rows (a1, a2) a rotation of (u, v) — det is +1 by construction, never
//    sign-patched after the fact.

export interface Obb {
  /** Part → OBB-frame proper rotation (row-major, v' = M·v); rows are the box axes. */
  rotation: Mat3
  /** Box extent along its axes (mm), matching the rotation rows. */
  extent: Vec3
  /** Min corner of the rotated part — placement anchor, same convention as OrientationOption. */
  rotatedMin: Vec3
  /** extent product (mm³). */
  volume: number
  /** 'hull-search' = the search ran (including exact degenerate paths);
   *  'aabb-fallback' = quickhull did not converge and the plain AABB was returned. */
  source: 'hull-search' | 'aabb-fallback'
}

interface Measured {
  rotation: Mat3
  extent: Vec3
  rotatedMin: Vec3
  volume: number
}

/** AABB of the rotated point cloud — exact over ALL points, the containment guard. */
function measure(P: Float32Array, m: Mat3): Measured {
  let lo0 = Infinity
  let lo1 = Infinity
  let lo2 = Infinity
  let hi0 = -Infinity
  let hi1 = -Infinity
  let hi2 = -Infinity
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i]
    const y = P[i + 1]
    const z = P[i + 2]
    const r0 = m[0] * x + m[1] * y + m[2] * z
    const r1 = m[3] * x + m[4] * y + m[5] * z
    const r2 = m[6] * x + m[7] * y + m[8] * z
    if (r0 < lo0) lo0 = r0
    if (r0 > hi0) hi0 = r0
    if (r1 < lo1) lo1 = r1
    if (r1 > hi1) hi1 = r1
    if (r2 < lo2) lo2 = r2
    if (r2 > hi2) hi2 = r2
  }
  const extent: Vec3 = [hi0 - lo0, hi1 - lo1, hi2 - lo2]
  return {
    rotation: m,
    extent,
    rotatedMin: [lo0, lo1, lo2],
    volume: extent[0] * extent[1] * extent[2]
  }
}

// Box ranking. Volume first; near-ties (every candidate of a flat part has
// volume ≈ 0) fall through to half-surface-area, then extent sum — so a planar
// part picks the minimal rectangle and a wire picks the axis-aligned segment.
const near = (x: number, y: number): boolean =>
  Math.abs(x - y) <= 1e-6 * Math.max(Math.abs(x), Math.abs(y), 1e-9)

function betterBox(a: { volume: number; extent: Vec3 }, b: { volume: number; extent: Vec3 }): boolean {
  if (!near(a.volume, b.volume)) return a.volume < b.volume
  const sa = a.extent[0] * a.extent[1] + a.extent[1] * a.extent[2] + a.extent[2] * a.extent[0]
  const sb = b.extent[0] * b.extent[1] + b.extent[1] * b.extent[2] + b.extent[2] * b.extent[0]
  if (!near(sa, sb)) return sa < sb
  return a.extent[0] + a.extent[1] + a.extent[2] < b.extent[0] + b.extent[1] + b.extent[2]
}

/** Unit vector perpendicular to w, seeded from the axis least aligned with it. */
function anyPerpendicular(w: Vec3): Vec3 {
  const ax = Math.abs(w[0])
  const ay = Math.abs(w[1])
  const az = Math.abs(w[2])
  const e: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1]
  const d = e[0] * w[0] + e[1] * w[1] + e[2] * w[2]
  const u: [number, number, number] = [e[0] - d * w[0], e[1] - d * w[1], e[2] - d * w[2]]
  const l = Math.hypot(u[0], u[1], u[2])
  return [u[0] / l, u[1] / l, u[2] / l]
}

function crossV(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** 2D convex hull (monotone chain), CCW, collinear points dropped.
 *  Degenerate inputs come back short: 2 points for a segment, 1 for a point. */
function hull2d(px: number[], py: number[]): number[] {
  const idx = px.map((_, i) => i).sort((i, j) => px[i] - px[j] || py[i] - py[j])
  const cross2 = (o: number, a: number, b: number): number =>
    (px[a] - px[o]) * (py[b] - py[o]) - (py[a] - py[o]) * (px[b] - px[o])
  const build = (order: number[]): number[] => {
    const chain: number[] = []
    for (const i of order) {
      while (chain.length >= 2 && cross2(chain[chain.length - 2], chain[chain.length - 1], i) <= 0)
        chain.pop()
      chain.push(i)
    }
    chain.pop() // endpoint duplicates the other chain's start
    return chain
  }
  const hull = [...build(idx), ...build([...idx].reverse())]
  return hull.length > 0 ? hull : [idx[0]]
}

interface Candidate {
  rotation: Mat3
  /** Extents estimated on the projected point set — used only to RANK candidates;
   *  the winner is re-measured exactly over all points. */
  extent: Vec3
  volume: number
}

/** Best box having one axis along w: minimal-area enclosing rectangle of the
 *  points projected along w (searched over 2D hull edge directions). */
function alignedCandidate(P: Float32Array, indices: readonly number[], w: Vec3): Candidate {
  const u = anyPerpendicular(w)
  const v = crossV(w, u) // (u, v, w) right-handed: u × v = w

  const px: number[] = new Array(indices.length)
  const py: number[] = new Array(indices.length)
  let wLo = Infinity
  let wHi = -Infinity
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k] * 3
    const x = P[i]
    const y = P[i + 1]
    const z = P[i + 2]
    px[k] = x * u[0] + y * u[1] + z * u[2]
    py[k] = x * v[0] + y * v[1] + z * v[2]
    const pw = x * w[0] + y * w[1] + z * w[2]
    if (pw < wLo) wLo = pw
    if (pw > wHi) wHi = pw
  }

  const h = hull2d(px, py)
  let bestArea = Infinity
  let bestDir: [number, number] = [1, 0]
  let bestE: [number, number] = [0, 0]
  for (let i = 0; i < h.length; i++) {
    const a = h[i]
    const b = h[(i + 1) % h.length]
    const dx = px[b] - px[a]
    const dy = py[b] - py[a]
    const l = Math.hypot(dx, dy)
    if (l <= 1e-30) continue
    const d: [number, number] = [dx / l, dy / l]
    let sLo = Infinity
    let sHi = -Infinity
    let tLo = Infinity
    let tHi = -Infinity
    for (const k of h) {
      const s = px[k] * d[0] + py[k] * d[1]
      const t = -px[k] * d[1] + py[k] * d[0]
      if (s < sLo) sLo = s
      if (s > sHi) sHi = s
      if (t < tLo) tLo = t
      if (t > tHi) tHi = t
    }
    const area = (sHi - sLo) * (tHi - tLo)
    if (area < bestArea) {
      bestArea = area
      bestDir = d
      bestE = [sHi - sLo, tHi - tLo]
    }
  }
  if (bestArea === Infinity) {
    // all projected points coincide — any in-plane direction serves
    bestE = [0, 0]
  }

  const [dx, dy] = bestDir
  const a1: Vec3 = [dx * u[0] + dy * v[0], dx * u[1] + dy * v[1], dx * u[2] + dy * v[2]]
  const a2: Vec3 = [-dy * u[0] + dx * v[0], -dy * u[1] + dx * v[1], -dy * u[2] + dx * v[2]]
  const extent: Vec3 = [bestE[0], bestE[1], wHi - wLo]
  return {
    rotation: [a1[0], a1[1], a1[2], a2[0], a2[1], a2[2], w[0], w[1], w[2]],
    extent,
    volume: extent[0] * extent[1] * extent[2]
  }
}

/** Candidate axes: one per distinct face-normal direction (w and −w bound the
 *  same box, so normals are sign-canonicalized before dedup), CAPPED at the
 *  largest aggregated face areas. A tessellated curved surface contributes
 *  thousands of nearly-identical normals and the search is O(candidates × hull
 *  vertices) — 10–26 s on a 10k cylinder / 8k sphere without the cap, exact
 *  volumes and ~100 ms with it. Area ranking keeps the decisive directions: a
 *  flat facet aggregates into one heavy bin that always survives, while a smooth
 *  region keeps a spread of representatives (any of which boxes it well). */
const MAX_CANDIDATE_DIRECTIONS = 256

function candidateDirections(P: Float32Array, faces: readonly HullFace[]): Vec3[] {
  const bins = new Map<string, { dir: Vec3; area: number }>()
  for (const f of faces) {
    let [x, y, z] = f.normal
    if (x < -1e-12 || (Math.abs(x) <= 1e-12 && (y < -1e-12 || (Math.abs(y) <= 1e-12 && z < 0)))) {
      x = -x
      y = -y
      z = -z
    }
    const ax = P[f.a * 3]
    const ay = P[f.a * 3 + 1]
    const az = P[f.a * 3 + 2]
    const ux = P[f.b * 3] - ax
    const uy = P[f.b * 3 + 1] - ay
    const uz = P[f.b * 3 + 2] - az
    const vx = P[f.c * 3] - ax
    const vy = P[f.c * 3 + 1] - ay
    const vz = P[f.c * 3 + 2] - az
    const area =
      Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
    const key = `${Math.round(x * 512)},${Math.round(y * 512)},${Math.round(z * 512)}`
    const bin = bins.get(key)
    if (bin) bin.area += area
    else bins.set(key, { dir: [x, y, z], area })
  }
  return [...bins.values()]
    .sort((p, q) => q.area - p.area) // stable sort + insertion order ⇒ deterministic
    .slice(0, MAX_CANDIDATE_DIRECTIONS)
    .map((b) => b.dir)
}

/** Minimal-volume OBB of a position buffer (flat xyz triplets, mm). */
export function minimalObb(positions: Float32Array): Obb {
  const hull = convexHull3d(positions)
  const identity = measure(positions, IDENTITY_MAT3)

  if (hull.kind === 'unconverged') {
    return { ...identity, source: 'aabb-fallback' }
  }

  let candidates: Candidate[] = []
  switch (hull.kind) {
    case 'point':
      break // the identity box is exact (zero extent)
    case 'line': {
      // Rows (d, u, v): det = d · (u × (d × u)) = 1; extent estimates are moot
      // for a single candidate — the exact measure below decides.
      const d = hull.direction
      const u = anyPerpendicular(d)
      const v = crossV(d, u)
      candidates = [
        {
          rotation: [d[0], d[1], d[2], u[0], u[1], u[2], v[0], v[1], v[2]],
          extent: [0, 0, 0],
          volume: 0
        }
      ]
      break
    }
    case 'plane': {
      const all = Array.from({ length: positions.length / 3 }, (_, i) => i)
      candidates = [alignedCandidate(positions, all, hull.normal)]
      break
    }
    case 'hull': {
      candidates = candidateDirections(positions, hull.faces).map((w) =>
        alignedCandidate(positions, hull.vertices, w)
      )
      break
    }
  }

  let bestEst: Candidate | null = null
  for (const c of candidates) {
    if (!bestEst || betterBox(c, bestEst)) bestEst = c
  }

  let winner = identity
  if (bestEst) {
    const exact = measure(positions, bestEst.rotation)
    // The strict volume clamp (not just betterBox's near-tie ranking) is what
    // makes "volume ≤ AABB volume" literally true: without it, a 1e-6-relative
    // near-tie broken by surface area could return a box a hair LARGER than the
    // AABB and quietly erode the thorough-≥-fast guarantee downstream.
    if (exact.volume <= identity.volume && betterBox(exact, identity)) winner = exact
  }
  return { ...winner, source: 'hull-search' }
}
