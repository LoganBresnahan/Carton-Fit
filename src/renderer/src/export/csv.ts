import { lengthUnitLabel, volumeUnitLabel, weightUnitLabel } from '../core/units'
import { bindingLabel, packedWeightG, utilizationPercent, verdictHeadline } from '../packing/verdict'
import { decimal, dimsText, lengthText, modeLabel, tierLabel, volumeText, weightText } from './format'
import { measurementRows, type EstimateExport } from './types'

// The measurements CSV (ADR-0017 §1) — the table a spreadsheet ingests.
//
// SHAPE: one row per part, then a blank line, then a `Field,Value` block for
// the estimate-level facts and the warnings. Excel and every CSV parser worth
// the name read the ragged tail as extra two-column rows, so the table stays
// machine-clean while nothing is lost — and the warnings ADR-0017 §2 requires
// travel with the file instead of being dropped for tidiness. Putting them in a
// per-row column was the alternative and it is worse: a caveat about the whole
// estimate repeated on every line reads as a property of the part.
//
// Units are named in the headers, never assumed. A column called "Length" with
// no unit is how a 10 in carton gets quoted as 10 mm.

/**
 * One CSV cell, quoted only when it must be.
 *
 * Quoting is not decoration here: part names come from CAD files and routinely
 * contain commas, and a name like `bracket, left` unescaped shifts every column
 * after it by one for that row alone — a corruption that looks like data.
 */
export function csvCell(value: string | number): string {
  const text = String(value)
  if (!/[",\r\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

const row = (cells: readonly (string | number)[]): string => cells.map(csvCell).join(',')

/**
 * The answer as a CELL, which is not the same as the answer as a headline.
 *
 * `verdictHeadline` groups digits — right in prose, wrong in a spreadsheet:
 * `27,000` needs quoting to survive at all, and comes back from `Number()` as
 * NaN even then. The count is the one number in this file someone will actually
 * compute with, so it stays plain.
 */
function resultCell(result: EstimateExport['result']): string {
  return result.mode === 'max-quantity' ? decimal(result.count, 0) : verdictHeadline(result)
}

export function buildCsv(input: EstimateExport): string {
  const { settings, request, result, fileName } = input
  const units = settings.unitSystem
  const length = lengthUnitLabel(units)
  const weight = weightUnitLabel(units)

  const lines: string[] = [
    row([
      'Part',
      'Quantity',
      `Length (${length})`,
      `Width (${length})`,
      `Height (${length})`,
      `Box volume (${volumeUnitLabel(units)})`,
      `Unit weight (${weight})`,
      `Total weight (${weight})`
    ])
  ]

  for (const measurement of measurementRows(request, result)) {
    lines.push(
      row([
        measurement.name,
        measurement.quantity,
        lengthText(measurement.extentMm[0], units),
        lengthText(measurement.extentMm[1], units),
        lengthText(measurement.extentMm[2], units),
        volumeText(measurement.boxVolumeMm3, units),
        weightText(measurement.unitWeightG, units),
        weightText(measurement.totalWeightG, units)
      ])
    )
  }

  // The estimate itself, so the table is not a set of numbers with no question
  // attached — a CSV outlives the window it was exported from.
  lines.push('', row(['Field', 'Value']))
  lines.push(row(['File', fileName ?? '']))
  lines.push(row(['Mode', modeLabel(request.mode)]))
  lines.push(row(['Quality', tierLabel(request.tier)]))
  lines.push(row(['Result', resultCell(result)]))
  lines.push(row(['Limited by', bindingLabel(result.binding)]))
  lines.push(row(['Fill', utilizationPercent(result.utilization)]))
  lines.push(row([`Carton inner (${length})`, dimsText(request.carton, units)]))
  lines.push(
    row([`Clearance between parts (${length})`, lengthText(request.clearances.betweenParts, units)])
  )
  lines.push(row([`Clearance to wall (${length})`, lengthText(request.clearances.wall, units)]))
  lines.push(row([`Packed weight (${weight})`, weightText(packedWeightG(result, request), units)]))
  lines.push(
    row([
      `Max weight (${weight})`,
      Number.isFinite(request.maxWeightG) ? weightText(request.maxWeightG, units) : ''
    ])
  )
  if (result.mode === 'fit-check' && result.unplaced.length > 0) {
    lines.push(row(['Did not fit', result.unplaced.join('; ')]))
  }
  // Which kinds were corrected by hand (ADR-0018). The per-part columns above
  // already hold the resolved weights; this says where they came from, so the
  // table cannot be mistaken for one uniform source.
  const overridden = Object.keys(input.overrides)
  if (overridden.length > 0) {
    lines.push(row(['Weight overrides', overridden.join('; ')]))
  }

  for (const warning of input.warnings) lines.push(row(['Warning', warning]))

  // Trailing newline: POSIX text convention, and some parsers drop the last
  // line without it.
  return `${lines.join('\n')}\n`
}
