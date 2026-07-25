import {
  Box3,
  BoxGeometry,
  EdgesGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Vector3
} from 'three'
import { partToBufferGeometry } from './partGeometry'
import { defaultPartMaterial } from './sceneFromParts'
import type { Placement, Vec3 } from '../core/packing/types'
import type { ImportedPart } from '../workers/import-protocol'

// Pure scene-builder for the packed view (roadmap item 4): a pack result becomes
// a wireframe carton plus the placed parts. No DOM, no renderer, no store — so
// the matrix convention below is unit-tested in Node against the same pure math
// the engine used.
//
// THE CONVENTION, stated once because getting it wrong is SILENT (a transposed
// rotation still renders a plausible-looking box of parts):
//   - our Mat3 is ROW-major and acts as v' = M · v (core/packing/types);
//   - three stores matrices column-major BUT `Matrix4.set()` takes its arguments
//     in row-major order and transposes on the way in;
//   - so the rows map straight across, and the placement's translation — applied
//     AFTER the rotation, per the contract — is the fourth column.
// The test asserts three's transform equals applyMat3 + translation on
// asymmetric rotations, where a transpose gives a different answer.

const CARTON_LINE = 0x7c88a0

/** The affine transform for one placement: world = rotation · v + translation. */
export function placementMatrix(placement: Placement): Matrix4 {
  const m = placement.rotation
  const t = placement.translation
  return new Matrix4().set(
    m[0], m[1], m[2], t[0],
    m[3], m[4], m[5], t[1],
    m[6], m[7], m[8], t[2],
    0, 0, 0, 1
  )
}

/** Wireframe box spanning [0,0,0] → carton, matching the engine's carton space
 *  (placements are corner coordinates measured from the inner box origin). */
export function buildCartonWireframe(carton: Vec3): LineSegments {
  const [x, y, z] = carton
  const box = new BoxGeometry(Math.max(x, 0), Math.max(y, 0), Math.max(z, 0))
  const edges = new EdgesGeometry(box)
  box.dispose() // EdgesGeometry copies what it needs; the source box is scrap
  const lines = new LineSegments(edges, new LineBasicMaterial({ color: CARTON_LINE }))
  // BoxGeometry is origin-centered; the carton runs corner-to-corner from 0.
  lines.position.set(x / 2, y / 2, z / 2)
  lines.name = 'carton'
  return lines
}

/** Bounds of the packed scene — the carton itself, so framing is stable no
 *  matter how few parts got placed. */
export function boundsOfCarton(carton: Vec3): Box3 {
  return new Box3(new Vector3(0, 0, 0), new Vector3(carton[0], carton[1], carton[2]))
}

/**
 * Build the packed scene: carton wireframe + one InstancedMesh per distinct part.
 *
 * Instancing is not an optimization here, it is the difference between working
 * and not: a max-quantity result can carry tens of thousands of placements
 * (capped at MAX_GRID_PLACEMENTS = 50,000), and that many individual Meshes
 * would stall the renderer. One draw call per part handles the whole grid.
 */
export function buildPackedScene(
  parts: readonly ImportedPart[],
  placements: readonly Placement[],
  carton: Vec3
): Group {
  const group = new Group()
  group.name = 'packed'
  group.add(buildCartonWireframe(carton))

  const byName = new Map<string, ImportedPart>()
  for (const part of parts) byName.set(part.name, part)

  // Group placements per part, preserving order, so each part gets one instanced
  // draw. Placements naming a part we no longer hold are skipped rather than
  // throwing — the view must never be the thing that breaks on stale data.
  const grouped = new Map<string, Placement[]>()
  for (const placement of placements) {
    if (!byName.has(placement.partName)) continue
    const list = grouped.get(placement.partName)
    if (list) list.push(placement)
    else grouped.set(placement.partName, [placement])
  }

  if (grouped.size > 0) {
    const material = defaultPartMaterial() // shared; disposed once (sceneContent)
    for (const [name, group_] of grouped) {
      const part = byName.get(name)!
      const mesh = new InstancedMesh(partToBufferGeometry(part), material, group_.length)
      mesh.name = name
      group_.forEach((placement, i) => mesh.setMatrixAt(i, placementMatrix(placement)))
      mesh.instanceMatrix.needsUpdate = true
      group.add(mesh)
    }
  }
  return group
}
