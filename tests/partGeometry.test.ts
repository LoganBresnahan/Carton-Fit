import { describe, expect, it } from 'vitest'
import {
  partAabb,
  partBox3,
  partToBufferGeometry
} from '../src/renderer/src/viewport/partGeometry'
import type { ImportedPart } from '../src/renderer/src/workers/import-protocol'

function part(overrides: Partial<ImportedPart> = {}): ImportedPart {
  return {
    name: 'p',
    positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 20, 0, 0, 0, 30]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    ...overrides
  }
}

describe('partToBufferGeometry', () => {
  it('wires position, normal, and index attributes from the part buffers', () => {
    const p = part()
    const g = partToBufferGeometry(p)
    expect(g.getAttribute('position').array).toBe(p.positions)
    expect(g.getAttribute('normal').array).toBe(p.normals)
    expect(g.getIndex()!.array).toBe(p.indices)
    expect(g.getAttribute('position').count).toBe(4)
  })

  it('computes normals when the part has none', () => {
    const g = partToBufferGeometry(part({ normals: null }))
    expect(g.getAttribute('normal')).toBeDefined()
    expect(g.getAttribute('normal').count).toBe(4)
  })
})

describe('partAabb / partBox3', () => {
  it('bounds the part in millimeters', () => {
    expect(partAabb(part()).max).toEqual([10, 20, 30])
  })

  it('matches as a three Box3', () => {
    const box = partBox3(part())
    expect([box.min.x, box.min.y, box.min.z]).toEqual([0, 0, 0])
    expect([box.max.x, box.max.y, box.max.z]).toEqual([10, 20, 30])
  })
})
