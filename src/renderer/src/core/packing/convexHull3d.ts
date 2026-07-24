import { aabbSize, computeAabb } from '../geometry'
import type { Vec3 } from './types'

// convex-hull-3d (ADR-0003 `obb-rotation-search`): pure-TS quickhull over a mesh
// position buffer. The OBB search needs hull FACE NORMALS (candidate box axes) and
// hull VERTICES (a small projection set), so faces carry their unit normals and
// nothing is welded or indexed for rendering.
//
// Degeneracy is a first-class result, not an error: real parts can be flat
// (plane), wire-like (line), or a single point, and each has an exact OBB the
// caller computes directly.
//
// Robustness posture (shaped by the adversarial verify on this slice):
//  - Fresh-face winding is INHERITED from the horizon edge, never re-derived
//    geometrically. Orienting new faces against an interior point let an
//    eps-marginal apex flip one face's winding, which corrupted the horizon
//    pairing and multiplied faces ~2× per iteration until the process OOMed on
//    a 10k-point cylinder cloud. Combinatorial inheritance can't flip.
//  - The visible set is FLOOD-FILLED across face adjacency from the seed face,
//    so its boundary is a genuine horizon even when the eps test would carve a
//    disconnected set out of near-coplanar faces.
//  - The bail-out guard bounds ALIVE FACE COUNT (a convex triangulation has at
//    most 2n−4 faces), because that is the quantity that actually diverges when
//    float precision corrupts the face graph. An iteration cap of n cannot fire:
//    each iteration permanently consumes one apex. `unconverged` is loud; the
//    OBB caller answers it with the plain AABB.
//  - Orphaned outside points that no fresh face claims are rescanned against
//    every live face before being dropped: eps asymmetry can leave a point
//    outside a KEPT face (it was single-assigned to a dying one), and dropping
//    it silently would return a hull that misses input points.

export interface HullFace {
  a: number
  b: number
  c: number
  /** Unit outward normal. */
  normal: Vec3
}

export type Hull3d =
  | { kind: 'hull'; faces: HullFace[]; vertices: number[] }
  | { kind: 'point' }
  | { kind: 'line'; direction: Vec3 }
  | { kind: 'plane'; normal: Vec3 }
  | { kind: 'unconverged' }

type V3 = [number, number, number]

function pt(P: Float32Array, i: number): V3 {
  return [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]
}
function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function norm(a: V3): number {
  return Math.hypot(a[0], a[1], a[2])
}
function normalize(a: V3): V3 {
  const l = norm(a)
  return [a[0] / l, a[1] / l, a[2] / l]
}

interface Face {
  a: number
  b: number
  c: number
  nx: number
  ny: number
  nz: number
  /** Plane offset: n · p = offset for p on the face. */
  offset: number
  /** Points strictly (> eps) outside this face; each point lives in at most one list. */
  outside: number[]
  alive: boolean
  /** Flood-fill visit stamp (iteration id). */
  mark: number
}

function distTo(f: Face, P: Float32Array, i: number): number {
  return f.nx * P[i * 3] + f.ny * P[i * 3 + 1] + f.nz * P[i * 3 + 2] - f.offset
}

function planeOf(P: Float32Array, a: number, b: number, c: number): Face {
  const pa = pt(P, a)
  const n = cross(sub(pt(P, b), pa), sub(pt(P, c), pa))
  const l = norm(n)
  const inv = l > 1e-30 ? 1 / l : 0 // sliver face: junk normal, harmless — it attracts nothing
  const nx = n[0] * inv
  const ny = n[1] * inv
  const nz = n[2] * inv
  return {
    a,
    b,
    c,
    nx,
    ny,
    nz,
    offset: nx * pa[0] + ny * pa[1] + nz * pa[2],
    outside: [],
    alive: true,
    mark: 0
  }
}

/** Initial-simplex face, oriented outward against the simplex centroid — the one
 *  place a geometric orientation test is safe (an exact, non-degenerate tetra). */
function simplexFace(P: Float32Array, a: number, b: number, c: number, interior: V3): Face {
  const f = planeOf(P, a, b, c)
  if (f.nx * interior[0] + f.ny * interior[1] + f.nz * interior[2] - f.offset > 0) {
    return planeOf(P, a, c, b)
  }
  return f
}

