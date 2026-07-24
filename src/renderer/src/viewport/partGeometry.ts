import { BufferAttribute, BufferGeometry, Box3, Vector3 } from 'three'
import { computeAabb, type Aabb } from '../core/geometry'
import type { ImportedPart } from '../workers/import-protocol'

// three.js adapter for the import pipeline (ADR-0002 `three-geometry-and-bboxes`).
// This is the boundary where pure protocol geometry becomes renderable — it is
// deliberately outside core/ because it imports three. The AABB itself is
// computed by the pure core function so packing (which never touches three) and
// the viewport agree on one bounding-box definition.

/** Build a renderable BufferGeometry from a protocol part. Buffers are adopted
 *  by reference — the part's typed arrays back the GPU attributes directly. */
export function partToBufferGeometry(part: ImportedPart): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(part.positions, 3))
  if (part.normals) {
    geometry.setAttribute('normal', new BufferAttribute(part.normals, 3))
  } else {
    geometry.computeVertexNormals()
  }
  geometry.setIndex(new BufferAttribute(part.indices, 1))
  return geometry
}

/** Pure-core AABB of a part (millimeters), shared with the packing engine. */
export function partAabb(part: ImportedPart): Aabb {
  return computeAabb(part.positions)
}

/** The three.js Box3 equivalent, for camera framing / scene math. */
export function partBox3(part: ImportedPart): Box3 {
  const { min, max } = partAabb(part)
  return new Box3(new Vector3(min[0], min[1], min[2]), new Vector3(max[0], max[1], max[2]))
}
