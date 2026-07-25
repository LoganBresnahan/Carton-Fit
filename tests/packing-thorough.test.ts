import { describe, expect, it } from 'vitest'
import { thoroughOrientations } from '../src/renderer/src/core/packing/thoroughOrientations'
import { aabbOrientations, applyMat3, det3 } from '../src/renderer/src/core/packing/orientations'
import { gridFillQuantity } from '../src/renderer/src/core/packing/quantityGrid'
import { greedyShelfFit } from '../src/renderer/src/core/packing/shelfFit'
import type {
  Mat3,
  OrientationOption,
  PackPart,
  Vec3
} from '../src/renderer/src/core/packing/types'

// thorough-placement-and-rotations roster. The verify class here is
// "renders plausibly while silently wrong": a transposed or order-swapped
// composition still produces orthonormal matrices and sane-looking extents, so
// every candidate is checked against DIRECT point measurement, and a placement
// is checked end-to-end (rotate + translate every vertex into its box).

function cloud(points: number[][]): Float32Array {
  const P = new Float32Array(points.length * 3)
  points.forEach((p, i) => P.set(p, i * 3))
  return P
}

/** Proper 3-4-5 rotation (rows orthonormal, det +1). */
const R345: Mat3 = [0.36, -0.8, 0.48, 0.48, 0.6, 0.64, -0.8, 0, 0.6]

function boxCorners(ex: number, ey: number, ez: number): number[][] {
  const out: number[][] = []
  for (const x of [0, ex]) for (const y of [0, ey]) for (const z of [0, ez]) out.push([x, y, z])
  return out
}

function transformed(points: number[][], m: Mat3, t: Vec3): number[][] {
  return points.map((p) => {
    const r = applyMat3(m, [p[0], p[1], p[2]])
    return [r[0] + t[0], r[1] + t[1], r[2] + t[2]]
  })
}

/** A 40×8×8 rod rotated off-axis: its AABB is fat, its OBB is the true rod. */
function diagonalRod(): PackPart {
  return {
    name: 'rod',
    positions: cloud(transformed(boxCorners(40, 8, 8), R345, [7, -3, 5])),
    weightG: 100
  }
}

function measureAgainst(part: PackPart, o: OrientationOption): { min: Vec3; max: Vec3 } {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity]
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  const P = part.positions
  for (let i = 0; i < P.length; i += 3) {
    const r = applyMat3(o.rotation, [P[i], P[i + 1], P[i + 2]])
    for (let a = 0; a < 3; a++) {
      if (r[a] < lo[a]) lo[a] = r[a]
      if (r[a] > hi[a]) hi[a] = r[a]
    }
  }
  return { min: lo, max: hi }
}

