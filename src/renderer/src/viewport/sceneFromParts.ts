import { Group, Mesh, MeshStandardMaterial } from 'three'
import { partToBufferGeometry } from './partGeometry'
import { viewportPalette } from './palette'
import type { ImportedPart } from '../workers/import-protocol'

// Pure scene-builder (ADR-0008): protocol parts → a three Group of meshes. No
// DOM, no renderer, no store — so it unit-tests under vitest/Node exactly like
// partGeometry.ts. The lifecycle component owns lights, camera, and disposal;
// this only produces the content.

/** Neutral steel material, shared across every part in a scene. Sharing is
 *  intentional: it's one GPU program for the whole model, and the disposal
 *  contract (ADR-0008) dedupes materials so the shared instance is freed once.
 *
 *  `dark` is the RESOLVED scheme, not the preference (ADR-0025 §5), and it is
 *  required rather than defaulted: a caller that forgets the theme should be a
 *  type error, not a scene that quietly renders in the other one. */
export function defaultPartMaterial(dark: boolean): MeshStandardMaterial {
  const { part } = viewportPalette(dark)
  return new MeshStandardMaterial({ color: part, metalness: 0.15, roughness: 0.55 })
}

/**
 * Build a Group of meshes, one per part, geometry adopted from the part's
 * transferred buffers (via partToBufferGeometry). Meshes are named for the part
 * so later selection/inspection can find them. The whole Group is swapped
 * wholesale on re-import — this returns fresh objects rather than mutating.
 */
export function buildPartsScene(parts: ImportedPart[], dark: boolean): Group {
  const group = new Group()
  group.name = 'parts'
  const material = defaultPartMaterial(dark) // shared across the group
  for (const part of parts) {
    const mesh = new Mesh(partToBufferGeometry(part), material)
    mesh.name = part.name
    group.add(mesh)
  }
  return group
}
