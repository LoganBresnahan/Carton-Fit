import { describe, expect, it } from 'vitest'
import { minimalObb } from '../src/renderer/src/core/packing/obb'
import type { Obb } from '../src/renderer/src/core/packing/obb'
import { applyMat3, det3 } from '../src/renderer/src/core/packing/orientations'
import { IDENTITY_MAT3, boxVolume } from '../src/renderer/src/core/packing/types'
import type { Mat3, Vec3 } from '../src/renderer/src/core/packing/types'
import { computeAabb, aabbSize } from '../src/renderer/src/core/geometry'

function cloud(points: number[][]): Float32Array {
  const P = new Float32Array(points.length * 3)
  points.forEach((p, i) => P.set(p, i * 3))
  return P
}

function rotZ(deg: number): Mat3 {
  const c = Math.cos((deg * Math.PI) / 180)
  const s = Math.sin((deg * Math.PI) / 180)
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}
function rotX(deg: number): Mat3 {
  const c = Math.cos((deg * Math.PI) / 180)
  const s = Math.sin((deg * Math.PI) / 180)
  return [1, 0, 0, 0, c, -s, 0, s, c]
}
function matMul(a: Mat3, b: Mat3): Mat3 {
  const m: number[] = new Array(9)
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      m[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
  return m as unknown as Mat3
}
function transform(points: number[][], m: Mat3, t: Vec3): number[][] {
  return points.map((p) => {
    const r = applyMat3(m, [p[0], p[1], p[2]])
    return [r[0] + t[0], r[1] + t[1], r[2] + t[2]]
  })
}

function boxCorners(ex: number, ey: number, ez: number): number[][] {
  const out: number[][] = []
  for (const x of [0, ex]) for (const y of [0, ey]) for (const z of [0, ez]) out.push([x, y, z])
  return out
}

function sortedExtent(obb: Obb): number[] {
  return [...obb.extent].sort((a, b) => a - b)
}

/** The two structural invariants every OBB must satisfy: a proper orthonormal
 *  rotation, and containment of every input point in [rotatedMin, rotatedMin+extent]. */
function assertWellFormed(P: Float32Array, obb: Obb, tol: number): void {
  expect(det3(obb.rotation)).toBeCloseTo(1, 6)
  const m = obb.rotation
  const rows: Vec3[] = [
    [m[0], m[1], m[2]],
    [m[3], m[4], m[5]],
    [m[6], m[7], m[8]]
  ]
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const d = rows[i][0] * rows[j][0] + rows[i][1] * rows[j][1] + rows[i][2] * rows[j][2]
      expect(d).toBeCloseTo(i === j ? 1 : 0, 6)
    }
  for (let i = 0; i < P.length; i += 3) {
    const r = applyMat3(obb.rotation, [P[i], P[i + 1], P[i + 2]])
    for (let a = 0; a < 3; a++) {
      expect(r[a]).toBeGreaterThanOrEqual(obb.rotatedMin[a] - tol)
      expect(r[a]).toBeLessThanOrEqual(obb.rotatedMin[a] + obb.extent[a] + tol)
    }
  }
}

const aabbVolume = (P: Float32Array): number => boxVolume(aabbSize(computeAabb(P)) as Vec3)

describe('minimalObb', () => {
  it('recovers an axis-aligned box exactly (identity wins the tie)', () => {
    const P = cloud([...boxCorners(10, 20, 30), [5, 5, 5], [2, 18, 25]])
    const obb = minimalObb(P)
    expect(obb.volume).toBeCloseTo(6000, 4)
    expect(sortedExtent(obb)).toEqual([10, 20, 30])
    expect(obb.rotation).toEqual(IDENTITY_MAT3)
    expect(obb.rotatedMin[0]).toBeCloseTo(0, 6)
    expect(obb.source).toBe('hull-search')
    assertWellFormed(P, obb, 1e-6)
  })

  it('is invariant under rotation + translation of the part (known-OBB fixture)', () => {
    const R = matMul(rotX(20), rotZ(30))
    const P = cloud(transform(boxCorners(10, 20, 40), R, [5, -3, 7]))
    const obb = minimalObb(P)
    expect(Math.abs(obb.volume - 8000)).toBeLessThan(1)
    const e = sortedExtent(obb)
    expect(e[0]).toBeCloseTo(10, 2)
    expect(e[1]).toBeCloseTo(20, 2)
    expect(e[2]).toBeCloseTo(40, 2)
    assertWellFormed(P, obb, 1e-3)
  })

  it('beats the AABB on a diagonally rotated long box', () => {
    const P = cloud(transform(boxCorners(40, 10, 10), rotZ(45), [0, 0, 0]))
    const obb = minimalObb(P)
    expect(obb.volume).toBeLessThan(4100) // true box: 4000; AABB: 12500
    expect(obb.volume).toBeLessThanOrEqual(aabbVolume(P) + 1e-6)
    assertWellFormed(P, obb, 1e-3)
  })

  it('handles a planar part: one near-zero extent, exact in-plane rectangle', () => {
    const rect = [
      [0, 0, 0],
      [30, 0, 0],
      [30, 10, 0],
      [0, 10, 0],
      [15, 0, 0],
      [15, 10, 0],
      [0, 5, 0],
      [30, 5, 0]
    ]
    const P = cloud(transform(rect, matMul(rotX(35), rotZ(-20)), [1, 2, 3]))
    const obb = minimalObb(P)
    const e = sortedExtent(obb)
    expect(e[0]).toBeLessThan(1e-3)
    expect(e[1]).toBeCloseTo(10, 2)
    expect(e[2]).toBeCloseTo(30, 2)
    assertWellFormed(P, obb, 1e-3)
  })

  it('handles a collinear part: one extent carries the whole length', () => {
    const d = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)]
    const P = cloud([0, 2, 5, 9].map((t) => [d[0] * t, d[1] * t, d[2] * t]))
    const obb = minimalObb(P)
    const e = sortedExtent(obb)
    expect(e[0]).toBeLessThan(1e-3)
    expect(e[1]).toBeLessThan(1e-3)
    expect(e[2]).toBeCloseTo(9, 3)
    assertWellFormed(P, obb, 1e-3)
  })

  it('handles coincident points: zero extent, identity rotation', () => {
    const P = cloud([
      [7, -2, 3],
      [7, -2, 3],
      [7, -2, 3]
    ])
    const obb = minimalObb(P)
    expect(sortedExtent(obb)[2]).toBeLessThan(1e-6)
    expect(obb.rotation).toEqual(IDENTITY_MAT3)
    assertWellFormed(P, obb, 1e-6)
  })

  it('never exceeds the AABB volume on a seeded random cloud (structural invariant)', () => {
    // Deterministic LCG — no Math.random in core/ or its tests (CLAUDE.md).
    let seed = 42
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    const slab: number[][] = []
    for (let i = 0; i < 200; i++) slab.push([rnd() * 60, rnd() * 25, rnd() * 10])
    const P = cloud(transform(slab, matMul(rotX(50), rotZ(70)), [-4, 9, 2]))
    const obb = minimalObb(P)
    expect(obb.source).toBe('hull-search')
    expect(obb.volume).toBeLessThanOrEqual(aabbVolume(P) + 1e-6)
    // The slab is 60×25×10 = 15000 mm³; the AABB of its rotated form is far
    // larger. The face-aligned search must land near the slab, not the AABB.
    expect(obb.volume).toBeLessThan(15000 * 1.05)
    assertWellFormed(P, obb, 1e-3)
  })
})
