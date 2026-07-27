import { EPS } from '../geometry'
import type { Clearances, Placement, Vec3 } from './types'

// ems-bookkeeping (ADR-0022 §3): empty-maximal-space accounting over a finished
// arrangement. EP places; EMS explains — this module exists ONLY for its
// reporting value, the "Largest free space: …" line on a non-fit (§7), and it is
// the pre-declared cut if that value ever stops paying for its cost.
//
// It is computed FROM THE PLACEMENTS, not maintained inside the placement loop.
// That is a deliberate departure from the textbook EP+EMS pairing, for three
// reasons that all come from this module's actual job:
//   - the arrangement being explained is the RACED winner (pack.ts), which may
//     be shelf's — an engine that knows nothing of extreme points. A derivation
//     over `Placement[]` explains either engine's stopping point;
//   - reporting-only code must not be able to perturb placement (a shared
//     incremental structure could); this way the dependency arrow points one way;
//   - the fuzz guards placements, not voids (build plan §4) — so the void code
//     carries its own obligations as checkable properties (emptiness,
//     maximality, coverage) over a pure function of its inputs, which is the
//     only oracle a reporting structure can have.
//
// THE SEMANTIC DECISION, fixed here because the wording slice inherits it: a
// space is usable-by-a-part, not raw air. Spaces live in the wall-shrunk window
// [wall, carton − wall] and subtract every placed box INFLATED by the
// between-parts gap on all six faces. So "largest free space 120 × 80 × 40"
// means a part with extents ≤ those dims could sit there honoring every
// clearance the user asked for — directly comparable to the unplaced part's own
// extents in the §7 sentence, with no gap arithmetic left to the reader. With
// zero clearances it degrades to plain empty space.
//
// Tolerance regime is the validator's (EPS, absolute mm): a box may shave a
// space by ≤ EPS without splitting it, and residual slivers ≤ EPS are dropped
// as float noise. Real voids are millimetres; noise is ~1e-13 mm.
//
// ABSENCE OVER MISINFORMATION (the upperBound precedent): any input this module
// cannot reason about honestly — a non-finite placement box, a space count past
// the cap — returns null, and the results line simply says nothing. A wrong
// void ships silently as misinformation; a missing one costs an explanation.

export interface FreeSpace {
  min: Vec3
  max: Vec3
}

/** Bail-out ceiling on tracked spaces. The difference process is O(spaces ×
 *  placements) with an O(spaces²) prune, so a pathological arrangement could
 *  otherwise buy quadratic work for a one-line report. Fit-check arrangements
 *  are tens of boxes and a few hundred spaces; hitting this cap means the
 *  input is not one this report was designed for, so the answer is "no
 *  report", never a truncated space list (dropping spaces silently breaks the
 *  maximality/coverage contract the properties test). */
export const MAX_EMS_SPACES = 4096

/** a ⊆ b, within EPS per face. */
function contained(a: FreeSpace, b: FreeSpace): boolean {
  for (let axis = 0; axis < 3; axis++) {
    if (b.min[axis] - a.min[axis] > EPS || a.max[axis] - b.max[axis] > EPS) return false
  }
  return true
}

/** Drop exact duplicates, then every space contained in another. Mutual
 *  (within-EPS) containment keeps the EARLIEST — index order, never content —
 *  so the survivor set is deterministic. Containment is checked against the
 *  full pre-prune list, not survivors: a space contained only in an also-pruned
 *  space is itself within 2·EPS of a survivor, and dropping it loses noise. */
function prune(list: FreeSpace[]): FreeSpace[] {
  const seen = new Set<string>()
  const uniq: FreeSpace[] = []
  for (const s of list) {
    const key = `${s.min.join(',')}|${s.max.join(',')}`
    if (seen.has(key)) continue
    seen.add(key)
    uniq.push(s)
  }
  return uniq.filter((s, i) =>
    uniq.every((t, j) => j === i || !contained(s, t) || (contained(t, s) && i < j))
  )
}

/**
 * Every maximal empty box of the arrangement: maximal boxes inside the
 * wall-shrunk window that miss every placed box inflated by the between-parts
 * gap (see the semantic decision above). Empty array ⇒ no usable space (or no
 * usable window); null ⇒ this input cannot be reported on honestly.
 *
 * The construction is the standard difference process, and it PROVES the three
 * properties the tests check: each space starts as the window and is only ever
 * split against a box it overlaps (emptiness); an empty box disjoint from a
 * placed box misses it on some axis side and therefore survives inside that
 * side's residual, inductively for every box (coverage); and a non-maximal
 * survivor would be contained in the space covering its extension, which the
 * prune removes (maximality). Determinism is by construction: placements are
 * processed in order, residuals spawn in fixed axis order, and the prune keys
 * on index, so the same arrangement yields the same spaces in the same order.
 */
