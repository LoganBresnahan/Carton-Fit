import { lengthUnitLabel } from '../core/units'
import {
  bindingLabel,
  freeSpaceNote,
  packedWeightG,
  upperBoundLabel,
  utilizationPercent,
  verdictCaption,
  verdictHeadline
} from '../packing/verdict'
import { dimsText, lengthText, modeLabel, tierLabel, weightText } from './format'
import { measurementRows, type EstimateExport } from './types'

// The copy-summary text (ADR-0017 §1) — the paste-into-a-quote artifact.
//
// Every phrase that also appears on screen is taken from `packing/verdict.ts`
// rather than rewritten: if the panel says "space-limited", the email says
// "space-limited". A second vocabulary for the same facts is how a summary
// starts quietly disagreeing with the app it came from.
//
// Ordered by what a reader needs first: what was measured, what the answer is,
// then the inputs that produced it — so the top of the paste is useful even
// when the rest is skimmed.

/** Beyond this the part list stops being a summary; the CSV exists for the rest. */
const PARTS_SHOWN = 12

/** How the carton was entered, when that differs from what was packed. Outer
 *  dims plus a wall are the user's vocabulary; inner is the physical truth the
 *  engine used (ADR-0004), and an export that showed only one of them would
 *  either misquote the box bought or misstate the space packed. */
function cartonLines(input: EstimateExport): string[] {
  const { settings, request } = input
  const units = settings.unitSystem
  const unit = lengthUnitLabel(units)
  const lines = [`Carton (inner): ${dimsText(request.carton, units)} ${unit}`]
  if (settings.enterOuter) {
    lines.push(
      `  entered as outer ${dimsText(settings.boxDimsMm, units)} ${unit} ` +
        `with ${lengthText(settings.wallMm, units)} ${unit} walls`
    )
  }
  return lines
}

function weightLines(input: EstimateExport): string[] {
  const { settings, request, result } = input
  // Packed-vs-cap shows in the cap's unit; per-part figures in the per-part
  // unit — the same split the panel makes (ADR-0024, ADR-0017 parity).
  const unit = settings.maxWeightUnit
  const packed = weightText(packedWeightG(result, request), unit)
  const cap = Number.isFinite(request.maxWeightG) ? weightText(request.maxWeightG, unit) : '∞'
  const source =
    settings.weightMode === 'direct'
      ? `${weightText(settings.partWeightG, settings.partWeightUnit)} ` +
        `${settings.partWeightUnit} per part, entered directly`
      : `density ${settings.densityGPerCm3} g/cm³ × part volume`

  // Naming the source alone would misdescribe a mixed assembly (ADR-0018): the
  // per-part figures below come from entered weights for some kinds, so a flat
  // "density × volume" claim is contradicted by the table under it.
  const overridden = Object.keys(input.overrides).length
  const qualifier =
    overridden > 0
      ? ` — ${overridden} kind${overridden === 1 ? '' : 's'} overridden individually`
      : ''
  return [`Packed weight: ${packed} of ${cap} ${unit}`, `Part weight: ${source}${qualifier}`]
}

function partLines(input: EstimateExport): string[] {
  const units = input.settings.unitSystem
  const weightUnit = input.settings.partWeightUnit
  const rows = measurementRows(input.request, input.result)
  if (rows.length === 0) return []

  const lines = ['', 'Parts:']
  for (const row of rows.slice(0, PARTS_SHOWN)) {
    lines.push(
      `  ${row.name} — ${row.quantity.toLocaleString()} × ` +
        `(${dimsText(row.extentMm, units)} ${lengthUnitLabel(units)}), ` +
        `${weightText(row.unitWeightG, weightUnit)} ${weightUnit} each`
    )
  }
  const rest = rows.length - PARTS_SHOWN
  if (rest > 0) {
    lines.push(`  …and ${rest} more — export the CSV for the full table.`)
  }
  return lines
}

/**
 * The estimate as a block of text.
 *
 * Warnings go LAST and unmissably, not because they matter least but because
 * this is a document someone scrolls to the end of before sending. They are
 * never omitted: ADR-0017 §2 makes an answer that is qualified on screen stay
 * qualified once it leaves the app, which is the moment it can no longer
 * defend itself.
 */
export function buildSummary(input: EstimateExport): string {
  const { settings, request, result, fileName } = input
  const units = settings.unitSystem

  // The bound rides on the Result line, exactly as it does on screen — a cap the
  // reader can quote is worth as much in an email as in the window (ADR-0022 §7,
  // ADR-0017 parity).
  const bound = upperBoundLabel(result)

  const lines: string[] = [
    'Carton Fit — estimate',
    `File: ${fileName ?? '(no file)'}`,
    `Mode: ${modeLabel(request.mode)} · ${tierLabel(request.tier)} quality`,
    '',
    `Result: ${verdictHeadline(result)}${result.mode === 'max-quantity' ? ' fit' : ''}` +
      `${bound ? ` (${bound})` : ''}`,
    verdictCaption(result),
    `Limited by: ${bindingLabel(result.binding)}`,
    `Fill: ${utilizationPercent(result.utilization)}`,
    '',
    ...cartonLines(input),
    `Clearances: ${lengthText(request.clearances.betweenParts, units)} ` +
      `${lengthUnitLabel(units)} between parts, ` +
      `${lengthText(request.clearances.wall, units)} ${lengthUnitLabel(units)} to wall`,
    ...weightLines(input),
    ...partLines(input)
  ]

  if (result.mode === 'fit-check' && result.unplaced.length > 0) {
    lines.push('', `Did not fit: ${result.unplaced.join(', ')}`)
    // Same sentence as the panel, in the same units — the free space is the one
    // fact that turns "did not fit" into a next carton size to try.
    const freeSpace = freeSpaceNote(result, units)
    if (freeSpace) lines.push(freeSpace)
  }

  for (const warning of input.warnings) lines.push('', `! ${warning}`)

  return lines.join('\n')
}
