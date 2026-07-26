import type { ImportedPart } from '../workers/import-protocol'

// Part KINDS (ADR-0018): the grouping weight overrides bind to.
//
// An assembly that instances one product yields several identically-named
// meshes, and `workers/occt/occt-to-parts.ts` uniques them with ordinal
// suffixes of its own making: `bolt`, `bolt (2)`, `bolt (3)`. So the suffix is
// not data from the file — it is ours — and stripping it recovers the product
// name the file actually gave. Six bolts are one kind, and one weight.
//
// Pure and free of the store, so the grouping rules are unit-testable and the
// panel, the request builder and the warning all agree by construction.

/** Our own ordinal suffix, anchored at the end: ` (2)`, ` (17)`. */
const ORDINAL = / \((\d+)\)$/

/**
 * The kind a part name belongs to.
 *
 * ONLY our own suffix pattern is stripped, and only when the file really does
 * contain the base name — because a CAD part legitimately named `flange (2)`
 * with no `flange` beside it is its own product, not the second instance of
 * something. Folding it into a group that does not exist would attach its
 * weight to a phantom kind and show a count of one under the wrong label.
 *
 * @param names every part name in the file, which is what makes the
 *              does-the-base-exist test possible.
 */
export function kindOf(name: string, names: ReadonlySet<string>): string {
  const match = ORDINAL.exec(name)
  if (!match) return name
  const base = name.slice(0, match.index)
  // `bolt (2)` is an instance of `bolt` only if `bolt` was emitted too — the
  // uniquer always emits the unsuffixed first instance before any suffixed one.
  return names.has(base) ? base : name
}

export interface PartKind {
  /** The product name — what the override binds to and the panel labels. */
  kind: string
  /** How many parts in the file belong to it. */
  count: number
  /** One representative part, for the default weight the panel shows. */
  sample: ImportedPart
}

/**
 * The distinct kinds in a file, in first-appearance order.
 *
 * Order matters: the inputs panel lists these, and a stable, file-derived order
 * means the row you edited does not move when an unrelated setting changes.
 */
export function partKinds(parts: readonly ImportedPart[]): PartKind[] {
  const names = new Set(parts.map((part) => part.name))
  const byKind = new Map<string, PartKind>()
  for (const part of parts) {
    const kind = kindOf(part.name, names)
    const existing = byKind.get(kind)
    if (existing) existing.count += 1
    else byKind.set(kind, { kind, count: 1, sample: part })
  }
  return [...byKind.values()]
}

/** Weight overrides in grams, keyed by kind. Absent key = no override. */
export type PartWeightOverrides = Readonly<Record<string, number>>

/**
 * The override that applies to a part, or null.
 *
 * Takes the full name set rather than a precomputed kind so callers cannot
 * accidentally resolve against a stale grouping — the parts array is always
 * the authority.
 */
export function overrideForPart(
  part: ImportedPart,
  names: ReadonlySet<string>,
  overrides: PartWeightOverrides
): number | null {
  const value = overrides[kindOf(part.name, names)]
  // Guarded rather than trusted: overrides survive a round-trip through a
  // saved estimate's JSON, so a row written by another build can carry
  // anything. A negative or non-finite weight would corrupt the cap silently.
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** Drop overrides naming kinds this file does not have (ADR-0018 §4:
 *  a restored estimate's overrides apply by kind, and unknown ones are
 *  ignored rather than kept as invisible state). */
export function pruneOverrides(
  overrides: PartWeightOverrides,
  parts: readonly ImportedPart[]
): PartWeightOverrides {
  const kinds = new Set(partKinds(parts).map((entry) => entry.kind))
  const kept: Record<string, number> = {}
  for (const [kind, value] of Object.entries(overrides)) {
    if (kinds.has(kind)) kept[kind] = value
  }
  return kept
}
