import { isClosedMesh, meshVolume } from '../core/geometry'
import { densityWeightG } from '../core/units'
import { overrideForPart, type PartWeightOverrides } from './kinds'
import { innerCartonMm, type PackingSettings } from '../store'
import type { PackPart, PackRequest } from '../core/packing/types'
import type { ImportedPart } from '../workers/import-protocol'

// Settings + imported parts → a PackRequest (roadmap item 4). This is the one
// place the UI's input vocabulary (outer dims + wall, density, display units) is
// translated into the engine's contract vocabulary (inner carton mm, grams per
// part). Pure and total so the auto-runner and tests can call it freely.

// Mesh volume is O(triangles) and only changes when the part does, but the
// auto-runner rebuilds a request on every keystroke — so memoize per part
// object. Parts are stable across settings changes (same array from the import),
// so this hits every time the carton or density is edited.
const volumeCache = new WeakMap<ImportedPart, number>()

function volumeOf(part: ImportedPart): number {
  const cached = volumeCache.get(part)
  if (cached !== undefined) return cached
  const volume = meshVolume(part.positions, part.indices)
  volumeCache.set(part, volume)
  return volume
}

/** Per-part weight in grams, from whichever ADR-0004 source the user selected.
 *  Direct entry is per part, so it applies to each part in a multi-part file.
 *  On an open mesh the density branch is WRONG, not approximate — see
 *  {@link openMeshParts}, which is what makes that visible instead of silent.
 *
 *  This is the DEFAULT a part gets. A per-kind override replaces it — see
 *  {@link effectiveWeightG}, which is what the request is actually built from. */
export function partWeightG(part: ImportedPart, settings: PackingSettings): number {
  if (settings.weightMode === 'direct') return settings.partWeightG
  return densityWeightG(settings.densityGPerCm3, volumeOf(part))
}

/**
 * What a part actually weighs for packing: its kind's override if one is set,
 * else the mode's answer (ADR-0018 §1).
 *
 * The layering is the decision. Density stays useful as a default GENERATOR —
 * set the steel once, then correct the two nylon parts — rather than being
 * replaced by a mode that makes every weight a typing job.
 */
export function effectiveWeightG(
  part: ImportedPart,
  settings: PackingSettings,
  names: ReadonlySet<string>,
  overrides: PartWeightOverrides
): number {
  return overrideForPart(part, names, overrides) ?? partWeightG(part, settings)
}

// Closedness is as expensive as the volume it qualifies and just as stable per
// part, so it memoizes the same way. Computed lazily — direct-weight mode never
// asks, and neither does an untouched session.
const closedCache = new WeakMap<ImportedPart, boolean>()

function isClosed(part: ImportedPart): boolean {
  const cached = closedCache.get(part)
  if (cached !== undefined) return cached
  const closed = isClosedMesh(part.positions, part.indices)
  closedCache.set(part, closed)
  return closed
}

/**
 * Names of the parts whose weight is currently being derived from a meaningless
 * volume: density mode over a mesh that is not watertight.
 *
 * `meshVolume`'s signed-tetrahedron sum only cancels correctly when every edge
 * is shared by two triangles. On an open mesh it still returns a number, so
 * nothing throws and nothing looks wrong — the app reports a confident weight
 * that is simply false. Weight is a hard constraint (ADR-0004), so that becomes
 * a wrong part count and a possibly wrong binding constraint.
 *
 * Scoped to the parts the request actually packs, so a max-quantity run that
 * replicates one chosen part does not warn about parts whose weight it never
 * spends. Empty in direct-weight mode: no volume, no exposure.
 */
export function openMeshParts(
  parts: readonly ImportedPart[],
  settings: PackingSettings,
  unitPartName: string | null = null,
  overrides: PartWeightOverrides = {}
): string[] {
  if (settings.weightMode !== 'density') return []
  const names = new Set(parts.map((part) => part.name))
  return partsForRequest(parts, settings, unitPartName)
    // An overridden kind no longer derives its weight from its volume, so the
    // volume being meaningless costs nothing (ADR-0018 §4). This is not merely
    // consistency: entering the weight directly is one of the two fixes this
    // warning's own wording recommends, so the warning has to retire when the
    // user takes its advice — otherwise it is telling them to do something it
    // will not acknowledge.
    .filter((part) => overrideForPart(part, names, overrides) === null)
    .filter((part) => !isClosed(part))
    .map((part) => part.name)
}

/**
 * The parts this request packs. Fit-check always takes the whole file — the
 * question is whether everything fits. Max-quantity replicates ONE unit, which
 * is either a chosen part or the whole file fused into one rigid unit
 * (ADR-0003), so a selection narrows it. A selection naming a part the current
 * file does not have falls back to the whole file rather than packing nothing:
 * the picker is a convenience, never a way to get a misleading empty answer.
 */
function partsForRequest(
  parts: readonly ImportedPart[],
  settings: PackingSettings,
  unitPartName: string | null
): readonly ImportedPart[] {
  if (settings.mode !== 'max-quantity' || !unitPartName) return parts
  const chosen = parts.filter((part) => part.name === unitPartName)
  return chosen.length > 0 ? chosen : parts
}

/**
 * Build the request for the current inputs, or null when there is nothing to
 * pack. A degenerate carton (wall thicker than the box) is NOT filtered out —
 * the engine answers it honestly with "nothing fits, geometry binding", which
 * beats silently leaving a stale result on screen.
 */
export function buildPackRequest(
  parts: readonly ImportedPart[],
  settings: PackingSettings,
  unitPartName: string | null = null,
  overrides: PartWeightOverrides = {}
): PackRequest | null {
  if (parts.length === 0) return null
  // Resolved against the WHOLE file's names, not the selected subset: kind
  // membership is a property of the file, and a max-quantity run over one
  // chosen part must still know that `bolt (2)` is a bolt.
  const names = new Set(parts.map((part) => part.name))
  const selected = partsForRequest(parts, settings, unitPartName)
  const packParts: PackPart[] = selected.map((part) => ({
    name: part.name,
    positions: part.positions,
    weightG: effectiveWeightG(part, settings, names, overrides)
  }))
  return {
    mode: settings.mode,
    tier: settings.tier,
    carton: innerCartonMm(settings),
    clearances: {
      betweenParts: settings.clearancePartMm,
      wall: settings.clearanceWallMm
    },
    maxWeightG: settings.maxWeightG,
    parts: packParts
  }
}
