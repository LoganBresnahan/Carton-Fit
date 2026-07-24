import type { BufferGeometry } from 'three'
import type { ImportedPart } from './import-protocol'

// Normalize a three BufferGeometry (from STLLoader) into the backend-independent
// protocol shape (ADR-0002 `stl-loader-path`). STL carries one mesh with no part
// hierarchy and no index, so this produces a single part with sequential indices.
// Pure — no jsm, no DOM — so it unit-tests with a hand-built geometry.

function sequentialIndices(vertexCount: number): Uint32Array {
  const indices = new Uint32Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) indices[i] = i
  return indices
}

/**
 * One STL geometry → one ImportedPart. Positions/normals are copied into fresh
 * typed arrays (distinct transferable buffers, per the protocol contract).
 * STLLoader emits non-indexed geometry, so we synthesize a trivial index; if a
 * geometry ever arrives indexed we honor its index instead.
 */
export function bufferGeometryToPart(geometry: BufferGeometry, name: string): ImportedPart {
  const position = geometry.getAttribute('position')
  if (!position) throw new Error('STL geometry has no position attribute')

  const positions = new Float32Array(position.array)
  const normalAttr = geometry.getAttribute('normal')
  const normals = normalAttr ? new Float32Array(normalAttr.array) : null
  const existingIndex = geometry.getIndex()
  const indices = existingIndex
    ? new Uint32Array(existingIndex.array)
    : sequentialIndices(position.count)

  return { name, positions, normals, indices }
}