describe('thoroughOrientations', () => {
  it('emits proper, orthonormal rotations whose extent/rotatedMin match direct measurement', () => {
    const part = diagonalRod()
    const options = thoroughOrientations(part)
    expect(options.length).toBe(12) // 6 OBB-composed + 6 AABB
    for (const o of options) {
      expect(det3(o.rotation)).toBeCloseTo(1, 6)
      const m = o.rotation
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          const d =
            m[i * 3] * m[j * 3] + m[i * 3 + 1] * m[j * 3 + 1] + m[i * 3 + 2] * m[j * 3 + 2]
          expect(d).toBeCloseTo(i === j ? 1 : 0, 6)
        }
      const direct = measureAgainst(part, o)
      for (let a = 0; a < 3; a++) {
        expect(direct.min[a]).toBeCloseTo(o.rotatedMin[a], 3)
        expect(direct.max[a] - direct.min[a]).toBeCloseTo(o.extent[a], 3)
      }
    }
  })

  it('recovers the rod: some candidate has the true 8×8×40 extents', () => {
    const options = thoroughOrientations(diagonalRod())
    const hit = options.some((o) => {
      const e = [...o.extent].sort((a, b) => a - b)
      return Math.abs(e[0] - 8) < 0.01 && Math.abs(e[1] - 8) < 0.01 && Math.abs(e[2] - 40) < 0.01
    })
    expect(hit).toBe(true)
  })

  it('always includes the fast tier candidates (superset guarantee)', () => {
    const part = diagonalRod()
    expect(thoroughOrientations(part).slice(6)).toEqual(aabbOrientations(part))
  })

  it('grid quantity: thorough beats fast on the diagonal rod (hand-computed 288 vs 24)', () => {
    const part = diagonalRod()
    const carton: Vec3 = [100, 100, 100]
    const clearances = { betweenParts: 0, wall: 0 }
    const fast = gridFillQuantity(
      { name: part.name, weightG: 0, orientations: aabbOrientations(part) },
      carton,
      clearances,
      1e12
    )
    const thorough = gridFillQuantity(
      { name: part.name, weightG: 0, orientations: thoroughOrientations(part) },
      carton,
      clearances,
      1e12
    )
    // AABB extents ≈ 24.64 × 29.12 × 36.8 → 4·3·2; OBB 40×8×8 → 2·12·12.
    expect(fast.count).toBe(24)
    expect(thorough.count).toBe(288)
    expect(thorough.count).toBeGreaterThanOrEqual(fast.count)
  })

  it('end-to-end: shelf-places the rod via its OBB and every vertex lands inside the box', () => {
    const part = diagonalRod()
    const r = greedyShelfFit(
      [{ name: part.name, weightG: part.weightG, orientations: thoroughOrientations(part) }],
      [45, 10, 10], // only the OBB orientation fits; the AABB (≈25×29×37) cannot
      { betweenParts: 0, wall: 0 },
      1e9
    )
    expect(r.unplaced).toEqual([])
    const p = r.placements[0]
    const P = part.positions
    for (let i = 0; i < P.length; i += 3) {
      const v = applyMat3(p.rotation, [P[i], P[i + 1], P[i + 2]])
      for (let a = 0; a < 3; a++) {
        const w = v[a] + p.translation[a]
        expect(w).toBeGreaterThanOrEqual(p.boxMin[a] - 1e-3)
        expect(w).toBeLessThanOrEqual(p.boxMax[a] + 1e-3)
      }
    }
  })

  it('kills the transposed-OBB mutant: generic rotation, far from origin', () => {
    // The rod fixture's OBB rotation happens to be symmetric, so a transposed
    // M_obb passed the roster (verify finding B). This L-shape under a generic
    // (non-involutive) rotation at large coordinates pins the composition
    // unambiguously: every candidate must match direct per-point measurement.
    const rz = ((): Mat3 => {
      const c = Math.cos(0.651)
      const s = Math.sin(0.651)
      return [c, -s, 0, s, c, 0, 0, 0, 1]
    })()
    const rx = ((): Mat3 => {
      const c = Math.cos(0.379)
      const s = Math.sin(0.379)
      return [1, 0, 0, 0, c, -s, 0, s, c]
    })()
    const generic: Mat3 = [
      rz[0] * rx[0] + rz[1] * rx[3] + rz[2] * rx[6],
      rz[0] * rx[1] + rz[1] * rx[4] + rz[2] * rx[7],
      rz[0] * rx[2] + rz[1] * rx[5] + rz[2] * rx[8],
      rz[3] * rx[0] + rz[4] * rx[3] + rz[5] * rx[6],
      rz[3] * rx[1] + rz[4] * rx[4] + rz[5] * rx[7],
      rz[3] * rx[2] + rz[4] * rx[5] + rz[5] * rx[8],
      rz[6] * rx[0] + rz[7] * rx[3] + rz[8] * rx[6],
      rz[6] * rx[1] + rz[7] * rx[4] + rz[8] * rx[7],
      rz[6] * rx[2] + rz[7] * rx[5] + rz[8] * rx[8]
    ]
    const lShape = [...boxCorners(30, 20, 10), ...boxCorners(10, 20, 15).map((p) => [p[0], p[1], p[2] + 10])]
    const part: PackPart = {
      name: 'L',
      positions: cloud(transformed(lShape, generic, [1e4, -5e3, 2e3])),
      weightG: 50
    }
    for (const o of thoroughOrientations(part)) {
      const direct = measureAgainst(part, o)
      for (let a = 0; a < 3; a++) {
        // 5e-3 tolerance: float32 quantization at 1e4 mm coordinates.
        expect(Math.abs(direct.min[a] - o.rotatedMin[a])).toBeLessThan(5e-3)
        expect(Math.abs(direct.max[a] - direct.min[a] - o.extent[a])).toBeLessThan(5e-3)
      }
    }
  })

  it('a rotated flat sheet counts via its AABB, not 1.8e8 through residual OBB thickness', () => {
    // Float32 quantization leaves the OBB of a rotated z=0 sheet ~1e-6 mm thick;
    // dividing the carton by that once produced a 184M count and an OOM. The
    // degenerate-extent bar rejects those orientations, so the honest answer is
    // the fast-tier AABB one: extents ≈ 18.8 × 20.4 × 24 in a 50³ carton → 2·2·2.
    const sheet: number[][] = []
    for (let x = 0; x <= 30; x += 3) for (let y = 0; y <= 10; y += 2.5) sheet.push([x, y, 0])
    const part: PackPart = {
      name: 'sheet',
      positions: cloud(transformed(sheet, R345, [0, 0, 0])),
      weightG: 0
    }
    const r = gridFillQuantity(
      { name: part.name, weightG: 0, orientations: thoroughOrientations(part) },
      [50, 50, 50],
      { betweenParts: 0, wall: 0 },
      1e12
    )
    expect(r.count).toBe(8)
    expect(r.binding).toBe('geometry')
  })

  it('handles a degenerate planar part without NaN or improper rotations', () => {
    const plate: PackPart = {
      name: 'plate',
      positions: cloud(
        transformed(
          [
            [0, 0, 0],
            [30, 0, 0],
            [30, 10, 0],
            [0, 10, 0],
            [15, 5, 0]
          ],
          R345,
          [1, 2, 3]
        )
      ),
      weightG: 10
    }
    const options = thoroughOrientations(plate)
    for (const o of options) {
      expect(det3(o.rotation)).toBeCloseTo(1, 6)
      for (const x of [...o.extent, ...o.rotatedMin]) expect(Number.isFinite(x)).toBe(true)
    }
    const flat = options.some((o) => Math.min(...o.extent) < 1e-3)
    expect(flat).toBe(true)
  })
})
