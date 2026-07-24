import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import occtFactory, { type OcctModule } from 'occt-import-js'
import { STLLoader } from '../src/renderer/src/workers/adapters/stlLoader'
import { extractParts } from '../src/renderer/src/workers/occt/occt-to-parts'
import { bufferGeometryToPart } from '../src/renderer/src/workers/stlToPart'
import { aabbSize, computeAabb, isClosedMesh, meshVolume } from '../src/renderer/src/core/geometry'

// The golden gate (ADR-0002 `golden-step-parse-test`, the verify slice). Goldens
// are HAND-COMPUTED, independent of what occt/three emit — the anti-tautology
// guard the slice demands:
//   - a 10 mm cube has volume 10^3 = 1000 mm^3 and a 10×10×10 AABB, by arithmetic.
//   - AS1 (CAx-IF) is a known assembly of 18 solids: 1 plate + 2 L-brackets +
//     1 rod + 6 bolts + 8 nuts, by inspecting the product.
// A snapshot of the parser's own output would pass even if the parser were wrong;
// these do not.

const SAMPLES = join(__dirname, '..', 'samples')

function sampleBuffer(name: string): Buffer {
  return readFileSync(join(SAMPLES, name))
}

let occt: OcctModule
beforeAll(async () => {
  occt = await occtFactory()
}, 60_000)

describe('STEP golden: cube-10x10.stp', () => {
  it('is one closed part, a 10mm cube of volume 1000 mm³', () => {
    const result = occt.ReadStepFile(new Uint8Array(sampleBuffer('cube-10x10.stp')), {
      linearUnit: 'millimeter'
    })
    const parts = extractParts(result)
    expect(parts).toHaveLength(1)
    const [p] = parts
    const size = aabbSize(computeAabb(p.positions))
    expect(size[0]).toBeCloseTo(10, 3)
    expect(size[1]).toBeCloseTo(10, 3)
    expect(size[2]).toBeCloseTo(10, 3)
    expect(meshVolume(p.positions, p.indices)).toBeCloseTo(1000, 3)
    expect(isClosedMesh(p.positions, p.indices)).toBe(true)
  })
})

describe('STL golden: cube-10x10.stl', () => {
  it('parses to the same 10mm cube: volume 1000 mm³, closed', () => {
    const ab = new Uint8Array(sampleBuffer('cube-10x10.stl')).buffer // fresh ArrayBuffer
    const part = bufferGeometryToPart(new STLLoader().parse(ab), 'cube-10x10')
    const size = aabbSize(computeAabb(part.positions))
    expect(size[0]).toBeCloseTo(10, 3)
    expect(size[1]).toBeCloseTo(10, 3)
    expect(size[2]).toBeCloseTo(10, 3)
    expect(meshVolume(part.positions, part.indices)).toBeCloseTo(1000, 3)
    // STLLoader emits fully-duplicated vertices; a closed result proves the
    // position-welded manifold check (not index-based) is doing its job.
    expect(isClosedMesh(part.positions, part.indices)).toBe(true)
  })
})

describe('STEP golden: as1-oc-214.stp (nested instanced assembly)', () => {
  it('extracts the 18 solids of the AS1 assembly', () => {
    const result = occt.ReadStepFile(new Uint8Array(sampleBuffer('as1-oc-214.stp')), {
      linearUnit: 'millimeter'
    })
    const parts = extractParts(result)
    expect(parts).toHaveLength(18) // hand census: 1 plate + 2 brackets + 1 rod + 6 bolts + 8 nuts

    // The plate is 180×150×20 at the origin, so the whole-assembly AABB must span
    // at least the plate's footprint — a sanity floor derived from the part, not
    // from the parser.
    const min: [number, number, number] = [Infinity, Infinity, Infinity]
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    for (const p of parts) {
      const b = computeAabb(p.positions)
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], b.min[i])
        max[i] = Math.max(max[i], b.max[i])
      }
    }
    expect(max[0] - min[0]).toBeGreaterThanOrEqual(180)
    expect(max[1] - min[1]).toBeGreaterThanOrEqual(150)
  })
})
