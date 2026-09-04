import { lengthUnitLabel, mmToLength, type UnitSystem } from '../core/units'
import type { EstimateRow } from '../../../shared/storage'

// One-line descriptions of a SAVED estimate (ADR-0016).
//
// Deliberately separate from packing/verdict.ts, which describes the LIVE
// result and may assume the current `PackResult` shape. A saved row holds JSON
// written by whatever build was running at the time: fields may be missing,
// renamed, or of the wrong type, and a list of receipts must not be the thing
// that throws because a two-versions-old row lacks a field. Every read here is
// defensive on purpose, and anything unreadable degrades to a shorter sentence
// rather than an exception.

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/** The carton as it was typed, in the units it was typed in. */
function cartonPhrase(settings: Record<string, unknown> | null): string | null {
  if (!settings) return null
  const dims = settings.boxDimsMm
  if (!Array.isArray(dims) || dims.length !== 3) return null
  const mm = dims.map(num)
  if (mm.some((v) => v === null)) return null

  const units: UnitSystem = settings.unitSystem === 'metric' ? 'metric' : 'imperial'
  const shown = (mm as number[]).map((v) => {
    const converted = mmToLength(v, units)
    // Trailing-zero-free: 12 not 12.00, but 11.75 kept.
    return String(Math.round(converted * 100) / 100)
  })
  return `${shown.join('×')} ${lengthUnitLabel(units)}`
}

/** The answer itself, in the vocabulary the results panel used at the time. */
function answerPhrase(result: Record<string, unknown> | null): string | null {
  if (!result) return null
  if (result.mode === 'max-quantity') {
    const count = num(result.count)
    return count === null ? null : `${count.toLocaleString()} fit`
  }
  if (result.mode === 'fit-check') {
    if (typeof result.fits !== 'boolean') return null
    return result.fits ? 'Fits' : "Doesn't fit"
  }
  return null
}

/**
 * A saved estimate in one line: what the answer was, in what carton, and what
 * bound it — the three things that make a receipt worth keeping.
 */
export function estimateSummary(row: EstimateRow): string {
  const result = record(row.result)
  const settings = record(row.settings)

  const parts: string[] = []
  const answer = answerPhrase(result)
  if (answer) parts.push(answer)
  // What was counted. Three receipts read "3 fit · 11×6×10 in" and were saved
  // under three different unit parts (2026-09-04) — a row that cannot say what
  // it counted cannot be picked from a list. Rows from before that date carry
  // no key and stay as they were.
  if (result?.mode === 'max-quantity' && typeof settings?.unitPartName === 'string') {
    parts.push(`of ${settings.unitPartName}`)
  }

  const carton = cartonPhrase(settings)
  if (carton) parts.push(carton)

  const binding = result?.binding
  if (binding === 'weight' || binding === 'space') parts.push(`${binding}-limited`)

  // A row we cannot read at all still deserves a row in the list — it is the
  // user's data, and silently hiding it would be worse than saying so.
  return parts.length > 0 ? parts.join(' · ') : 'Saved estimate'
}

/**
 * When it was saved, at the resolution that is actually useful: a time today,
 * a date otherwise. `now` is injectable so the test is not clock-dependent.
 */
export function formatSavedAt(epochMs: number, now: number = Date.now()): string {
  if (!Number.isFinite(epochMs)) return ''
  const then = new Date(epochMs)
  const today = new Date(now)
  const sameDay =
    then.getFullYear() === today.getFullYear() &&
    then.getMonth() === today.getMonth() &&
    then.getDate() === today.getDate()

  return sameDay
    ? then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
