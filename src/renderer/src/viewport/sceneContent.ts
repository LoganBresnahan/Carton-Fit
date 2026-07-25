import type { BufferGeometry, InstancedMesh, Material, Object3D } from 'three'

/** Anything three renders from a geometry + material: Mesh, InstancedMesh,
 *  LineSegments (the packed view's carton), Points. Matching on the PROPERTIES
 *  rather than on `isMesh` is what keeps non-mesh content from leaking. */
type Renderable = Object3D & {
  geometry?: BufferGeometry
  material?: Material | Material[]
  isInstancedMesh?: boolean
}

// The single choke point for viewport content (ADR-0008 phases 3-4). All scene
// swaps go through swapContent so disposal has exactly one place to hook — the
// component never adds/removes meshes directly. Pure (operates on three objects,
// no DOM/React), so the disposal contract is unit-tested in Node.

/**
 * Dispose a subtree's GPU resources. Every geometry is freed; materials are
 * collected into a set and disposed once each, because the scene builders share
 * one material across all parts — disposing per-mesh would double-free it.
 * InstancedMesh additionally owns an instance-matrix buffer, released by its own
 * dispose(). A missed dispose here is a silent GPU-memory leak on every
 * re-import or re-pack, which is why this is separated out and tested.
 */
export function disposeObject(root: Object3D): void {
  const materials = new Set<Material>()
  root.traverse((obj) => {
    const node = obj as Renderable
    if (node.isInstancedMesh) (node as InstancedMesh).dispose()
    node.geometry?.dispose()
    const material = node.material
    if (Array.isArray(material)) for (const m of material) materials.add(m)
    else if (material) materials.add(material)
  })
  for (const material of materials) material.dispose()
}

/**
 * Swap viewport content: detach and dispose `current`, attach `next`, and return
 * `next` as the new current. Passing `next = null` clears (used on reset and on
 * unmount). This is the only mutator of the content subtree.
 */
export function swapContent(
  parent: Object3D,
  current: Object3D | null,
  next: Object3D | null
): Object3D | null {
  if (current) {
    parent.remove(current)
    disposeObject(current)
  }
  if (next) parent.add(next)
  return next
}
