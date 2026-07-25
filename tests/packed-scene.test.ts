import { describe, expect, it } from 'vitest'
import {
  Matrix4,
  Vector3,
  type InstancedMesh,
  type LineSegments,
  type Material,
  type Mesh
} from 'three'
import {
  boundsOfCarton,
  buildCartonWireframe,
  buildPackedScene,
  placementMatrix
} from '../src/renderer/src/viewport/sceneFromPlacements'
import { disposeObject } from '../src/renderer/src/viewport/sceneContent'
import { applyMat3 } from '../src/renderer/src/core/packing/orientations'
import type { Mat3, Placement, Vec3 } from '../src/renderer/src/core/packing/types'
import type { ImportedPart } from '../src/renderer/src/workers/import-protocol'

// The packed view's matrix convention is the "renders plausibly while silently
// wrong" spot of item 4: our Mat3 is row-major (v' = M·v) while three stores
// column-major. These tests use the ENGINE's own applyMat3 as the oracle, on
// asymmetric rotations where a transpose gives a different answer — so a
// convention slip fails here rather than looking merely odd on screen.

function part(name = 'p'): ImportedPart {
  return {
    name,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    normals: null,
    indices: new Uint32Array([0, 1, 2, 0, 2, 3])
  }
}

/** 90° about Z — asymmetric, and its transpose is its inverse (the opposite
 *  rotation), so a transpose bug cannot hide behind symmetry. */
const ROT_Z90: Mat3 = [0, -1, 0, 1, 0, 0, 0, 0, 1]
/** A generic proper rotation (3-4-5 construction), asymmetric in every entry. */
const R345: Mat3 = [0.36, -0.8, 0.48, 0.48, 0.6, 0.64, -0.8, 0, 0.6]

function placement(rotation: Mat3, translation: Vec3, partName = 'p'): Placement {
  return { partName, rotation, translation, boxMin: [0, 0, 0], boxMax: [1, 1, 1] }
}

describe('placementMatrix', () => {
  it('transforms exactly as the engine does: rotation then translation', () => {
    for (const rotation of [ROT_Z90, R345]) {
      const translation: Vec3 = [7, -3, 11]
      const matrix = placementMatrix(placement(rotation, translation))
      for (const v of [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [2, -5, 3]
      ] as Vec3[]) {
        const expected = applyMat3(rotation, v)
        const actual = new Vector3(v[0], v[1], v[2]).applyMatrix4(matrix)
        expect(actual.x).toBeCloseTo(expected[0] + translation[0], 6)
        expect(actual.y).toBeCloseTo(expected[1] + translation[1], 6)
        expect(actual.z).toBeCloseTo(expected[2] + translation[2], 6)
      }
    }
  })

  it('differs from the transposed matrix (the test has teeth)', () => {
    const good = placementMatrix(placement(ROT_Z90, [0, 0, 0]))
    const transposed = good.clone().transpose()
    const v = () => new Vector3(1, 0, 0)
    expect(v().applyMatrix4(good).distanceTo(v().applyMatrix4(transposed))).toBeGreaterThan(0.5)
  })

  it('is a rigid motion: no scale, no mirroring', () => {
    const matrix = placementMatrix(placement(R345, [4, 5, 6]))
    expect(matrix.determinant()).toBeCloseTo(1, 6)
    const a = new Vector3(1, 2, 3).applyMatrix4(matrix)
    const b = new Vector3(4, -1, 0).applyMatrix4(matrix)
    // Distances are preserved under a rigid motion.
    expect(a.distanceTo(b)).toBeCloseTo(new Vector3(1, 2, 3).distanceTo(new Vector3(4, -1, 0)), 6)
  })

  it('places a part corner exactly at its boxMin (the placement contract)', () => {
    // translation = corner − rotatedMin, so the rotated part's min lands on the
    // grid corner. Here the part's rotated min is the origin, so translation IS
    // the corner.
    const p = placement(ROT_Z90, [10, 20, 30])
    const origin = new Vector3(0, 0, 0).applyMatrix4(placementMatrix(p))
    expect([origin.x, origin.y, origin.z]).toEqual([10, 20, 30])
  })
})

