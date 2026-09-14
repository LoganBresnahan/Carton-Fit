import { lengthUnitLabel, mmToLength, type UnitSystem } from '../core/units'
import { bothLimitsProven } from './verdict'
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
 * What bound the answer — or nothing, when nothing did.
 *
 * THREE DEFECTS LIVED IN THE ONE LINE THIS REPLACES (7th dogfood, 2026-09-04),
 * and they are worth naming separately because only one was reported:
 *
 *  1. It compared `binding === 'space'`. `BindingConstraint` is
 *     `'geometry' | 'weight'` — 'space' is the DISPLAY word `bindingLabel`
 *     produces, never a stored value — so the comparison was dead on one side
 *     and every geometry-bound receipt went out unlabelled.
 *  2. On the weight side it named the winner and dropped the tie. A count whose
 *     `geometryBound` MEETS it is full over every arrangement, so "3 fit ·
 *     weight-limited" invites "a lighter alloy buys more per carton" — which
 *     buys nothing, and the field disproving it was thrown away one layer up.
 *  3. It appended a limit to a fit-check that FIT. `binding` names the closest
 *     limit even when nothing bound (ADR-0029 amendment 1), so "everything fit"
 *     was being written down as "weight-limited".
 *
 * Defensive like everything else here: a receipt is JSON from whatever build
 * saved it. A row with no `geometryBound` cannot prove a tie, so it keeps the
 * single word rather than gaining a claim its own data does not carry.
 */
function bindingPhrase(result: Record<string, unknown> | null): string | null {
  if (!result) return null
  const binding = result.binding
  if (binding !== 'weight' && binding !== 'geometry') return null
  // Nothing STOPPED a fit-check that fits, whatever the closest limit was.
  if (result.mode === 'fit-check' && result.fits === true) return null
  // The same predicate the caption and the binding note read (19th dogfood):
  // this row derived the tie on its own for a month while the caption did not.
  // "both limits" and not a fuller sentence: the row is scanned, and the note
  // it opens onto already says "Both limits land on 3" in the same words.
  if (bothLimitsProven(binding, num(result.count), num(result.geometryBound))) return 'both limits'
  return binding === 'weight' ? 'weight-limited' : 'space-limited'
}

/**
 * Weights typed by hand (ADR-0018 §3), which the row carries and the line did
 * not read (11th dogfood, 2026-09-08): "2 fit · of plate · weight-limited" was
 * 2 only because the plate was 12 lb by hand, and read identically to the
 * density's 3. Names the kind when there is one, counts them otherwise.
 */
function overridePhrase(settings: Record<string, unknown> | null): string | null {
  const overrides = record(settings?.partWeightsG)
  if (!overrides) return null
  const kinds = Object.keys(overrides).filter((kind) => num(overrides[kind]) !== null)
  if (kinds.length === 0) return null
  return kinds.length === 1 ? `${kinds[0]} weighed by hand` : `${kinds.length} kinds weighed by hand`
}

/**
 * A saved estimate in one line: what the answer was, in what carton, what
 * bound it, and whether a weight was typed by hand — the things that make a
 * receipt worth keeping and tell two receipts apart.
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

  const limit = bindingPhrase(result)
  if (limit) parts.push(limit)

  const byHand = overridePhrase(settings)
  if (byHand) parts.push(byHand)

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
