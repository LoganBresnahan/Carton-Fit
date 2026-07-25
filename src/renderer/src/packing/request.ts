import { meshVolume } from '../core/geometry'
import { densityWeightG } from '../core/units'
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
 *  Direct entry is per part, so it applies to each part in a multi-part file. */
export function partWeightG(part: ImportedPart, settings: PackingSettings): number {
  if (settings.weightMode === 'direct') return settings.partWeightG
  return densityWeightG(settings.densityGPerCm3, volumeOf(part))
}

/**
 * Build the request for the current inputs, or null when there is nothing to
 * pack. A degenerate carton (wall thicker than the box) is NOT filtered out —
 * the engine answers it honestly with "nothing fits, geometry binding", which
 * beats silently leaving a stale result on screen.
 */
export function buildPackRequest(
  parts: readonly ImportedPart[],
  settings: PackingSettings
): PackRequest | null {
  if (parts.length === 0) return null
  const packParts: PackPart[] = parts.map((part) => ({
    name: part.name,
    positions: part.positions,
    weightG: partWeightG(part, settings)
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
