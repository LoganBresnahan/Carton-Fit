import { describe, expect, it } from 'vitest'
import { Box3, Mesh, type MeshStandardMaterial, Vector3 } from 'three'
import { buildPartsScene, defaultPartMaterial } from '../src/renderer/src/viewport/sceneFromParts'
import { viewportPalette } from '../src/renderer/src/viewport/palette'
import { boundsOfParts, frameBox } from '../src/renderer/src/viewport/cameraFraming'
import type { ImportedPart } from '../src/renderer/src/workers/import-protocol'

function part(name: string, offset = 0): ImportedPart {
  // a unit triangle shifted by `offset` in x, so parts occupy distinct space
  return {
    name,
    positions: new Float32Array([offset, 0, 0, offset + 1, 0, 0, offset, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2])
  }
}

describe('buildPartsScene', () => {
  it('creates one named mesh per part with geometry adopted from part buffers', () => {
    const parts = [part('bolt'), part('nut')]
    const group = buildPartsScene(parts, true)
    expect(group.children).toHaveLength(2)
    const meshes = group.children as Mesh[]
    expect(meshes.map((m) => m.name)).toEqual(['bolt', 'nut'])
    expect(meshes[0].geometry.getAttribute('position').array).toBe(parts[0].positions)
    expect(meshes[1].geometry.getIndex()!.array).toBe(parts[1].indices)
  })

  it('shares one material instance across the group (the disposal-dedup contract)', () => {
    const group = buildPartsScene([part('a'), part('b'), part('c')], true)
    const materials = (group.children as Mesh[]).map((m) => m.material)
    expect(new Set(materials).size).toBe(1)
  })

  it('returns an empty group for no parts', () => {
    expect(buildPartsScene([], true).children).toHaveLength(0)
  })

  // ADR-0025 §5: the theme reaches the parts through this argument and through
  // nothing else, so a builder that ignored it would render a dark model inside
  // a light app.
  it('takes its material colour from the palette for the given scheme', () => {
    for (const dark of [true, false]) {
      expect(defaultPartMaterial(dark).color.getHex()).toBe(viewportPalette(dark).part)
      const mesh = buildPartsScene([part('bolt')], dark).children[0] as Mesh
      const material = mesh.material as MeshStandardMaterial
      expect(material.color.getHex()).toBe(viewportPalette(dark).part)
    }
  })
})

describe('boundsOfParts', () => {
  it('unions the AABBs of all parts', () => {
    const box = boundsOfParts([part('a', 0), part('b', 10)])
    expect(box.min.x).toBe(0)
    expect(box.max.x).toBe(11) // second triangle spans x=10..11
  })
})

describe('frameBox', () => {
  const cube = () => new Box3(new Vector3(-5, -5, -5), new Vector3(5, 5, 5))

  it('targets the box center and stands the camera off along the view direction', () => {
    const f = frameBox(cube(), { fov: 50, aspect: 1 })
    expect([f.target.x, f.target.y, f.target.z]).toEqual([0, 0, 0])
    // r = √3·5 ≈ 8.66; dist = r/sin(25°)·1.15 ≈ 23.57; |position| = dist (center at origin)
    expect(f.position.length()).toBeCloseTo(23.57, 1)
  })

  it('pulls back further for a portrait aspect (horizontal fov becomes limiting)', () => {
    const square = frameBox(cube(), { fov: 50, aspect: 1 }).position.length()
    const portrait = frameBox(cube(), { fov: 50, aspect: 0.5 }).position.length()
    expect(portrait).toBeGreaterThan(square)
  })

  it('needs less distance with a wider field of view', () => {
    const narrow = frameBox(cube(), { fov: 30, aspect: 1 }).position.length()
    const wide = frameBox(cube(), { fov: 70, aspect: 1 }).position.length()
    expect(wide).toBeLessThan(narrow)
  })

  it('keeps near < far and near > 0', () => {
    const f = frameBox(cube(), { fov: 50, aspect: 1.6 })
    expect(f.near).toBeGreaterThan(0)
    expect(f.far).toBeGreaterThan(f.near)
  })

  it('falls back to a finite frame for an empty/degenerate box (no NaN)', () => {
    const f = frameBox(new Box3(), { fov: 50, aspect: 1 })
    expect(Number.isFinite(f.position.length())).toBe(true)
    expect(Number.isFinite(f.near)).toBe(true)
    expect(f.far).toBeGreaterThan(f.near)
  })
})