describe('buildCartonWireframe', () => {
  it('spans the carton corner-to-corner from the origin', () => {
    const lines = buildCartonWireframe([100, 200, 300])
    lines.geometry.computeBoundingBox()
    const box = lines.geometry.boundingBox!.clone()
    box.applyMatrix4(new Matrix4().makeTranslation(lines.position.x, lines.position.y, lines.position.z))
    expect([box.min.x, box.min.y, box.min.z]).toEqual([0, 0, 0])
    expect([box.max.x, box.max.y, box.max.z]).toEqual([100, 200, 300])
  })

  it('tolerates a degenerate carton without throwing', () => {
    expect(() => buildCartonWireframe([-20, 0, 50])).not.toThrow()
  })
})

describe('boundsOfCarton', () => {
  it('frames the box itself, so the view is stable when little is placed', () => {
    const box = boundsOfCarton([100, 200, 300])
    expect(box.min.toArray()).toEqual([0, 0, 0])
    expect(box.max.toArray()).toEqual([100, 200, 300])
  })
})

describe('buildPackedScene', () => {
  it('emits one instanced mesh per distinct part, with every placement set', () => {
    const scene = buildPackedScene(
      [part('a'), part('b')],
      [
        placement(ROT_Z90, [0, 0, 0], 'a'),
        placement(ROT_Z90, [10, 0, 0], 'a'),
        placement(R345, [0, 10, 0], 'b')
      ],
      [100, 100, 100]
    )
    const instanced = scene.children.filter((c) => (c as InstancedMesh).isInstancedMesh)
    expect(instanced).toHaveLength(2)
    const a = instanced.find((m) => m.name === 'a') as InstancedMesh
    const b = instanced.find((m) => m.name === 'b') as InstancedMesh
    expect(a.count).toBe(2)
    expect(b.count).toBe(1)

    // The second 'a' instance carries the second placement's transform.
    const read = new Matrix4()
    a.getMatrixAt(1, read)
    const moved = new Vector3(0, 0, 0).applyMatrix4(read)
    expect([moved.x, moved.y, moved.z]).toEqual([10, 0, 0])
  })

  it('always includes the carton, even with nothing placed', () => {
    const scene = buildPackedScene([part()], [], [100, 100, 100])
    const carton = scene.children.find((c) => c.name === 'carton') as LineSegments
    expect(carton).toBeDefined()
    expect(scene.children.filter((c) => (c as InstancedMesh).isInstancedMesh)).toHaveLength(0)
  })

  it('skips placements naming a part it no longer holds', () => {
    const scene = buildPackedScene(
      [part('a')],
      [placement(ROT_Z90, [0, 0, 0], 'a'), placement(ROT_Z90, [0, 0, 0], 'ghost')],
      [100, 100, 100]
    )
    const instanced = scene.children.filter((c) => (c as InstancedMesh).isInstancedMesh)
    expect(instanced).toHaveLength(1)
    expect((instanced[0] as InstancedMesh).count).toBe(1)
  })

  it('shares one material across parts and frees everything on dispose', () => {
    const scene = buildPackedScene(
      [part('a'), part('b')],
      [placement(ROT_Z90, [0, 0, 0], 'a'), placement(ROT_Z90, [0, 0, 0], 'b')],
      [100, 100, 100]
    )
    const meshes = scene.children.filter((c) => (c as Mesh).isMesh) as Mesh[]
    expect(meshes[0].material).toBe(meshes[1].material) // one GPU program

    const disposed: string[] = []
    const seen = new Set<Material>()
    scene.traverse((obj) => {
      const node = obj as Mesh
      if (node.geometry) node.geometry.dispose = () => disposed.push(`geometry:${obj.name}`)
      const material = node.material
      if (material && !Array.isArray(material)) seen.add(material)
    })
    // Label each DISTINCT material, so a double-free shows up as a repeat.
    const labelled = [...seen]
    labelled.forEach((m, i) => {
      m.dispose = () => disposed.push(`material:${i}`)
    })
    disposeObject(scene)

    // Carton lines are NOT a Mesh — the leak this catches is exactly why
    // disposeObject matches on geometry/material rather than on isMesh.
    expect(disposed).toContain('geometry:carton')
    expect(disposed).toContain('geometry:a')
    expect(disposed).toContain('geometry:b')
    // Two distinct materials (shared part + carton line), each freed once — the
    // shared one is not double-freed despite backing two meshes.
    expect(labelled).toHaveLength(2)
    const materialDisposals = disposed.filter((d) => d.startsWith('material:'))
    expect(materialDisposals).toHaveLength(2)
    expect(new Set(materialDisposals).size).toBe(2)
  })
})
