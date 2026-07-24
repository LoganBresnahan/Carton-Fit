import { describe, expect, it } from 'vitest'
import type { OcctMesh } from 'occt-import-js'
import { occtMeshesToParts } from '../src/renderer/src/workers/occt/occt-to-parts'

function occtMesh(overrides: Partial<OcctMesh> = {}): OcctMesh {
  return {
    name: 'mesh',
    brep_faces: [],
    attributes: {
      position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1] }
    },
    index: { array: [0, 1, 2] },
    ...overrides
  }
}

describe('occtMeshesToParts', () => {
  it('maps each occt mesh to a part with typed-array geometry', () => {
    const parts = occtMeshesToParts([occtMesh({ name: 'Cube 10x10' })])
    expect(parts).toHaveLength(1)
    const p = parts[0]
    expect(p.name).toBe('Cube 10x10')
    expect(p.positions).toBeInstanceOf(Float32Array)
    expect(Array.from(p.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect(p.indices).toBeInstanceOf(Uint32Array)
    expect(Array.from(p.indices)).toEqual([0, 1, 2])
    expect(p.normals).toBeInstanceOf(Float32Array)
  })

  it('yields null normals when the source mesh has none', () => {
    const mesh = occtMesh()
    delete mesh.attributes.normal
    const [p] = occtMeshesToParts([mesh])
    expect(p.normals).toBeNull()
  })

  it('copies into fresh buffers (not views over occt data)', () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    const [p] = occtMeshesToParts([occtMesh({ attributes: { position: { array: source } } })])
    source[0] = 999
    expect(p.positions[0]).toBe(1) // unaffected by later mutation of the source
    expect(p.positions.buffer.byteLength).toBe(p.positions.length * 4)
  })

  it('maps every mesh in an assembly (flat — no transforms yet)', () => {
    const parts = occtMeshesToParts([occtMesh({ name: 'a' }), occtMesh({ name: 'b' })])
    expect(parts.map((p) => p.name)).toEqual(['a', 'b'])
  })

  it('returns an empty array for a mesh-less result', () => {
    expect(occtMeshesToParts([])).toEqual([])
  })
})
