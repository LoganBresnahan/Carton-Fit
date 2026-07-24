import { describe, expect, it } from 'vitest'
import { convexHull3d } from '../src/renderer/src/core/packing/convexHull3d'
import type { Hull3d } from '../src/renderer/src/core/packing/convexHull3d'

function cloud(points: number[][]): Float32Array {
  const P = new Float32Array(points.length * 3)
  points.forEach((p, i) => P.set(p, i * 3))
  return P
}

/** Every input point must lie on or below every face plane (the hull property). */
function assertContainsAll(P: Float32Array, hull: Hull3d, tol: number): void {
  if (hull.kind !== 'hull') throw new Error(`expected hull, got ${hull.kind}`)
  for (const f of hull.faces) {
    const [nx, ny, nz] = f.normal
    const offset = nx * P[f.a * 3] + ny * P[f.a * 3 + 1] + nz * P[f.a * 3 + 2]
    for (let i = 0; i < P.length; i += 3) {
      const d = nx * P[i] + ny * P[i + 1] + nz * P[i + 2] - offset
      expect(d).toBeLessThanOrEqual(tol)
    }
  }
}

const BOX_CORNERS = [
  [0, 0, 0],
  [10, 0, 0],
  [0, 20, 0],
  [10, 20, 0],
  [0, 0, 30],
  [10, 0, 30],
  [0, 20, 30],
  [10, 20, 30]
]

describe('convexHull3d', () => {
  it('finds the 8 corners of a box and excludes interior points', () => {
    const P = cloud([...BOX_CORNERS, [5, 5, 5], [2, 18, 25]])
    const hull = convexHull3d(P)
    expect(hull.kind).toBe('hull')
    if (hull.kind !== 'hull') return
    expect([...hull.vertices].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(hull.faces).toHaveLength(12) // 2V − 4 triangles for a convex polytope
    for (const f of hull.faces) {
      const mags = f.normal.map(Math.abs).sort((a, b) => a - b)
      expect(mags[0]).toBeCloseTo(0, 6)
      expect(mags[1]).toBeCloseTo(0, 6)
      expect(mags[2]).toBeCloseTo(1, 6)
    }
    assertContainsAll(P, hull, 1e-3)
  })

  it('handles a tetrahedron (the minimal 3D hull)', () => {
    const P = cloud([
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 0],
      [0, 0, 10]
    ])
    const hull = convexHull3d(P)
    expect(hull.kind).toBe('hull')
    if (hull.kind !== 'hull') return
    expect(hull.vertices).toHaveLength(4)
    expect(hull.faces).toHaveLength(4)
    assertContainsAll(P, hull, 1e-3)
  })

  it('keeps every point of a sphere sampling as a hull vertex', () => {
    // Fibonacci sphere: 120 well-spread points, all extreme.
    const N = 120
    const R = 40
    const golden = Math.PI * (3 - Math.sqrt(5))
    const pts: number[][] = []
    for (let i = 0; i < N; i++) {
      const z = 1 - (2 * (i + 0.5)) / N
      const r = Math.sqrt(1 - z * z)
      pts.push([R * r * Math.cos(i * golden), R * r * Math.sin(i * golden), R * z])
    }
    const P = cloud(pts)
    const hull = convexHull3d(P)
    expect(hull.kind).toBe('hull')
    if (hull.kind !== 'hull') return
    expect(hull.vertices).toHaveLength(N)
    expect(hull.faces).toHaveLength(2 * N - 4)
    assertContainsAll(P, hull, 1e-3)
  })

  it('reports a coplanar cloud as a plane with its normal', () => {
    const pts: number[][] = []
    for (const x of [0, 10, 20, 30]) for (const y of [0, 5, 10]) pts.push([x, y, 5])
    const hull = convexHull3d(cloud(pts))
    expect(hull.kind).toBe('plane')
    if (hull.kind !== 'plane') return
    expect(Math.abs(hull.normal[2])).toBeCloseTo(1, 6)
  })

  it('reports a collinear cloud as a line with its direction', () => {
    const d = [3 / 13, 4 / 13, 12 / 13]
    const pts = [0, 6.5, 13, 26].map((t) => [d[0] * t, d[1] * t, d[2] * t])
    const hull = convexHull3d(cloud(pts))
    expect(hull.kind).toBe('line')
    if (hull.kind !== 'line') return
    const align = Math.abs(hull.direction[0] * d[0] + hull.direction[1] * d[1] + hull.direction[2] * d[2])
    expect(align).toBeCloseTo(1, 6)
  })

  it('reports coincident points as a point', () => {
    const hull = convexHull3d(
      cloud([
        [7, -2, 3],
        [7, -2, 3],
        [7, -2, 3],
        [7, -2, 3],
        [7, -2, 3]
      ])
    )
    expect(hull.kind).toBe('point')
  })
})
