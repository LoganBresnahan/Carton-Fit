import { describe, expect, it } from 'vitest'
import { composeUnit } from '../src/renderer/src/core/packing/unit'
import { aabbOrientations } from '../src/renderer/src/core/packing/orientations'
import { computeAabb } from '../src/renderer/src/core/geometry'
import type { PackPart } from '../src/renderer/src/core/packing/types'

function part(name: string, points: number[][], weightG = 0): PackPart {
  const positions = new Float32Array(points.length * 3)
  points.forEach((p, i) => positions.set(p, i * 3))
  return { name, positions, weightG }
}

describe('composeUnit', () => {
  it('passes a single part through unchanged', () => {
    const p = part('solo', [[0, 0, 0], [10, 20, 30]], 500)
    expect(composeUnit([p])).toBe(p)
  })

  it('throws on an empty selection', () => {
    expect(() => composeUnit([])).toThrow(/at least one part/)
  })

  it('concatenates positions and sums weights into one rigid unit', () => {
    const a = part('a', [[0, 0, 0], [10, 10, 10]], 100)
    const b = part('b', [[50, 0, 0], [60, 10, 10]], 250)
    const unit = composeUnit([a, b])
    expect(unit.weightG).toBe(350)
    expect(unit.positions.length).toBe(12) // 4 points × 3
    // Relative arrangement preserved (occt bakes world transforms): the union
    // AABB spans from a's min to b's max.
    const box = computeAabb(unit.positions)
    expect(box.min).toEqual([0, 0, 0])
    expect(box.max).toEqual([60, 10, 10])
  })

  it('composite AABB equals the min/max fold of the parts (fast-tier equivalence)', () => {
    const a = part('a', [[5, 5, 5], [15, 25, 35]])
    const b = part('b', [[-10, 0, 40], [2, 3, 44]])
    const unit = composeUnit([a, b])
    // The fast provider reads the union AABB; its largest extent permutation
    // must match a hand-folded composite box: x∈[-10,15], y∈[0,25], z∈[5,44].
    const extent = aabbOrientations(unit)[0].extent
    expect([...extent].sort((x, y) => x - y)).toEqual([25, 25, 39])
  })
})
