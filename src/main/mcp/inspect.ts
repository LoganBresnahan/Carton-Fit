import { basename } from 'node:path'
import { aabbSize, computeAabb, EPS, isClosedMesh, meshVolume } from '../../renderer/src/core/geometry'
import { kindOf } from '../../renderer/src/packing/kinds'
import type { ImportedPart } from '../../renderer/src/workers/import-protocol'
import {
  dimsFromMm,
  resolveOutputUnits,
  volumeFromMm3,
  type DimensionsValue,
  type OutputUnits,
  type VolumeValue
} from './wire'

// `inspect_model` (ADR-0029 v1) — what is in this file, geometrically.
//
// Grouped by KIND rather than by part (ADR-0018's grouping: `bolt`, `bolt (2)`,
// `bolt (3)` are one product), because "6 bolts, 12.4 mm³ each" is the sentence
// an engineer would write and "bolt (4): …" six times over is not.
//
// It contains no geometry of its own: every number comes from `core/geometry`,
// the same functions the viewport and the engine read. The ADR forbids new math
// here for a reason — a second implementation of mesh volume would eventually
// disagree with the first, and the disagreement would surface as an AI client
// quoting a weight the app's own screen contradicts.

export interface KindReport {
  /** The product name a weight override binds to (ADR-0018). */
  kind: string
  /** How many instances of it the file contains. */
  count: number
  /** Triangles across every instance. */
  triangles: number
  /** Bounding box of ONE instance, as placed. See `instancesAlike`. */
  size: DimensionsValue
  /** Enclosed volume of one instance — rotation-invariant, so it describes
   *  every instance whatever `instancesAlike` says. Meaningless when
   *  `closedMesh` is false; that is what the flag is for. */
  volume: VolumeValue
  /** False when the mesh is not watertight, which makes `volume` — and any
   *  weight derived from it — wrong rather than approximate (ADR-0015). */
  closedMesh: boolean
  /** True when every instance has the same bounding box. STEP geometry arrives
   *  with its assembly placement baked in (ADR-0002 addendum), so instances of
   *  one product sitting at different orientations have different boxes; when
   *  this is false, `size` describes the one instance it was measured from and
   *  not the other five. */
  instancesAlike: boolean
}

export interface InspectReport {
  file: { path: string; name: string }
  totals: { parts: number; kinds: number; triangles: number }
  /** Box enclosing every part where the file placed it. */
  boundingBox: DimensionsValue
  kinds: KindReport[]
  qualifications: InspectQualifications
  units: OutputUnits
}

/**
 * Everything about this answer that a reader must not have to infer.
 *
 * Both entries are objects with a REQUIRED discriminant rather than optional
 * fields, and that shape is the point: an omitted `openMesh` key and a file with
 * no open meshes look identical on the wire, so a client cannot tell "we
 * checked, you are fine" from "this build forgot to check". ADR-0029's rule is
 * that qualifications a client never received are our bug — so absence is never
 * how they are expressed.
 */
export interface InspectQualifications {
  openMesh: { affected: false } | { affected: true; kinds: string[]; note: string }
  mixedInstances: { affected: false } | { affected: true; kinds: string[]; note: string }
}

function extentsMatch(a: readonly number[], b: readonly number[]): boolean {
  return a.every((value, i) => Math.abs(value - b[i]) <= EPS)
}

/** Group parts into kinds in first-appearance order, carrying every instance
 *  (not just a sample) — the instance-agreement check needs them all. */
function groupByKind(parts: readonly ImportedPart[]): Map<string, ImportedPart[]> {
  const names = new Set(parts.map((part) => part.name))
  const groups = new Map<string, ImportedPart[]>()
  for (const part of parts) {
    const kind = kindOf(part.name, names)
    const existing = groups.get(kind)
    if (existing) existing.push(part)
    else groups.set(kind, [part])
  }
  return groups
}

export function inspectParts(
  filePath: string,
  parts: readonly ImportedPart[],
  requestedUnits?: Partial<OutputUnits>
): InspectReport {
  const units = resolveOutputUnits(requestedUnits)
  const groups = groupByKind(parts)

  const kinds: KindReport[] = []
  const openMeshKinds: string[] = []
  const mixedKinds: string[] = []

  for (const [kind, instances] of groups) {
    const [sample] = instances
    const sampleSize = aabbSize(computeAabb(sample.positions))
    const alike = instances.every((part) =>
      extentsMatch(sampleSize, aabbSize(computeAabb(part.positions)))
    )
    const closed = isClosedMesh(sample.positions, sample.indices)
    if (!closed) openMeshKinds.push(kind)
    if (!alike) mixedKinds.push(kind)

    kinds.push({
      kind,
      count: instances.length,
      triangles: instances.reduce((sum, part) => sum + part.indices.length / 3, 0),
      size: dimsFromMm(sampleSize, units.length),
      volume: volumeFromMm3(meshVolume(sample.positions, sample.indices), units.length),
      closedMesh: closed,
      instancesAlike: alike
    })
  }

  // Whole-model box: the union of every part where the file placed it, which is
  // what someone asking "will this thing go in a carton at all" means.
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const part of parts) {
    const box = computeAabb(part.positions)
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], box.min[i])
      max[i] = Math.max(max[i], box.max[i])
    }
  }
  const span: [number, number, number] = parts.length
    ? [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
    : [0, 0, 0]

  return {
    file: { path: filePath, name: basename(filePath) },
    totals: {
      parts: parts.length,
      kinds: kinds.length,
      triangles: kinds.reduce((sum, kind) => sum + kind.triangles, 0)
    },
    boundingBox: dimsFromMm(span, units.length),
    kinds,
    qualifications: {
      openMesh:
        openMeshKinds.length === 0
          ? { affected: false }
          : {
              affected: true,
              kinds: openMeshKinds,
              note:
                `${openMeshKinds.join(', ')} ${openMeshKinds.length === 1 ? 'is' : 'are'} not a ` +
                'closed mesh, so the volume reported for it is not the volume it encloses. ' +
                'Any weight derived from that volume is wrong, not approximate — give a part ' +
                'weight directly instead of a density.'
            },
      mixedInstances:
        mixedKinds.length === 0
          ? { affected: false }
          : {
              affected: true,
              kinds: mixedKinds,
              note:
                `Instances of ${mixedKinds.join(', ')} do not share one bounding box — the ` +
                'assembly places them at different orientations, and geometry arrives with ' +
                'that placement baked in. The size shown is one instance of each; volume is ' +
                'unaffected.'
            }
    },
    units
  }
}
