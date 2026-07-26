import { describe, expect, it } from 'vitest'
import { kindOf, partKinds, pruneOverrides } from '../src/renderer/src/packing/kinds'
import {
  buildPackRequest,
  effectiveWeightG,
  openMeshParts
} from '../src/renderer/src/packing/request'
import type { ImportedPart } from '../src/renderer/src/workers/import-protocol'
import type { PackingSettings } from '../src/renderer/src/store'
import { inToMm } from '../src/renderer/src/core/units'

// Part kinds and per-kind weight overrides (ADR-0018).
//
// The subtle half is the suffix rule. ` (2)` is OUR OWN uniquing, added by
// occt-to-parts when an assembly instances one product twice — so stripping it
// recovers a real product name. But a CAD part can legitimately be named
// `flange (2)`, and folding that into a `flange` group the file does not
// contain would file its weight under a phantom kind. Hence: strip only when
// the base name is genuinely present.

/** A closed 10 mm cube — 12 triangles, so meshVolume and isClosedMesh both work. */
function cube(name: string, size = 10): ImportedPart {
  const s = size
  const v = [
    [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
    [0, 0, s], [s, 0, s], [s, s, s], [0, s, s]
  ]
  const faces = [
    [0, 2, 1], [0, 3, 2], // bottom
    [4, 5, 6], [4, 6, 7], // top
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7]
  ]
  return {
    name,
    positions: new Float32Array(v.flat()),
    normals: null,
    indices: new Uint32Array(faces.flat())
  }
}

/** The same cube missing its +z face — a perfect bbox with a wrong volume. */
function openCube(name: string, size = 10): ImportedPart {
  const part = cube(name, size)
  const kept = [...part.indices].slice(0, 6) // drop the two top triangles
  return { ...part, indices: new Uint32Array([...kept, ...[...part.indices].slice(12)]) }
}

function settings(patch: Partial<PackingSettings> = {}): PackingSettings {
  return {
    mode: 'fit-check',
    tier: 'fast',
    unitSystem: 'imperial',
    boxDimsMm: [inToMm(12), inToMm(12), inToMm(12)],
    enterOuter: false,
    wallMm: 0,
    clearancePartMm: 0,
    clearanceWallMm: 0,
    maxWeightG: 16000,
    weightMode: 'direct',
    partWeightG: 100,
    densityGPerCm3: 1,
    ...patch
  }
}

const namesOf = (parts: readonly ImportedPart[]): Set<string> =>
  new Set(parts.map((part) => part.name))

describe('kindOf', () => {
  it('strips our ordinal suffix when the base name is in the file', () => {
    const names = new Set(['bolt', 'bolt (2)', 'bolt (17)'])
    expect(kindOf('bolt', names)).toBe('bolt')
    expect(kindOf('bolt (2)', names)).toBe('bolt')
    expect(kindOf('bolt (17)', names)).toBe('bolt')
  })

  it('leaves a part genuinely NAMED with parentheses as its own kind', () => {
    // No bare `flange` in this file, so `flange (2)` is a product name, not
    // the second instance of anything.
    const names = new Set(['flange (2)', 'plate'])
    expect(kindOf('flange (2)', names)).toBe('flange (2)')
  })

  it('only strips a trailing, space-separated, all-digit group', () => {
    const names = new Set(['a', 'a (x)', 'a (2) rev', 'a(2)', 'a (2.5)'])
    // Every one of these keeps its full name: the pattern is anchored at the
    // end, requires the space, and requires digits only.
    expect(kindOf('a (x)', names)).toBe('a (x)')
    expect(kindOf('a (2) rev', names)).toBe('a (2) rev')
    expect(kindOf('a(2)', names)).toBe('a(2)')
    expect(kindOf('a (2.5)', names)).toBe('a (2.5)')
  })
})

describe('partKinds', () => {
  it('groups instances and counts them, in first-appearance order', () => {
    const parts = [cube('bolt'), cube('nut'), cube('bolt (2)'), cube('bolt (3)')]
    expect(partKinds(parts).map((k) => [k.kind, k.count])).toEqual([
      ['bolt', 3],
      ['nut', 1]
    ])
  })

  it('keeps a representative part per kind, for the default weight shown', () => {
    const parts = [cube('bolt', 10), cube('bolt (2)', 20)]
    const [bolt] = partKinds(parts)
    expect(bolt.sample.name).toBe('bolt')
  })
})

