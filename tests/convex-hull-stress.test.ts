import { describe, expect, it } from 'vitest'
import { convexHull3d } from '../src/renderer/src/core/packing/convexHull3d'
import type { Hull3d } from '../src/renderer/src/core/packing/convexHull3d'
import { minimalObb } from '../src/renderer/src/core/packing/obb'
import { applyMat3 } from '../src/renderer/src/core/packing/orientations'
import type { Mat3 } from '../src/renderer/src/core/packing/types'
import { aabbSize, computeAabb } from '../src/renderer/src/core/geometry'

// Regression roster from the obb-rotation-search adversarial verify. Each recipe
// previously either OOM-crashed the process (face-graph corruption → exponential
// face growth), returned a hull missing whole regions (flood-fill leak), or took
// 10–26 s in the OBB search (uncapped candidate directions). Determinism via
// seeded LCG (no Math.random in core tests).
//
// The hull quality bar is the SUPPORT GAP — how far input points out-reach the
// hull vertices along sampled directions — because that is what the OBB search
// consumes (it projects hull vertices). Plane distance to individual faces is
// NOT asserted: a sliver face's plane tilts arbitrarily around its needle edge,
// so it measures noise, not containment.

function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** Worst support-function shortfall of hull vertices vs all points, over sampled
 *  directions, in units of the hull's eps. ~0 ⇒ the vertex set spans every extreme. */
function supportGapEps(P: Float32Array, hull: Hull3d, dirCount: number): number {
  if (hull.kind !== 'hull') throw new Error(`expected hull, got ${hull.kind}`)
  const [sx, sy, sz] = aabbSize(computeAabb(P))
  const eps = Math.max(Math.hypot(sx, sy, sz) * 1e-5, 1e-9)
  const rnd = lcg(7)
  let worst = 0
  for (let k = 0; k < dirCount; k++) {
    const d = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]
    const l = Math.hypot(d[0], d[1], d[2])
    if (l < 1e-6) continue
    let sAll = -Infinity
    for (let i = 0; i < P.length; i += 3) {
      const s = (d[0] * P[i] + d[1] * P[i + 1] + d[2] * P[i + 2]) / l
      if (s > sAll) sAll = s
    }
    let sHull = -Infinity
    for (const v of hull.vertices) {
      const s = (d[0] * P[v * 3] + d[1] * P[v * 3 + 1] + d[2] * P[v * 3 + 2]) / l
      if (s > sHull) sHull = s
    }
    if (sAll - sHull > worst) worst = sAll - sHull
  }
  return worst / eps
}

function assertObbInvariants(P: Float32Array): void {
  const obb = minimalObb(P)
  const [sx, sy, sz] = aabbSize(computeAabb(P))
  expect(obb.volume).toBeLessThanOrEqual(sx * sy * sz + 1e-6)
  for (let i = 0; i < P.length; i += 3) {
    const r = applyMat3(obb.rotation, [P[i], P[i + 1], P[i + 2]])
    for (let a = 0; a < 3; a++) {
      expect(r[a]).toBeGreaterThanOrEqual(obb.rotatedMin[a] - 1e-3)
      expect(r[a]).toBeLessThanOrEqual(obb.rotatedMin[a] + obb.extent[a] + 1e-3)
    }
  }
}

function cylinderCloud(n: number, seed: number): Float32Array {
  const rnd = lcg(seed)
  const P = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const theta = rnd() * 2 * Math.PI
    P[i * 3] = 50 * Math.cos(theta)
    P[i * 3 + 1] = 50 * Math.sin(theta)
    P[i * 3 + 2] = rnd() * 200
  }
  return P
}

describe('convexHull3d under load (verify-pass regressions)', () => {
  it('survives a 10k-point cylinder surface (was: face explosion → OOM)', () => {
    const P = cylinderCloud(10_000, 1)
    const hull = convexHull3d(P)
    expect(hull.kind).toBe('hull')
    expect(supportGapEps(P, hull, 60)).toBeLessThanOrEqual(2)
    assertObbInvariants(P)
  })

  it('survives an 8k-point sphere where every point is a hull vertex (was: OOM)', () => {
    const N = 8000
    const R = 40
    const golden = Math.PI * (3 - Math.sqrt(5))
    const P = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      const z = 1 - (2 * (i + 0.5)) / N
      const r = Math.sqrt(1 - z * z)
      P[i * 3] = R * r * Math.cos(i * golden)
      P[i * 3 + 1] = R * r * Math.sin(i * golden)
      P[i * 3 + 2] = R * z
    }
    const hull = convexHull3d(P)
    expect(hull.kind).toBe('hull')
    if (hull.kind !== 'hull') return
    expect(hull.vertices.length).toBe(N)
    expect(supportGapEps(P, hull, 60)).toBeLessThanOrEqual(2)
  })

  it('loses no extreme point on a 50k box cloud (was: orphan leak)', () => {
    const rnd = lcg(3)
    const P = new Float32Array(50_000 * 3)
    for (let i = 0; i < 50_000; i++) {
      P[i * 3] = rnd() * 200
      P[i * 3 + 1] = rnd() * 150
      P[i * 3 + 2] = rnd() * 100
    }
    const hull = convexHull3d(P)
    expect(hull.kind).toBe('hull')
    expect(supportGapEps(P, hull, 60)).toBeLessThanOrEqual(2)
    assertObbInvariants(P)
  })

  it('recovers a rotated cylinder to near its true box (candidate-cap quality pin)', () => {
    // True minimal box: 100 × 100 × 200 = 2e6 mm³. The rotated AABB is far
    // larger, so this fails if the area-ranked candidate cap ever drops the
    // directions that matter.
    const base = cylinderCloud(6_000, 5)
    const m: Mat3 = [
      0.36, -0.8, 0.48, 0.48, 0.6, 0.64, -0.8, 0, 0.6
    ] // proper rotation (3-4-5 construction)
    const P = new Float32Array(base.length)
    for (let i = 0; i < base.length; i += 3) {
      const r = applyMat3(m, [base[i], base[i + 1], base[i + 2]])
      P[i] = r[0] + 3
      P[i + 1] = r[1] - 8
      P[i + 2] = r[2] + 12
    }
    const obb = minimalObb(P)
    expect(obb.source).toBe('hull-search')
    expect(obb.volume).toBeLessThanOrEqual(2e6 * 1.05)
    assertObbInvariants(P)
  })
})
