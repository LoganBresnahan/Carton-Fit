import { describe, expect, it } from 'vitest'
import { BufferAttribute, BufferGeometry } from 'three'
import { bufferGeometryToPart } from '../src/renderer/src/workers/stlToPart'

function geometry(opts: { positions: number[]; normals?: number[]; index?: number[] }): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(opts.positions), 3))
  if (opts.normals) g.setAttribute('normal', new BufferAttribute(new Float32Array(opts.normals), 3))
  if (opts.index) g.setIndex(new BufferAttribute(new Uint32Array(opts.index), 1))
  return g
}

describe('bufferGeometryToPart', () => {
  it('synthesizes sequential indices for non-indexed geometry (STLLoader output)', () => {
    const part = bufferGeometryToPart(
      geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1] }),
      'cube'
    )
    expect(part.name).toBe('cube')
    expect(Array.from(part.indices)).toEqual([0, 1, 2])
    expect(part.positions).toBeInstanceOf(Float32Array)
    expect(part.normals).toBeInstanceOf(Float32Array)
  })

  it('yields null normals when the geometry has none', () => {
    const part = bufferGeometryToPart(geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }), 'x')
    expect(part.normals).toBeNull()
  })

  it('honors an existing index when present', () => {
    const part = bufferGeometryToPart(
      geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], index: [0, 1, 2, 0, 2, 3] }),
      'x'
    )
    expect(Array.from(part.indices)).toEqual([0, 1, 2, 0, 2, 3])
  })

  it('copies into fresh transferable buffers', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    const part = bufferGeometryToPart(geometry({ positions: src }), 'x')
    expect(part.positions.buffer.byteLength).toBe(part.positions.length * 4)
  })

  it('throws when there is no position attribute', () => {
    expect(() => bufferGeometryToPart(new BufferGeometry(), 'x')).toThrow()
  })
})
