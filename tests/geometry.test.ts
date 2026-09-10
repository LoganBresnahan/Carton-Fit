import { describe, expect, it } from 'vitest'
import {
  aabbSize,
  computeAabb,
  facetTurnDeg,
  isClosedMesh,
  meshVolume,
  PLANAR_TURN_DEG,
  tessellationTolerance
} from '../src/renderer/src/core/geometry'

// ---- cube fixtures -------------------------------------------------------
// 8 corners of an axis-aligned box [0,s]^3.
function cubeCorners(s: number): number[] {
  return [
    0, 0, 0, s, 0, 0, s, s, 0, 0, s, 0, // z=0
    0, 0, s, s, 0, s, s, s, s, 0, s, s //  z=s
  ]
}
// 12 triangles, consistent outward winding.
const CUBE_TRIS = [
  0, 3, 2, 0, 2, 1, // bottom (-z)
  4, 5, 6, 4, 6, 7, // top (+z)
  0, 1, 5, 0, 5, 4, // front (-y)
  3, 7, 6, 3, 6, 2, // back (+y)
  0, 4, 7, 0, 7, 3, // left (-x)
  1, 2, 6, 1, 6, 5 //  right (+x)
]

/** Shared-vertex cube: 8 positions, indices reference them. */
function sharedCube(s = 1): { positions: Float32Array; indices: Uint32Array } {
  return { positions: new Float32Array(cubeCorners(s)), indices: new Uint32Array(CUBE_TRIS) }
}

/**
 * occt-style cube: every triangle gets its own three vertices, so no edge is
 * shared by index — the worst case for index-based manifold detection. Positions
 * are identical to the shared cube's, just duplicated.
 */
function duplicatedCube(s = 1): { positions: Float32Array; indices: Uint32Array } {
  const corners = cubeCorners(s)
  const positions: number[] = []
  const indices: number[] = []
  for (const corner of CUBE_TRIS) {
    indices.push(positions.length / 3)
    positions.push(corners[corner * 3], corners[corner * 3 + 1], corners[corner * 3 + 2])
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}

describe('computeAabb', () => {
  it('bounds a box and reports its size', () => {
    const box = computeAabb(new Float32Array([0, 0, 0, 2, 5, 9, -1, 3, 4]))
    expect(box.min).toEqual([-1, 0, 0])
    expect(box.max).toEqual([2, 5, 9])
    expect(aabbSize(box)).toEqual([3, 5, 9])
  })

  it('throws on a non-triplet buffer', () => {
    expect(() => computeAabb(new Float32Array([0, 0]))).toThrow()
    expect(() => computeAabb(new Float32Array([]))).toThrow()
  })
})

describe('meshVolume', () => {
  it('computes a unit cube as volume 1 (shared vertices)', () => {
    const { positions, indices } = sharedCube(1)
    expect(meshVolume(positions, indices)).toBeCloseTo(1, 9)
  })

  it('scales cubically with size', () => {
    const { positions, indices } = sharedCube(10)
    expect(meshVolume(positions, indices)).toBeCloseTo(1000, 6)
  })

  it('is identical for the duplicated-vertex representation', () => {
    expect(meshVolume(...Object.values(duplicatedCube(10)) as [Float32Array, Uint32Array])).toBeCloseTo(
      1000,
      6
    )
  })

  it('is winding-direction agnostic (abs)', () => {
    const { positions, indices } = sharedCube(1)
    const flipped = new Uint32Array(indices.length)
    for (let t = 0; t < indices.length; t += 3) {
      flipped[t] = indices[t]
      flipped[t + 1] = indices[t + 2]
      flipped[t + 2] = indices[t + 1]
    }
    expect(meshVolume(positions, flipped)).toBeCloseTo(1, 9)
  })

  it('throws on non-triangle index counts', () => {
    expect(() => meshVolume(new Float32Array([0, 0, 0]), new Uint32Array([0, 0]))).toThrow()
  })
})

describe('isClosedMesh', () => {
  it('reports a watertight shared-vertex cube as closed', () => {
    const { positions, indices } = sharedCube(10)
    expect(isClosedMesh(positions, indices)).toBe(true)
  })

  it('reports a duplicated-vertex cube as closed — the occt trap', () => {
    // If this ever regresses to index-based edge matching it flips to false,
    // which would warn "open mesh" on every real STEP part.
    const { positions, indices } = duplicatedCube(10)
    expect(isClosedMesh(positions, indices)).toBe(true)
  })

  it('reports a lone triangle as open', () => {
    expect(isClosedMesh(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]))).toBe(
      false
    )
  })

  it('reports a cube missing one face as open', () => {
    const { positions } = duplicatedCube(10)
    const withHole = new Uint32Array(CUBE_TRIS.length - 6) // drop the last face (2 tris)
    // rebuild duplicated indices for all but the last face
    const idx = duplicatedCube(10).indices.subarray(0, CUBE_TRIS.length - 6)
    withHole.set(idx)
    expect(isClosedMesh(positions, withHole)).toBe(false)
  })
})

describe('facetTurnDeg (ADR-0015 addendum 2)', () => {
  it('is 0 on a planar solid: every triangle’s three surface normals agree', () => {
    // A duplicated-vertex cube with per-face normals, the way occt emits one.
    const { positions, indices } = duplicatedCube(10)
    const normals = new Float32Array(positions.length)
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3]
      const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
      const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2]
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
      const len = Math.hypot(...n)
      for (const i of [a, b, c]) normals.set(n.map((x) => x / len), i)
    }
    expect(facetTurnDeg(normals, indices)).toBe(0)
  })

  it('reports the facet’s own subtended angle where the surface normals turn across a triangle', () => {
    // One triangle on a cylinder faceted 24 times around: its normals at the
    // two generator lines are 15° apart, by construction.
    const theta = (15 * Math.PI) / 180
    const normals = new Float32Array([
      1, 0, 0,
      Math.cos(theta), Math.sin(theta), 0,
      1, 0, 0
    ])
    expect(facetTurnDeg(normals, new Uint32Array([0, 1, 2]))).toBeCloseTo(15, 4)
  })

  it('takes the LARGEST turn over the mesh, not the first', () => {
    const t1 = (5 * Math.PI) / 180
    const t2 = (20 * Math.PI) / 180
    const normals = new Float32Array([
      1, 0, 0, Math.cos(t1), Math.sin(t1), 0, 1, 0, 0,
      1, 0, 0, Math.cos(t2), Math.sin(t2), 0, 1, 0, 0
    ])
    expect(facetTurnDeg(normals, new Uint32Array([0, 1, 2, 3, 4, 5]))).toBeCloseTo(20, 4)
  })
})

describe('tessellationTolerance', () => {
  it('is 0 at or below the planar threshold', () => {
    expect(tessellationTolerance(0)).toBe(0)
    expect(tessellationTolerance(PLANAR_TURN_DEG)).toBe(0)
  })

  it('is 2·(1 − sin θ/θ): about 2.1% at the reference bolt’s 14.5° step', () => {
    // By hand: θ = 0.2531 rad, sin θ = 0.2504, 1 − 0.2504/0.2531 = 0.01065, ×2.
    expect(tessellationTolerance(14.5)).toBeCloseTo(0.0213, 3)
    // And 1.6% cross-section at twenty facets (18°) — the addendum's own
    // figure — doubled for a doubly curved surface.
    expect(tessellationTolerance(18) / 2).toBeCloseTo(0.0164, 3)
  })
})