/** Directed-edge key; safe while vertex indices stay below 2^26 (~67M). */
const EDGE_KEY = 67108864

export function convexHull3d(P: Float32Array, epsilon?: number): Hull3d {
  const n = P.length / 3
  const box = computeAabb(P) // throws loudly on empty/malformed input
  const [sx, sy, sz] = aabbSize(box)
  const eps = epsilon ?? Math.max(Math.hypot(sx, sy, sz) * 1e-5, 1e-9)

  // --- initial simplex: farthest pair among the 6 axis extremes, then the point
  // farthest off their line, then the point farthest off that plane. Each "no
  // such point" step names the degeneracy exactly.
  const ext = [0, 0, 0, 0, 0, 0] // minX, maxX, minY, maxY, minZ, maxZ indices
  for (let i = 1; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      if (P[i * 3 + a] < P[ext[a * 2] * 3 + a]) ext[a * 2] = i
      if (P[i * 3 + a] > P[ext[a * 2 + 1] * 3 + a]) ext[a * 2 + 1] = i
    }
  }
  let i0 = 0
  let i1 = 0
  let best = -1
  for (const p of ext) {
    for (const q of ext) {
      const d = norm(sub(pt(P, p), pt(P, q)))
      if (d > best) {
        best = d
        i0 = p
        i1 = q
      }
    }
  }
  if (best <= eps) return { kind: 'point' }

  const dir = normalize(sub(pt(P, i1), pt(P, i0)))
  let i2 = -1
  best = eps
  for (let i = 0; i < n; i++) {
    const d = norm(cross(sub(pt(P, i), pt(P, i0)), dir))
    if (d > best) {
      best = d
      i2 = i
    }
  }
  if (i2 < 0) return { kind: 'line', direction: [dir[0], dir[1], dir[2]] }

  const planeN = normalize(cross(sub(pt(P, i1), pt(P, i0)), sub(pt(P, i2), pt(P, i0))))
  let i3 = -1
  best = eps
  for (let i = 0; i < n; i++) {
    const d = Math.abs(dot(planeN, sub(pt(P, i), pt(P, i0))))
    if (d > best) {
      best = d
      i3 = i
    }
  }
  if (i3 < 0) return { kind: 'plane', normal: [planeN[0], planeN[1], planeN[2]] }

  const p0 = pt(P, i0)
  const p1 = pt(P, i1)
  const p2 = pt(P, i2)
  const p3 = pt(P, i3)
  const interior: V3 = [
    (p0[0] + p1[0] + p2[0] + p3[0]) / 4,
    (p0[1] + p1[1] + p2[1] + p3[1]) / 4,
    (p0[2] + p1[2] + p2[2] + p3[2]) / 4
  ]

  let faces: Face[] = [
    simplexFace(P, i0, i1, i2, interior),
    simplexFace(P, i0, i1, i3, interior),
    simplexFace(P, i0, i2, i3, interior),
    simplexFace(P, i1, i2, i3, interior)
  ]

  // Directed-edge → owning face. Deletes are identity-checked so a rare
  // duplicate directed edge (pinched visible region) degrades locally instead
  // of corrupting unrelated adjacency.
  const edgeFace = new Map<number, Face>()
  const link = (f: Face): void => {
    edgeFace.set(f.a * EDGE_KEY + f.b, f)
    edgeFace.set(f.b * EDGE_KEY + f.c, f)
    edgeFace.set(f.c * EDGE_KEY + f.a, f)
  }
  const unlink = (f: Face): void => {
    for (const k of [f.a * EDGE_KEY + f.b, f.b * EDGE_KEY + f.c, f.c * EDGE_KEY + f.a]) {
      if (edgeFace.get(k) === f) edgeFace.delete(k)
    }
  }
  faces.forEach(link)

  const simplex = new Set([i0, i1, i2, i3])
  for (let i = 0; i < n; i++) {
    if (simplex.has(i)) continue
    for (const f of faces) {
      if (distTo(f, P, i) > eps) {
        f.outside.push(i)
        break
      }
    }
  }

  // Invariant: every alive face with a non-empty outside list is in `pending`
  // (dead or drained entries are skipped on pop).
  const pending: Face[] = faces.filter((f) => f.outside.length > 0)
  let aliveCount = 4
  const maxAlive = 4 * n + 1024
  let iterations = 0
  const maxIterations = n + 16 // each iteration consumes one apex for good
  let mark = 0

  while (pending.length > 0) {
    const f = pending.pop()!
    if (!f.alive || f.outside.length === 0) continue
    if (++iterations > maxIterations) return { kind: 'unconverged' }

    // The face's farthest outside point becomes the next hull vertex.
    let apex = f.outside[0]
    let dBest = -Infinity
    for (const i of f.outside) {
      const d = distTo(f, P, i)
      if (d > dBest) {
        dBest = d
        apex = i
      }
    }

    // Visible set: flood-fill from the seed, absorbing every neighbor the apex
    // is NOT clearly below (dist > −eps). Two thresholds on purpose:
    //  - Absorbing the |dist| ≤ eps noise band puts the horizon on faces where
    //    the apex is unambiguously below, so the boundary can't zigzag through
    //    near-coplanar micro-faces — the pinched/duplicated horizon edges that
    //    made faces multiply until OOM (verify finding) came from exactly that.
    //  - Every strictly visible (dist > eps) face is still reached: the exactly
    //    visible region is connected on a convex polytope and all of it clears
    //    the −eps bar, so no face is left with the apex above it (the flaw of a
    //    strict-threshold flood-fill: such a face is never repaired, because
    //    the apex is excluded from redistribution).
    mark++
    f.mark = mark
    const visible: Face[] = [f]
    const stack: Face[] = [f]
    while (stack.length > 0) {
      const g = stack.pop()!
      for (const [x, y] of [
        [g.a, g.b],
        [g.b, g.c],
        [g.c, g.a]
      ]) {
        const nb = edgeFace.get(y * EDGE_KEY + x)
        if (nb && nb.alive && nb.mark !== mark && distTo(nb, P, apex) > -eps) {
          nb.mark = mark
          visible.push(nb)
          stack.push(nb)
        }
      }
    }

    // Horizon = visible-face edges whose across-neighbor is not visible.
    const horizon: Array<[number, number]> = []
    for (const g of visible) {
      for (const [x, y] of [
        [g.a, g.b],
        [g.b, g.c],
        [g.c, g.a]
      ]) {
        const nb = edgeFace.get(y * EDGE_KEY + x)
        if (!nb || !nb.alive || nb.mark !== mark) horizon.push([x, y])
      }
    }

    // An empty horizon means the whole polytope sat in the noise band — nothing
    // to rebuild on. Bail loud rather than return a faceless "hull".
    if (horizon.length === 0) return { kind: 'unconverged' }

    const orphans: number[] = []
    for (const g of visible) {
      g.alive = false
      unlink(g)
      aliveCount--
      for (const i of g.outside) if (i !== apex) orphans.push(i)
    }

    // Fresh face (u, v, apex) inherits the horizon edge's direction: the kept
    // neighbor traverses (v, u), so the pairing is consistent by construction.
    const fresh = horizon.map(([u, v]) => planeOf(P, u, v, apex))
    for (const g of fresh) {
      link(g)
      faces.push(g)
      aliveCount++
    }
    if (aliveCount > maxAlive) return { kind: 'unconverged' }

    for (const i of orphans) {
      let placed = false
      for (const g of fresh) {
        if (distTo(g, P, i) > eps) {
          g.outside.push(i)
          placed = true
          break
        }
      }
      if (!placed) {
        // Rescue scan: still > eps outside some KEPT face → hand it over.
        for (const g of faces) {
          if (g.alive && g.mark !== mark && distTo(g, P, i) > eps) {
            g.outside.push(i)
            if (g.outside.length === 1) pending.push(g)
            break
          }
        }
      }
    }
    for (const g of fresh) {
      if (g.outside.length > 0) pending.push(g)
    }

    // Compact dead faces so a long run's memory tracks the live hull, not history.
    if (faces.length > 2 * aliveCount + 64) {
      faces = faces.filter((g) => g.alive)
    }
  }

  const live = faces.filter((f) => f.alive)
  const vertices = new Set<number>()
  for (const f of live) {
    vertices.add(f.a)
    vertices.add(f.b)
    vertices.add(f.c)
  }
  return {
    kind: 'hull',
    faces: live.map((f) => ({ a: f.a, b: f.b, c: f.c, normal: [f.nx, f.ny, f.nz] as Vec3 })),
    vertices: [...vertices]
  }
}
