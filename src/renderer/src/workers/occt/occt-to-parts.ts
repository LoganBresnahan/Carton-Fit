import type { OcctMesh } from 'occt-import-js'
import type { ImportedPart } from '../import-protocol'

// occt's occt-agnostic → protocol adapter. Kept pure and separate from the
// worker shell so it unit-tests without instantiating the WASM module (occt
// under Node/vitest is a distinct asset-path problem, deferred to phase 5).

/**
 * Map occt's flat mesh list to protocol parts, one part per mesh.
 *
 * PHASE-2 SCOPE: this is a *flat* mapping — it ignores occt's node hierarchy and
 * per-instance placement transforms, so every mesh lands in its own local
 * coordinates. Correct for single parts and non-instanced files; an assembly
 * that instances a shared mesh at several placements renders them all stacked at
 * the origin. Phase 3's `assembly-part-extraction` replaces this by walking
 * `result.root` and baking each instance's transform into fresh positions.
 *
 * occt hands back plain JS number arrays, so each `new Float32Array(...)` /
 * `new Uint32Array(...)` allocates a fresh, distinct, transferable buffer —
 * satisfying the protocol's "typed arrays own their buffer" contract.
 */
export function occtMeshesToParts(meshes: readonly OcctMesh[]): ImportedPart[] {
  return meshes.map((mesh) => ({
    name: mesh.name,
    positions: new Float32Array(mesh.attributes.position.array),
    normals: mesh.attributes.normal ? new Float32Array(mesh.attributes.normal.array) : null,
    indices: new Uint32Array(mesh.index.array)
  }))
}
