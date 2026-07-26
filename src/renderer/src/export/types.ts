import { computeAabb, aabbSize } from '../core/geometry'
import type { PackRequest, PackResult, Vec3 } from '../core/packing/types'
import type { PackingSettings } from '../store'

// What an export is made of (ADR-0017).
//
// EXPORT IS PRESENTATION OF THE LIVE ESTIMATE, so its input is the same
// request/result pair the results panel and the packed 3D view read — not the
// database, and not the settings alone. The request is what the engine actually
// answered; taking the carton from live settings instead would let an export
// disagree with the placements it describes during the debounce window, exactly
// the bug ADR-0003 paired them to prevent.
//
// Pure derivation, no DOM and no store reads, so both builders unit-test in
// Node like the rest of the logic.

export interface EstimateExport {
  /** The imported file, or null if somehow absent — never invented. */
  fileName: string | null
  request: PackRequest
  result: PackResult
  settings: PackingSettings
  /**
   * Qualifiers, already worded by `packing/verdict.ts`.
   *
   * Passed in rather than derived here because the panel and the export must
   * say the SAME thing (ADR-0017 §2): an answer that is qualified on screen
   * stays qualified in a quote, in the same words. The caller reads them from
   * the one place that owns the wording.
   */
  warnings: readonly string[]
}

/** One part's measurements, in canonical units — formatting happens per format. */
export interface MeasurementRow {
  name: string
  /** How many of this part the estimate places. Zero for a part that did not fit. */
  quantity: number
  /** The part's own bounding box as modeled (mm), not its placed rotation:
   *  these are measurements OF THE PART, and a rotated extent would change
   *  meaning with the engine's orientation choice. */
  extentMm: Vec3
  /** Bounding-box volume (mm³) — what packing actually consumes, and the same
   *  basis the fill percentage uses. Deliberately not mesh volume: that is
   *  unreliable on an open mesh (ADR-0015), and a column of numbers cannot
   *  carry a caveat the way a sentence can. */
  boxVolumeMm3: number
  unitWeightG: number
  totalWeightG: number
}

/**
 * Per-part measurements for the estimate.
 *
 * Quantity differs by mode, and the difference is the whole reason this is
 * derived rather than read off the result: fit-check packs the file as it is,
 * so a part's quantity is how many placements carry its name — zero when it did
 * not fit, and such a part still gets a row, because "what didn't fit and how
 * big was it" is exactly what someone re-quotes a carton from. Max-quantity
 * replicates ONE unit N times (ADR-0003), so every part in that unit appears N
 * times, and `count` — not the materialized placements, which the engine caps —
 * is the truth.
 */
export function measurementRows(request: PackRequest, result: PackResult): MeasurementRow[] {
  const placedByName = new Map<string, number>()
  if (result.mode === 'fit-check') {
    for (const placement of result.placements) {
      placedByName.set(placement.partName, (placedByName.get(placement.partName) ?? 0) + 1)
    }
  }

  return request.parts.map((part) => {
    const extentMm = aabbSize(computeAabb(part.positions)) as Vec3
    const quantity =
      result.mode === 'max-quantity' ? result.count : (placedByName.get(part.name) ?? 0)
    return {
      name: part.name,
      quantity,
      extentMm,
      boxVolumeMm3: extentMm[0] * extentMm[1] * extentMm[2],
      unitWeightG: part.weightG,
      totalWeightG: part.weightG * quantity
    }
  })
}
