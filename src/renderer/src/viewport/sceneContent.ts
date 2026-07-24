import type { Material, Mesh, Object3D } from 'three'

// The single choke point for viewport content (ADR-0008 phases 3-4). All scene
// swaps go through swapContent so disposal has exactly one place to hook — the
// component never adds/removes meshes directly. Pure (operates on three objects,
// no DOM/React), so the disposal contract is unit-tested in Node.

/**
 * Dispose a subtree's GPU resources. Every mesh geometry is freed; materials are
 * collected into a set and disposed once each, because buildPartsScene shares one
 * material across all parts — disposing per-mesh would double-free it. A missed
 * dispose here is a silent GPU-memory leak on every re-import, which is why this
 * is separated out and tested rather than trusted.
 */
export function disposeObject(root: Object3D): void {
  const materials = new Set<Material>()
  root.traverse((obj) => {
    const mesh = obj as Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const material = mesh.material
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
