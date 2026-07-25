import { describe, expect, it } from 'vitest'
import { buildPackRequest, partWeightG } from '../src/renderer/src/packing/request'
import { useAppStore, type PackingSettings } from '../src/renderer/src/store'
import type { ImportedPart } from '../src/renderer/src/workers/import-protocol'

// buildPackRequest is the settings→contract translation (roadmap item 4): the
// place UI vocabulary (outer dims + wall, density, mode/tier) becomes engine
// vocabulary (inner carton mm, grams per part).

function settings(patch: Partial<PackingSettings> = {}): PackingSettings {
  return { ...useAppStore.getState().settings, ...patch }
}

/** Closed 10 mm cube: 12 triangles, volume 1000 mm³ = 1 cm³ exactly. */
function cubePart(name = 'cube', size = 10): ImportedPart {
  const s = size
  const corners = [
    [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
    [0, 0, s], [s, 0, s], [s, s, s], [0, s, s]
  ]
  const positions = new Float32Array(corners.length * 3)
  corners.forEach((c, i) => positions.set(c, i * 3))
  // Outward-wound triangles for all 6 faces.
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, // -z
    4, 5, 6, 4, 6, 7, // +z
    0, 1, 5, 0, 5, 4, // -y
    3, 7, 6, 3, 6, 2, // +y
    0, 4, 7, 0, 7, 3, // -x
    1, 2, 6, 1, 6, 5 // +x
  ])
  return { name, positions, normals: null, indices }
}

describe('partWeightG', () => {
  it('uses the direct per-part entry in direct mode', () => {
    const w = partWeightG(cubePart(), settings({ weightMode: 'direct', partWeightG: 250 }))
    expect(w).toBe(250)
  })

  it('multiplies density by mesh volume in density mode (hand-computed)', () => {
    // 10 mm cube = 1000 mm³ = 1 cm³; aluminium 2.7 g/cm³ → 2.7 g.
    const w = partWeightG(cubePart(), settings({ weightMode: 'density', densityGPerCm3: 2.7 }))
    expect(w).toBeCloseTo(2.7, 9)
    // 20 mm cube = 8000 mm³ = 8 cm³ → 21.6 g (scales with volume, not size).
    const bigger = partWeightG(
      cubePart('big', 20),
      settings({ weightMode: 'density', densityGPerCm3: 2.7 })
    )
    expect(bigger).toBeCloseTo(21.6, 9)
  })
})

describe('buildPackRequest', () => {
  it('returns null when there is nothing to pack', () => {
    expect(buildPackRequest([], settings())).toBeNull()
  })

  it('maps every settings field onto the contract', () => {
    const request = buildPackRequest(
      [cubePart('a'), cubePart('b')],
      settings({
        mode: 'max-quantity',
        tier: 'thorough',
        enterOuter: false,
        boxDimsMm: [300, 200, 100],
        clearancePartMm: 3,
        clearanceWallMm: 5,
        maxWeightG: 9000,
        weightMode: 'direct',
        partWeightG: 120
      })
    )
    expect(request).not.toBeNull()
    if (!request) return
    expect(request.mode).toBe('max-quantity')
    expect(request.tier).toBe('thorough')
    expect(request.carton).toEqual([300, 200, 100])
    expect(request.clearances).toEqual({ betweenParts: 3, wall: 5 })
    expect(request.maxWeightG).toBe(9000)
    expect(request.parts.map((p) => p.name)).toEqual(['a', 'b'])
    expect(request.parts.every((p) => p.weightG === 120)).toBe(true)
  })

  it('converts outer dims + wall thickness to the inner carton', () => {
    const request = buildPackRequest(
      [cubePart()],
      settings({ enterOuter: true, wallMm: 5, boxDimsMm: [300, 200, 100] })
    )
    expect(request?.carton).toEqual([290, 190, 90])
  })

  it('passes a degenerate carton through for the engine to answer honestly', () => {
    // Wall thicker than half the box → negative inner dims. Not filtered: the
    // engine reports "nothing fits", which beats leaving a stale result up.
    const request = buildPackRequest(
      [cubePart()],
      settings({ enterOuter: true, wallMm: 60, boxDimsMm: [100, 100, 100] })
    )
    expect(request?.carton).toEqual([-20, -20, -20])
  })

  it('shares the imported positions rather than copying them', () => {
    // The worker gets a structured-clone copy at postMessage; building the
    // request must not copy on the main thread too (see pack-protocol).
    const part = cubePart()
    const request = buildPackRequest([part], settings())
    expect(request?.parts[0].positions).toBe(part.positions)
  })
})
