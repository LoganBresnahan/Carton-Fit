import { lengthUnitLabel, mmToLength } from '../core/units'
import { openMeshParts } from '../packing/request'
import { openMeshWarning, truncatedLayoutNote } from '../packing/verdict'
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
  const warnings = [
    openMeshWarning(openMeshParts(parts, settings, unitPartName)),
    truncatedLayoutNote(packResult)
  ].filter((warning): warning is string => warning !== null)

  return {
    fileName: file?.name ?? null,
    request: packRequest,
    result: packResult,
    settings,
    warnings
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
  const carton = input.request.carton
    .map((mm) => Math.round(mmToLength(mm, unitSystem)))
    .join('x')
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
