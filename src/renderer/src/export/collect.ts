import { lengthUnitLabel } from '../core/units'
import { lengthText } from './format'
import { approximateVolumeKinds, openMeshParts, partsForRequest } from '../packing/request'
import { meshVolume } from '../core/geometry'
import { mixedInstanceKinds } from '../packing/kinds'
import {
  meshVolumeReport,
  meshVolumeWarning,
  mixedInstancesWarning,
  openMeshWarning,
  truncatedLayoutNote,
  weightlessWarning
} from '../packing/verdict'
import { useAppStore } from '../store'
import type { EstimateExport } from './types'

// Assemble an EstimateExport from what is on screen (ADR-0017).
//
// Reads the store for the same reason `storage/estimates.ts` does: the thing
// being exported is *what the user is looking at*, and passing it in from a
// component would open a gap between the two. The builders themselves stay pure
// — this is the only impure step, and it is one function.

/**
 * The live estimate as export input, or null when there is nothing current to
 * export.
 *
 * Null on a stale or in-flight pack on purpose: exporting mid-repack would
 * write a file describing an answer the app has already superseded, and a file
 * outlives the moment in a way the dimmed panel does not. Same guard as
 * Save estimate (ADR-0016).
 */
export function collectExport(): EstimateExport | null {
  const state = useAppStore.getState()
  const { packResult, packRequest, packStatus, settings, parts, unitPartName, file } = state
  if (packStatus !== 'done' || !packResult || !packRequest) return null

  // Both qualifiers come from verdict.ts, so the export and the panel say the
  // same sentence (ADR-0017 §2) — and adding a third warning to the panel
  // means adding it here, in one obvious place.
  // One report for the density line AND the warning (ADR-0015 addendum 2),
  // computed once here so the two cannot disagree about which kinds.
  const meshVolumes = meshVolumeReport(
    packResult,
    packRequest,
    approximateVolumeKinds(parts, settings, unitPartName, state.partWeightsG)
  )
  const warnings = [
    openMeshWarning(openMeshParts(parts, settings, unitPartName, state.partWeightsG)),
    meshVolumeWarning(meshVolumes),
    // Scoped to the parts the PACK used, like the open-mesh warning above it:
    // a max-quantity run over one kind is not qualified by kinds it never
    // counted. Added on the 8th dogfood — the comment above was written before
    // that miss and named this exact line as the place to touch.
    mixedInstancesWarning(mixedInstanceKinds(partsForRequest(parts, settings, unitPartName))),
    // A pack with no weight at all (15th dogfood): the request knows, and the
    // exports used to print its zero as a weight someone entered.
    weightlessWarning(packRequest),
    truncatedLayoutNote(packResult)
  ].filter((warning): warning is string => warning !== null)

  // The enclosed volume rides with the export because only this side holds the
  // indices to compute it; `PackRequest` carries positions alone.
  const enclosedVolumeMm3: Record<string, number> = {}
  for (const part of parts) enclosedVolumeMm3[part.name] = meshVolume(part.positions, part.indices)

  return {
    fileName: file?.name ?? null,
    request: packRequest,
    result: packResult,
    settings,
    unitPartName,
    warnings,
    overrides: state.partWeightsG,
    enclosedVolumeMm3,
    meshVolumes
  }
}

/**
 * A filename that says what it is: part, carton and mode, sanitized for every
 * filesystem we ship to.
 *
 * A folder of `estimate.csv`, `estimate (1).csv`, `estimate (2).csv` is what
 * makes an export feature useless a week later — the dogfooding session that
 * asked for export is exactly the one that produces a dozen of these.
 */
export function suggestedFileName(input: EstimateExport, extension: string): string {
  const base = (input.fileName ?? 'estimate').replace(/\.[^.]+$/, '')
  const unitSystem = input.settings.unitSystem
  const units = lengthUnitLabel(unitSystem)
  // The body's own formatter, not an integer round (19th dogfood): a
  // 9 × 5.5 × 8 in carton was filed as `-9x6x8in` while the CSV two lines in
  // printed 5.5. Integer cartons hid it for the whole loop; corrugated sizing
  // is rarely integer, and the name is what survives a folder six months on.
  // `decimal` trims trailing zeros, so 12 stays `12` and 5.5 stays `5.5`; the
  // sanitizer below keeps the dot.
  const carton = input.request.carton.map((mm) => lengthText(mm, unitSystem)).join('x')
  const safe = `${base}-${carton}${units}`
    // Windows forbids \ / : * ? " < > | ; the rest is house style so the name
    // survives a shell, a URL and an email attachment without quoting.
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    // A separator that survived sanitizing next to one that was created by it
    // would double up: `rev "b"` + `-12x12x12` ends `b--12x12x12`.
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${safe || 'estimate'}.${extension}`
}