describe('effectiveWeightG', () => {
  const parts = [cube('bolt'), cube('bolt (2)'), cube('plate')]
  const names = namesOf(parts)

  it('falls back to the mode when no override is set', () => {
    expect(effectiveWeightG(parts[0], settings(), names, {})).toBe(100)
  })

  it('applies one override to every instance of the kind', () => {
    const overrides = { bolt: 7 }
    expect(effectiveWeightG(parts[0], settings(), names, overrides)).toBe(7)
    expect(effectiveWeightG(parts[1], settings(), names, overrides)).toBe(7)
    // …and leaves other kinds on the mode's answer.
    expect(effectiveWeightG(parts[2], settings(), names, overrides)).toBe(100)
  })

  it('overrides density mode too — the point is mixed materials', () => {
    // 1000 mm³ at 1 g/cm³ = 1 g; the override replaces it outright.
    const density = settings({ weightMode: 'density', densityGPerCm3: 1 })
    expect(effectiveWeightG(parts[2], density, names, {})).toBeCloseTo(1, 6)
    expect(effectiveWeightG(parts[2], density, names, { plate: 250 })).toBe(250)
  })

  it('ignores a corrupt override rather than packing with it', () => {
    // Overrides round-trip through a saved estimate's JSON, so a row from
    // another build can carry anything. A negative weight would silently
    // inflate the count the cap allows.
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, 'heavy', null]) {
      const overrides = { bolt: bad } as unknown as Record<string, number>
      expect(effectiveWeightG(parts[0], settings(), names, overrides)).toBe(100)
    }
    // Zero is legitimate — a weightless part is a real answer.
    expect(effectiveWeightG(parts[0], settings(), names, { bolt: 0 })).toBe(0)
  })
})

describe('buildPackRequest with overrides', () => {
  it('resolves kinds against the whole file, not the packed subset', () => {
    // Max-quantity over `bolt (2)` alone must still know it is a bolt.
    const parts = [cube('bolt'), cube('bolt (2)'), cube('plate')]
    const request = buildPackRequest(
      parts,
      settings({ mode: 'max-quantity' }),
      'bolt (2)',
      { bolt: 42 }
    )
    expect(request?.parts.map((p) => p.weightG)).toEqual([42])
  })

  it('leaves the request unchanged when there are no overrides', () => {
    const parts = [cube('bolt'), cube('plate')]
    const before = buildPackRequest(parts, settings(), null)
    const after = buildPackRequest(parts, settings(), null, {})
    expect(after?.parts.map((p) => p.weightG)).toEqual(before?.parts.map((p) => p.weightG))
  })
})

// ADR-0018 §4. Entering the weight directly is one of the two fixes the
// open-mesh warning's own wording recommends, so taking that advice has to
// retire the warning.
describe('openMeshParts with overrides', () => {
  const parts = [openCube('shell'), cube('plate')]
  const density = settings({ weightMode: 'density' })

  it('warns about an open mesh whose weight still comes from its volume', () => {
    expect(openMeshParts(parts, density, null, {})).toEqual(['shell'])
  })

  it('goes quiet once that kind is overridden — the volume is no longer used', () => {
    expect(openMeshParts(parts, density, null, { shell: 50 })).toEqual([])
  })

  it('still warns about a DIFFERENT open kind', () => {
    const two = [openCube('shell'), openCube('cover')]
    expect(openMeshParts(two, density, null, { shell: 50 })).toEqual(['cover'])
  })

  it('covers every instance of an overridden kind', () => {
    const many = [openCube('shell'), openCube('shell (2)')]
    expect(openMeshParts(many, density, null, {})).toEqual(['shell', 'shell (2)'])
    expect(openMeshParts(many, density, null, { shell: 50 })).toEqual([])
  })
})

describe('pruneOverrides', () => {
  it('drops kinds the loaded file does not have', () => {
    const parts = [cube('bolt'), cube('bolt (2)')]
    expect(pruneOverrides({ bolt: 7, sprocket: 9 }, parts)).toEqual({ bolt: 7 })
  })

  it('is empty for a file with nothing in common', () => {
    expect(pruneOverrides({ bolt: 7 }, [cube('widget')])).toEqual({})
  })
})
