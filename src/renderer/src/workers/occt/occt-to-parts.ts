import type { OcctMesh, OcctNode, OcctResult } from 'occt-import-js'
import type { ImportedPart } from '../import-protocol'

// occt → protocol adapter. Kept pure and separate from the worker shell so it
// unit-tests without instantiating the WASM module.
//
// GEOMETRY IS ALREADY WORLD-SPACE (ADR-0002 addendum): occt-import-js composes
// each instance's full assembly placement inside OCCT and bakes it into the
// emitted vertices (positions get the full transform, normals rotation-only),
// duplicating shared meshes per instance with fresh mesh entries. Verified
// against its C++ (EnumerateVertices applies location.Transformation()) and
// empirically on nested CAx-IF assemblies — see tests/assembly-import.test.ts,
// which guards this assumption against future occt-import-js versions. So this
// adapter does NO transform math; what the node tree still owes us is *naming*:
// instance identity for parts the flat mesh list would leave ambiguous.

/** One mesh → one part. occt hands back plain JS number arrays, so each typed
 *  array allocates a fresh, distinct, transferable buffer — satisfying the
 *  protocol's "typed arrays own their buffer" contract. */
function occtMeshToPart(mesh: OcctMesh, name: string): ImportedPart {
  return {
    name,
    positions: new Float32Array(mesh.attributes.position.array),
    normals: mesh.attributes.normal ? new Float32Array(mesh.attributes.normal.array) : null,
    indices: new Uint32Array(mesh.index.array)
  }
}

/** Walk the node tree recording, per mesh index, the innermost node that owns
 *  it — the naming fallback when the mesh itself is anonymous. */
function collectOwners(node: OcctNode, owners: Map<number, string>, inherited: string): void {
  const label = node.name.trim() !== '' ? node.name : inherited
  for (const meshIndex of node.meshes) {
    owners.set(meshIndex, label)
  }
  for (const child of node.children) {
    collectOwners(child, owners, label)
  }
}

/**
 * Extract protocol parts from a full occt result, in mesh-index order.
 *
 * Naming: the mesh's own name, else the owning node's (inherited down the tree
 * for anonymous nodes), else "part". Duplicates — assemblies instancing one
 * product yield several identically-named meshes — get ordinal suffixes:
 * "bolt", "bolt (2)", "bolt (3)". Meshes unreferenced by any node (shouldn't
 * happen; the emitter builds the array from the tree) still become parts, so a
 * malformed hierarchy can't silently drop geometry from the estimate.
 */
export function extractParts(result: OcctResult): ImportedPart[] {
  const owners = new Map<number, string>()
  collectOwners(result.root, owners, '')

  const nameCounts = new Map<string, number>()
  return result.meshes.map((mesh, index) => {
    const base = mesh.name.trim() !== '' ? mesh.name : (owners.get(index) ?? '').trim() || 'part'
    const seen = (nameCounts.get(base) ?? 0) + 1
    nameCounts.set(base, seen)
    return occtMeshToPart(mesh, seen === 1 ? base : `${base} (${seen})`)
  })
}