export function emptyMaximalSpaces(
  placements: readonly Placement[],
  carton: Vec3,
  clearances: Clearances
): FreeSpace[] | null {
  // Same sanitization as the engines and the validator: a nonsense clearance
  // degrades to "no gap", never to an impossible geometry.
  const wall = Number.isFinite(clearances.wall) ? Math.max(0, clearances.wall) : 0
  const gap = Number.isFinite(clearances.betweenParts) ? Math.max(0, clearances.betweenParts) : 0

  const windowMin: Vec3 = [wall, wall, wall]
  const windowMax: [number, number, number] = [0, 0, 0]
  for (let axis = 0; axis < 3; axis++) {
    if (!Number.isFinite(carton[axis])) return null
    windowMax[axis] = carton[axis] - wall
    // A window with no room on some axis has no reportable space in it — a
    // real answer, not a refusal.
    if (windowMax[axis] - windowMin[axis] <= EPS) return []
  }

  let spaces: FreeSpace[] = [{ min: windowMin, max: windowMax }]

  for (const p of placements) {
    const bmin: [number, number, number] = [0, 0, 0]
    const bmax: [number, number, number] = [0, 0, 0]
    for (let axis = 0; axis < 3; axis++) {
      const lo = p.boxMin[axis]
      const hi = p.boxMax[axis]
      // A box whose coordinates cannot be reasoned about poisons every space
      // it might have touched — subtracting nothing would overstate the void.
      // Inverted (hi < lo beyond tolerance) is the validator's degenerate-box
      // and must refuse too: its crosswise bmin/bmax make the two residuals of
      // a split OVERLAP across the part's own interior, reporting the occupied
      // region as free (adversarial-verify refutation: a 20 mm inverted box
      // yielded a claimed 60-wide space where truth was 40, with 10 mm of
      // space-into-part interpenetration).
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo - EPS) return null
      bmin[axis] = lo - gap
      bmax[axis] = hi + gap
    }

    const next: FreeSpace[] = []
    for (const s of spaces) {
      // Disjoint (or within the shared EPS tolerance) — the space survives
      // whole. Open comparison: a box touching a space's face splits nothing.
      // SUBTRACTION shape, not `operand ± EPS` (the fitsLe lesson, refuted
      // here too by adversarial verify): `bmax <= s.min + EPS` opens a ~1e-16
      // rounding window when the addition rounds up, in which a box
      // penetrating by just over EPS is called disjoint and the space claims
      // the overlapped sliver as free — breaking the emptiness property on a
      // validator-clean arrangement. Same floats as the validator, same
      // verdicts.
      let disjoint = false
      for (let axis = 0; axis < 3; axis++) {
        if (bmin[axis] - s.max[axis] >= -EPS || s.min[axis] - bmax[axis] >= -EPS) {
          disjoint = true
          break
        }
      }
      if (disjoint) {
        next.push(s)
        continue
      }
      // Up to six residual slabs, each spanning the space's FULL extent on the
      // other two axes — that spanning is what makes residuals candidates for
      // maximality rather than a disjoint partition. Slivers ≤ EPS are noise.
      for (let axis = 0; axis < 3; axis++) {
        if (bmin[axis] - s.min[axis] > EPS) {
          const max: [number, number, number] = [s.max[0], s.max[1], s.max[2]]
          max[axis] = bmin[axis]
          next.push({ min: s.min, max })
        }
        if (s.max[axis] - bmax[axis] > EPS) {
          const min: [number, number, number] = [s.min[0], s.min[1], s.min[2]]
          min[axis] = bmax[axis]
          next.push({ min, max: s.max })
        }
      }
    }

    spaces = prune(next)
    if (spaces.length > MAX_EMS_SPACES) return null
  }

  return spaces
}

/** Extent of a space, per axis. */
function extentOf(s: FreeSpace): Vec3 {
  return [s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]]
}

/** Sorted-factor volume (the ulp lesson, third appearance): mathematically
 *  equal volumes must compare equal, or noise rather than the tie-break picks
 *  the reported space. */
function spaceVolume(s: FreeSpace): number {
  const e = [...extentOf(s)].sort((x, y) => x - y)
  return e[0] * e[1] * e[2]
}

/**
 * Dimensions of the largest usable free space, or null when there is none to
 * report (no spaces, or an input `emptyMaximalSpaces` refuses). "Largest" is by
 * volume; ties break by sorted dims descending, then by the earliest space in
 * the (deterministic) list order — strictly-better replacement, so the
 * reported triple is a deterministic function of the arrangement — the
 * determinism suite (phase 5) holds the reported void to the same bar as
 * placements. Dims come back unsorted (x, y, z); presentation order is the
 * wording slice's decision (§7 sorts both triples descending).
 */
export function largestFreeSpace(
  placements: readonly Placement[],
  carton: Vec3,
  clearances: Clearances
): Vec3 | null {
  const spaces = emptyMaximalSpaces(placements, carton, clearances)
  if (spaces === null || spaces.length === 0) return null

  let best = spaces[0]
  let bestVolume = spaceVolume(best)
  let bestSorted = [...extentOf(best)].sort((x, y) => y - x)
  for (let i = 1; i < spaces.length; i++) {
    const s = spaces[i]
    const v = spaceVolume(s)
    if (v < bestVolume) continue
    const sorted = [...extentOf(s)].sort((x, y) => y - x)
    let wins = false
    if (v > bestVolume) {
      wins = true
    } else {
      // Equal volume: larger leading dims, then the earlier (smaller) corner.
      for (let axis = 0; axis < 3; axis++) {
        if (sorted[axis] !== bestSorted[axis]) {
          wins = sorted[axis] > bestSorted[axis]
          break
        }
      }
    }
    if (wins) {
      best = s
      bestVolume = v
      bestSorted = sorted
    }
  }
  return extentOf(best)
}
