import { describe, expect, it } from 'vitest'
import type { OcctMesh, OcctNode, OcctResult } from 'occt-import-js'
import { extractParts } from '../src/renderer/src/workers/occt/occt-to-parts'

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

function node(name: string, meshes: number[], children: OcctNode[] = []): OcctNode {
  return { name, meshes, children }
}

function result(root: OcctNode, meshes: OcctMesh[]): OcctResult {
  return { success: true, root, meshes }
}

describe('extractParts', () => {
  it('maps a single mesh to a part with typed-array geometry', () => {
    const parts = extractParts(result(node('', [0]), [occtMesh({ name: 'Cube 10x10' })]))
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
    const [p] = extractParts(result(node('', [0]), [mesh]))
    expect(p.normals).toBeNull()
  })

  it('copies into fresh buffers (not views over occt data)', () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    const [p] = extractParts(
      result(node('', [0]), [occtMesh({ attributes: { position: { array: source } } })])
    )
    source[0] = 999
    expect(p.positions[0]).toBe(1) // unaffected by later mutation of the source
    expect(p.positions.buffer.byteLength).toBe(p.positions.length * 4)
  })

  it('disambiguates instanced parts with ordinal suffixes', () => {
    // Two bracket instances each own a mesh named "bolt" — the nested-assembly
    // shape occt emits (per-instance duplicated meshes, same product name).
    const tree = node('as1', [], [
      node('l-bracket-assembly', [0]),
      node('l-bracket-assembly', [1]),
      node('plate-node', [2])
    ])
    const parts = extractParts(
      result(tree, [occtMesh({ name: 'bolt' }), occtMesh({ name: 'bolt' }), occtMesh({ name: 'plate' })])
    )
    expect(parts.map((p) => p.name)).toEqual(['bolt', 'bolt (2)', 'plate'])
  })

  it('falls back to the owning node name for anonymous meshes, inherited through anonymous nodes', () => {
    const tree = node('rod-assembly', [], [node('', [0])])
    const [p] = extractParts(result(tree, [occtMesh({ name: '' })]))
    expect(p.name).toBe('rod-assembly')
  })

  it('names a fully anonymous mesh "part"', () => {
    const [p] = extractParts(result(node('', [0]), [occtMesh({ name: '' })]))
    expect(p.name).toBe('part')
  })

  it('returns parts in mesh-index order regardless of tree order', () => {
    const tree = node('root', [], [node('b-node', [1]), node('a-node', [0])])
    const parts = extractParts(result(tree, [occtMesh({ name: 'a' }), occtMesh({ name: 'b' })]))
    expect(parts.map((p) => p.name)).toEqual(['a', 'b'])
  })

  it('keeps meshes unreferenced by any node (malformed hierarchy must not drop geometry)', () => {
    const parts = extractParts(
      result(node('root', [0]), [occtMesh({ name: 'seen' }), occtMesh({ name: '' })])
    )
    expect(parts.map((p) => p.name)).toEqual(['seen', 'part'])
  })

  it('returns an empty array for a mesh-less result', () => {
    expect(extractParts(result(node('', []), []))).toEqual([])
  })
})
