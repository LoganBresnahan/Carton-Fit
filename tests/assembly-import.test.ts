import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import occtFactory from 'occt-import-js'
import { extractParts } from '../src/renderer/src/workers/occt/occt-to-parts'
import type { ImportedPart } from '../src/renderer/src/workers/import-protocol'
import { computeAabb, aabbSize, isClosedMesh, meshVolume } from '../src/renderer/src/core/geometry'

// ADR-0002 addendum guard (the phase-3 "verify" slice): we do NO transform math
// because occt-import-js bakes each instance's composed assembly placement into
// world-space vertices and duplicates shared meshes per instance. This test
// pins that assumption to a real nested, instanced CAx-IF assembly (AS1: plate,
// two identical l-bracket sub-assemblies, rod, 6 bolts, 8 nuts). If a future
// occt-import-js stops baking — emitting local coordinates plus node transforms
// instead — instances collapse onto each other and the position assertions here
// fail loudly. Runs occt's WASM under Node; the browser worker asset path is
// exercised separately (phase-1 probe, packaged smoke).

const FIXTURE = join(__dirname, '..', 'samples', 'as1-oc-214.stp')

let parts: ImportedPart[]

beforeAll(async () => {
  const occt = await occtFactory()
  const bytes = new Uint8Array(readFileSync(FIXTURE))
  const result = occt.ReadStepFile(bytes, { linearUnit: 'millimeter' })
  expect(result.success).toBe(true)
  parts = extractParts(result)
}, 60_000)

const byPrefix = (prefix: string): ImportedPart[] =>
  parts.filter((p) => p.name === prefix || p.name.startsWith(`${prefix} (`))

describe('nested instanced assembly (as1-oc-214)', () => {
  it('extracts every instance as its own part', () => {
    expect(parts).toHaveLength(18)
    expect(byPrefix('bolt')).toHaveLength(6)
    expect(byPrefix('nut')).toHaveLength(8)
    expect(byPrefix('l-bracket')).toHaveLength(2)
    expect(byPrefix('rod')).toHaveLength(1)
    expect(byPrefix('plate')).toHaveLength(1)
    // names are unique after ordinal disambiguation
    expect(new Set(parts.map((p) => p.name)).size).toBe(18)
  })

  it('every part is a closed mesh despite occt duplicated vertices', () => {
    for (const p of parts) {
      expect(isClosedMesh(p.positions, p.indices), p.name).toBe(true)
    }
  })

  it('instances share volume and extent but sit at distinct world positions', () => {
    for (const prefix of ['bolt', 'nut', 'l-bracket']) {
      const group = byPrefix(prefix)
      const volumes = group.map((p) => meshVolume(p.positions, p.indices))
      const sizes = group.map((p) => aabbSize(computeAabb(p.positions)))
      const minima = group.map((p) => computeAabb(p.positions).min)

      // Rigid placement preserves volume — a transform-composition error would
      // scale or shear it. Instances agree to float32 *relative* precision
      // (~1e-7 · coordinate; absolute error grows with world position).
      for (const v of volumes) {
        expect(Math.abs(v - volumes[0]), prefix).toBeLessThan(volumes[0] * 1e-5)
      }
      // Placements are 90°-multiple rotations (nuts sit both flat on bolts and
      // upright on the rod ends), so AABB extents *permute* across instances —
      // itself proof rotation reached the vertices. Sorted extents must match.
      const sorted = sizes.map((s) => [...s].sort((x, y) => x - y))
      for (const s of sorted) {
        expect(s[0], prefix).toBeCloseTo(sorted[0][0], 3)
        expect(s[1], prefix).toBeCloseTo(sorted[0][1], 3)
        expect(s[2], prefix).toBeCloseTo(sorted[0][2], 3)
      }
      // The instancing proof: no two instances at the same place. Un-baked
      // transforms would stack every instance onto identical coordinates.
      const positionKeys = new Set(minima.map((m) => m.map((v) => v.toFixed(2)).join(',')))
      expect(positionKeys.size, prefix).toBe(group.length)
    }
  })

  it('places the two l-bracket sub-assemblies 120mm apart in x', () => {
    const [a, b] = byPrefix('l-bracket').map((p) => computeAabb(p.positions))
    const dx = Math.abs(a.min[0] - b.min[0])
    expect(dx).toBeCloseTo(120, 1)
    // and each bracket's bolts landed near their bracket, spanning the assembly
    const boltMinX = byPrefix('bolt').map((p) => computeAabb(p.positions).min[0])
    expect(Math.max(...boltMinX) - Math.min(...boltMinX)).toBeGreaterThan(100)
  })
})
