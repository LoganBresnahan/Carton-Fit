import { describe, expect, it } from 'vitest'
import {
  collectBuffers,
  requestTransferables,
  resultTransferables,
  type ImportedPart,
  type ImportRequest,
  type ImportResult
} from '../src/renderer/src/workers/import-protocol'

function part(overrides: Partial<ImportedPart> = {}): ImportedPart {
  return {
    name: 'part',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    ...overrides
  }
}

describe('collectBuffers', () => {
  it('returns the distinct underlying buffers, not the views', () => {
    const a = new Float32Array([1, 2, 3])
    const b = new Uint32Array([4, 5])
    const bufs = collectBuffers([a, b])
    expect(bufs).toEqual([a.buffer, b.buffer])
  })

  it('dedupes views that share one buffer (transferring twice would throw)', () => {
    const shared = new ArrayBuffer(32)
    const positions = new Float32Array(shared, 0, 4)
    const normals = new Float32Array(shared, 16, 4)
    const bufs = collectBuffers([positions, normals])
    expect(bufs).toHaveLength(1)
    expect(bufs[0]).toBe(shared)
  })

  it('skips null and undefined entries', () => {
    const a = new Uint32Array([1])
    expect(collectBuffers([null, a, undefined])).toEqual([a.buffer])
  })

  it('accepts a raw ArrayBuffer directly', () => {
    const raw = new ArrayBuffer(8)
    expect(collectBuffers([raw])).toEqual([raw])
  })
})

describe('requestTransferables', () => {
  it('transfers exactly the file bytes buffer', () => {
    const bytes = new ArrayBuffer(16)
    const request: ImportRequest = { id: 1, fileName: 'cube.stp', kind: 'step', bytes }
    expect(requestTransferables(request)).toEqual([bytes])
  })
})

describe('resultTransferables', () => {
  it('collects positions, normals, and indices buffers for every part', () => {
    const p0 = part()
    const p1 = part()
    const result: ImportResult = { id: 1, ok: true, parts: [p0, p1] }
    expect(resultTransferables(result)).toEqual([
      p0.positions.buffer,
      p0.normals!.buffer,
      p0.indices.buffer,
      p1.positions.buffer,
      p1.normals!.buffer,
      p1.indices.buffer
    ])
  })

  it('omits the normals buffer when a part has no normals', () => {
    const p = part({ normals: null })
    const result: ImportResult = { id: 2, ok: true, parts: [p] }
    expect(resultTransferables(result)).toEqual([p.positions.buffer, p.indices.buffer])
  })

  it('dedupes when a part packs its geometry into one shared buffer', () => {
    const shared = new ArrayBuffer(72)
    const p = part({
      positions: new Float32Array(shared, 0, 9),
      normals: new Float32Array(shared, 36, 9),
      indices: new Uint32Array([0, 1, 2]) // separate buffer
    })
    const result: ImportResult = { id: 3, ok: true, parts: [p] }
    const bufs = resultTransferables(result)
    expect(bufs).toHaveLength(2)
    expect(bufs).toContain(shared)
    expect(bufs).toContain(p.indices.buffer)
  })

  it('transfers nothing for an error result', () => {
    const result: ImportResult = { id: 4, ok: false, error: 'unparseable' }
    expect(resultTransferables(result)).toEqual([])
  })
})
