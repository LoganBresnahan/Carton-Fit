import { describe, expect, it, vi } from 'vitest'
import { Group, Mesh } from 'three'
import { disposeObject, swapContent } from '../src/renderer/src/viewport/sceneContent'
import { buildPartsScene } from '../src/renderer/src/viewport/sceneFromParts'
import type { ImportedPart } from '../src/renderer/src/workers/import-protocol'

function part(name: string): ImportedPart {
  return {
    name,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2])
  }
}

/** Spy on every geometry.dispose and the (shared) material.dispose in a group. */
function watchDisposal(group: Group) {
  const meshes = group.children as Mesh[]
  const geomSpies = meshes.map((m) => vi.spyOn(m.geometry, 'dispose'))
  const material = meshes[0].material // shared across the group
  const matSpy = vi.spyOn(material as { dispose: () => void }, 'dispose')
  return { geomSpies, matSpy }
}

describe('disposeObject', () => {
  it('disposes every geometry and the shared material exactly once', () => {
    const group = buildPartsScene([part('a'), part('b'), part('c')], true)
    const { geomSpies, matSpy } = watchDisposal(group)
    disposeObject(group)
    for (const spy of geomSpies) expect(spy).toHaveBeenCalledTimes(1)
    expect(matSpy).toHaveBeenCalledTimes(1) // NOT once per mesh
  })
})

describe('swapContent', () => {
  it('attaches next under the parent and returns it as current', () => {
    const parent = new Group()
    const a = buildPartsScene([part('a')], true)
    const current = swapContent(parent, null, a)
    expect(current).toBe(a)
    expect(parent.children).toContain(a)
  })

  it('disposes and detaches the replaced content on each swap', () => {
    const parent = new Group()
    const a = buildPartsScene([part('a1'), part('a2')], true)
    const b = buildPartsScene([part('b1')], true)
    const watchA = watchDisposal(a)

    let current = swapContent(parent, null, a)
    current = swapContent(parent, current, b) // A replaced by B

    for (const spy of watchA.geomSpies) expect(spy).toHaveBeenCalledTimes(1)
    expect(watchA.matSpy).toHaveBeenCalledTimes(1)
    expect(parent.children).not.toContain(a)
    expect(parent.children).toEqual([b])
    expect(current).toBe(b)
  })

  it('clears and disposes on swap to null (the unmount/reset path)', () => {
    const parent = new Group()
    const b = buildPartsScene([part('b1')], true)
    const watchB = watchDisposal(b)

    let current = swapContent(parent, null, b)
    current = swapContent(parent, current, null)

    for (const spy of watchB.geomSpies) expect(spy).toHaveBeenCalledTimes(1)
    expect(watchB.matSpy).toHaveBeenCalledTimes(1)
    expect(parent.children).toHaveLength(0)
    expect(current).toBeNull()
  })
})
