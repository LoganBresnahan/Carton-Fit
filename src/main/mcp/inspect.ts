import { basename } from 'node:path'
import { aabbSize, computeAabb, isClosedMesh, meshVolume } from '../../renderer/src/core/geometry'
import { groupByKind, instanceAgreement } from '../../renderer/src/packing/kinds'
import type { ImportedPart } from '../../renderer/src/workers/import-protocol'
import type { Vec3 } from '../../renderer/src/core/packing/types'
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
  /** Triangles across every instance — a KIND TOTAL, and the only one here.
   *
   *  THE SUFFIXES ARE THE FIX (10th dogfood, 2026-09-06). This object carried
   *  `triangles`, `size` and `volume`: a total between two per-instance
   *  figures, adjacent, with nothing on the wire saying which was which. A
   *  reader got it right by noticing that one nut's volume was 74% of one
   *  nut's bounding box — and said plainly that a less lopsided ratio would
   *  have been a coin flip. Reading `count: 8` and dividing is 8× wrong. */
  trianglesTotal: number
  /** Bounding box of ONE instance, as placed. See `instancesAlike`: when that
   *  is false this is the instance we happened to measure, not a description of
   *  the others. */
  sizePerInstance: DimensionsValue
  /** Enclosed volume of one instance — rotation-invariant, so it describes
   *  every instance whatever `instancesAlike` says. Meaningless when
   *  `closedMesh` is false; that is what the flag is for. */
  volumePerInstance: VolumeValue
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
  /** Lengths only: this tool weighs nothing (ADR-0020, 8th dogfood). */
  units: { length: OutputUnits['length'] }
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


/** Extents largest-first, so instances that differ only by orientation agree. */
function descendingExtents(size: Vec3): Vec3 {
  const e = [...size].sort((a, b) => b - a)
  return [e[0], e[1], e[2]]
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
  // The agreement test itself lives in `packing/kinds`, and BOTH tools call it
  // (ADR-0029 amendment 10): `estimate` repeats this qualification, and two
  // implementations of "do these instances match?" would eventually disagree —
  // which would read as one tool qualifying an answer the other does not.
  // Structural rather than tested: there is one function, so agreement is not
  // something the suite has to keep checking.
  const agreement = instanceAgreement(parts)
  const mixedKinds = [...agreement].filter(([, a]) => a === 'different').map(([kind]) => kind)

  for (const [kind, instances] of groups) {
    const [sample] = instances
    // Alike in SHAPE. A kind whose instances are one box under permutation is
    // alike (15th dogfood — neither tier can tell the difference); its size is
    // still reported largest-first below, because "as placed" would name one.
    const placed = agreement.get(kind) ?? 'identical'
    const alike = placed !== 'different'
    // Extents as modelled when the instances agree; largest-first when they
    // do not (11th dogfood): the instances of the reference file's nut differ
    // by PERMUTATION — 0.118×0.591×0.787 beside 0.787×0.591×0.118 — so sorted
    // extents describe every instance where "the one we measured" described
    // one. A kind whose instances differ in actual extent would still get one
    // instance's numbers; no fixture has such a kind, and a range is the fix
    // for the day one does.
    const measured = aabbSize(computeAabb(sample.positions))
    const sampleSize = placed === 'identical' ? measured : descendingExtents(measured)
    const closed = isClosedMesh(sample.positions, sample.indices)
    if (!closed) openMeshKinds.push(kind)

    kinds.push({
      kind,
      count: instances.length,
      trianglesTotal: instances.reduce((sum, part) => sum + part.indices.length / 3, 0),
      sizePerInstance: dimsFromMm(sampleSize, units.length),
      volumePerInstance: volumeFromMm3(
        meshVolume(sample.positions, sample.indices),
        units.length
      ),
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
      triangles: kinds.reduce((sum, kind) => sum + kind.trianglesTotal, 0)
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
                `Instances of ${mixedKinds.join(', ')} do not share one shape — their boxes ` +
                'differ even when turned, and geometry arrives with each placement baked in. ' +
                'The size shown is one instance of each; volume is unaffected.'
            }
    },
    units: { length: units.length }
  }
}
