import { describe, expect, it } from 'vitest'
import { buildSummary } from '../src/renderer/src/export/summary'
import { buildCsv, csvCell } from '../src/renderer/src/export/csv'
import { measurementRows, type EstimateExport } from '../src/renderer/src/export/types'
import { decimal } from '../src/renderer/src/export/format'
import { suggestedFileName } from '../src/renderer/src/export/collect'
import type {
  FitCheckResult,
  MaxQuantityResult,
  PackRequest,
  Placement
} from '../src/renderer/src/core/packing/types'
import type { PackingSettings } from '../src/renderer/src/store'
import { inToMm, lbToG } from '../src/renderer/src/core/units'

// Export builders (ADR-0017). Pure text derivation, so everything here is
// checked against numbers computed by hand rather than against whatever the
// builder happened to emit.
//
// The failure modes these exist for:
//   - a locale-grouped number splitting a CSV row into extra columns;
//   - a CAD part name containing a comma doing the same;
//   - quantity read off the materialized placements in max-quantity, where the
//     engine caps them and `count` is the truth;
//   - and the one ADR-0017 §2 calls non-negotiable: a warning shown on screen
//     silently missing from the file that leaves the app.

/** A 1×2×4 in box mesh (opposite corners are enough for an AABB). */
function positions(l = 1, w = 2, h = 4): Float32Array {
  return new Float32Array([0, 0, 0, inToMm(l), inToMm(w), inToMm(h)])
}

function settings(patch: Partial<PackingSettings> = {}): PackingSettings {
  return {
    mode: 'fit-check',
    tier: 'fast',
    unitSystem: 'imperial',
    maxWeightUnit: 'lb',
    partWeightUnit: 'lb',
    boxDimsMm: [inToMm(12), inToMm(12), inToMm(12)],
    enterOuter: false,
    wallMm: 0,
    clearancePartMm: 0,
    clearanceWallMm: 0,
    maxWeightG: lbToG(35),
    weightMode: 'direct',
    partWeightG: lbToG(2),
    densityGPerCm3: 1,
    ...patch
  }
}

function request(patch: Partial<PackRequest> = {}): PackRequest {
  return {
    mode: 'fit-check',
    tier: 'fast',
    carton: [inToMm(12), inToMm(12), inToMm(12)],
    clearances: { betweenParts: 0, wall: 0 },
    maxWeightG: lbToG(35),
    parts: [{ name: 'bracket', positions: positions(), weightG: lbToG(2) }],
    ...patch
  }
}

function placement(partName: string): Placement {
  return {
    partName,
    rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    translation: [0, 0, 0],
    boxMin: [0, 0, 0],
    boxMax: [1, 1, 1]
  }
}

function fitResult(patch: Partial<FitCheckResult> = {}): FitCheckResult {
  return {
    mode: 'fit-check',
    tier: 'fast',
    fits: true,
    unplaced: [],
    placements: [placement('bracket')],
    binding: 'geometry',
    heuristic: true,
    utilization: 0.25,
    ...patch
  }
}

function qtyResult(patch: Partial<MaxQuantityResult> = {}): MaxQuantityResult {
  return {
    mode: 'max-quantity',
    tier: 'fast',
    count: 27000,
    placements: [],
    binding: 'geometry',
    heuristic: true,
    utilization: 0.9,
    ...patch
  }
}

function input(patch: Partial<EstimateExport> = {}): EstimateExport {
  return {
    fileName: 'bracket.stp',
    request: request(),
    result: fitResult(),
    settings: settings(),
    warnings: [],
    overrides: {},
    ...patch
  }
}

describe('decimal', () => {
  it('never groups digits — a separator is a column break in a CSV', () => {
    expect(decimal(27000)).toBe('27000')
    expect(decimal(1234567.5)).toBe('1234567.5')
  })

  it('trims trailing zeros but keeps real precision', () => {
    expect(decimal(12)).toBe('12')
    expect(decimal(11.75)).toBe('11.75')
    expect(decimal(0.125)).toBe('0.125')
  })

  it('returns empty for a non-finite value rather than "NaN" or "Infinity"', () => {
    expect(decimal(Number.NaN)).toBe('')
    expect(decimal(Number.POSITIVE_INFINITY)).toBe('')
  })
})

describe('measurementRows', () => {
  it('measures the part as modeled, in canonical mm', () => {
    const [row] = measurementRows(request(), fitResult())
    // Positions are Float32Array (the worker's transferable format), so these
    // agree to f32 precision, not to the double the conversion computes.
    expect(row.extentMm[0]).toBeCloseTo(inToMm(1), 4)
    expect(row.extentMm[1]).toBeCloseTo(inToMm(2), 4)
    expect(row.extentMm[2]).toBeCloseTo(inToMm(4), 4)
    // 1 × 2 × 4 in = 8 in³, expressed in mm³.
    expect(row.boxVolumeMm3).toBeCloseTo(inToMm(1) * inToMm(2) * inToMm(4), 1)
  })

  it('counts placements per part in fit-check, and gives an unplaced part a row', () => {
    const req = request({
      parts: [
        { name: 'bolt', positions: positions(), weightG: 10 },
        { name: 'nut', positions: positions(), weightG: 5 }
      ]
    })
    const rows = measurementRows(
      req,
      fitResult({
        fits: false,
        placements: [placement('bolt'), placement('bolt')],
        unplaced: ['nut']
      })
    )
    expect(rows.map((r) => [r.name, r.quantity])).toEqual([
      ['bolt', 2],
      ['nut', 0]
    ])
    // A part that did not fit still carries its measurements — "how big was the
    // thing that didn't fit" is the question a re-quote starts from.
    expect(rows[1].extentMm[2]).toBeCloseTo(inToMm(4), 4)
    expect(rows[1].totalWeightG).toBe(0)
  })

  it('uses count, not materialized placements, for max-quantity', () => {
    // The engine caps placements (MAX_GRID_PLACEMENTS) while `count` stays
    // exact; summing placements here would under-report by orders of magnitude.
    const rows = measurementRows(request(), qtyResult({ count: 27000, placements: [] }))
    expect(rows[0].quantity).toBe(27000)
    expect(rows[0].totalWeightG).toBeCloseTo(lbToG(2) * 27000, 6)
  })
})

describe('csvCell', () => {
  it('quotes and escapes a part name containing a comma or quote', () => {
    // Unescaped, this shifts every later column by one for that row alone —
    // corruption that looks like data.
    expect(csvCell('bracket, left')).toBe('"bracket, left"')
    expect(csvCell('12" pipe')).toBe('"12"" pipe"')
    expect(csvCell('plain')).toBe('plain')
  })
})

describe('buildCsv', () => {
  it('names the units in every measurement header', () => {
    const header = buildCsv(input()).split('\n')[0]
    expect(header).toBe(
      'Part,Quantity,Length (in),Width (in),Height (in),Box volume (in³),Unit weight (lb),Total weight (lb)'
    )
  })

  it('writes hand-checkable numbers in the display units', () => {
    const row = buildCsv(input()).split('\n')[1]
    // 1 × 2 × 4 in, 8 in³, 2 lb each, one placed.
    expect(row).toBe('bracket,1,1,2,4,8,2,2')
  })

  it('lengths follow the unit system; weights follow their own units (ADR-0024)', () => {
    const lines = buildCsv(
      input({
        settings: settings({ unitSystem: 'metric', partWeightUnit: 'kg', maxWeightUnit: 'g' })
      })
    ).split('\n')
    expect(lines[0]).toContain('Length (mm)')
    expect(lines[0]).toContain('Unit weight (kg)')
    // 1 in = 25.4 mm; 2 lb = 0.907 kg.
    expect(lines[1]).toBe('bracket,1,25.4,50.8,101.6,131096.51,0.907,0.907')
    // The estimate-level rows spend against the cap, so they carry ITS unit.
    expect(lines.join('\n')).toContain('Packed weight (g)')
  })

  it('keeps every data row the same width as the header', () => {
    const req = request({
      parts: [
        { name: 'bracket, left', positions: positions(), weightG: 10 },
        { name: 'nut', positions: positions(), weightG: 5 }
      ]
    })
    const lines = buildCsv(input({ request: req })).split('\n')
    const header = lines[0].split(',').length
    // Row 0 is the header; rows 1..2 are parts. The tail after the blank line
    // is deliberately two-column and not checked here.
    for (const line of lines.slice(1, 3)) {
      expect(splitCsv(line)).toHaveLength(header)
    }
  })

  it('carries the estimate itself after the table, so the numbers keep their question', () => {
    const csv = buildCsv(input())
    expect(csv).toContain('\n\nField,Value\n')
    expect(csv).toContain('Result,Fits')
    // 'geometry' is the internal token; the UI — and so the export — says
    // "space", because that is what a reader understands as the opposite of
    // weight-limited.
    expect(csv).toContain('Limited by,space')
    expect(csv).toContain('Mode,Fit check')
    expect(csv).toContain('Carton inner (in),12 × 12 × 12')
  })

  it('writes the count as a plain number, unlike the headline on screen', () => {
    // Caught by the e2e first: the Result cell went through verdictHeadline,
    // which groups digits — `Result,"27,000"` survives parsing only because it
    // is quoted, and still comes back from Number() as NaN. The count is the
    // one figure in this file someone computes with.
    const csv = buildCsv(input({ result: qtyResult({ count: 27000 }) }))
    expect(csv).toContain('Result,27000')
    expect(csv).not.toContain('27,000')
  })

  it('writes the bound as a plain number too — it sizes the next carton', () => {
    const csv = buildCsv(input({ result: qtyResult({ count: 27000, upperBound: 31500 }) }))
    expect(csv).toContain('Upper bound,31500')
    expect(csv).not.toContain('31,500')
  })

  it('restates the §7 explanation in Field,Value shape rather than as a sentence', () => {
    // The facts are the panel's — same gate, same descending triples, via
    // freeSpaceReport — but a CSV's wording is its field names, and a dimension
    // triple in its own cell is what every other measurement here looks like.
    const csv = buildCsv(
      input({
        result: fitResult({
          fits: false,
          placements: [],
          unplaced: ['bracket'],
          largestFreeSpace: [inToMm(2), inToMm(6), inToMm(4)],
          smallestUnplaced: { name: 'bracket', extentMm: [inToMm(1), inToMm(8), inToMm(3)] }
        })
      })
    )
    expect(csv).toContain('Largest free space (in),6 × 4 × 2')
    expect(csv).toContain('Smallest part left over,bracket')
    expect(csv).toContain('Its smallest orientation (in),8 × 3 × 1')
  })

  it('applies the same gate as the panel — no comparison the reader can refute', () => {
    const csv = buildCsv(
      input({
        result: fitResult({
          fits: false,
          placements: [],
          unplaced: ['bolt'],
          binding: 'weight',
          largestFreeSpace: [inToMm(10), inToMm(8), inToMm(4)],
          smallestUnplaced: { name: 'bolt', extentMm: [inToMm(0.5), inToMm(0.5), inToMm(0.25)] }
        })
      })
    )
    expect(csv).toContain('Largest free space (in),10 × 8 × 4')
    expect(csv).not.toContain('Smallest part left over')
  })

  it('names the kinds whose weight was corrected by hand (ADR-0018)', () => {
    const csv = buildCsv(input({ overrides: { bolt: 7, plate: 900 } }))
    expect(csv).toContain('Weight overrides,bolt; plate')
  })

  it('says nothing about overrides when there are none', () => {
    expect(buildCsv(input())).not.toContain('Weight overrides')
  })

  it('ends with a newline', () => {
    expect(buildCsv(input()).endsWith('\n')).toBe(true)
  })
})

describe('buildSummary', () => {
  it('leads with the file, the mode and the answer', () => {
    const text = buildSummary(input())
    expect(text).toContain('File: bracket.stp')
    expect(text).toContain('Mode: Fit check · Fast quality')
    expect(text).toContain('Result: Fits')
    expect(text).toContain('Limited by: space')
    expect(text).toContain('Fill: 25%')
  })

  it('reuses the panel’s own caption rather than inventing a second wording', () => {
    expect(buildSummary(input())).toContain('a concrete arrangement was found')
    expect(buildSummary(input({ result: qtyResult() }))).toContain(
      'Heuristic — a mixed arrangement may fit more.'
    )
  })

  it('states the carton as entered when that differs from what was packed', () => {
    const text = buildSummary(
      input({
        settings: settings({ enterOuter: true, wallMm: inToMm(0.25), boxDimsMm: [inToMm(12), inToMm(12), inToMm(12)] }),
        request: request({ carton: [inToMm(11.5), inToMm(11.5), inToMm(11.5)] })
      })
    )
    expect(text).toContain('Carton (inner): 11.5 × 11.5 × 11.5 in')
    expect(text).toContain('entered as outer 12 × 12 × 12 in with 0.25 in walls')
  })

  it('qualifies the weight source when kinds were overridden (ADR-0018)', () => {
    // "density × volume" alone would be contradicted by the table under it.
    const text = buildSummary(
      input({
        settings: settings({ weightMode: 'density', densityGPerCm3: 7.85 }),
        overrides: { bolt: 7 }
      })
    )
    expect(text).toContain('density 7.85 g/cm³ × part volume — 1 kind overridden individually')

    const two = buildSummary(input({ overrides: { bolt: 7, plate: 9 } }))
    expect(two).toContain('2 kinds overridden individually')
  })

  it('makes no such claim when nothing was overridden', () => {
    expect(buildSummary(input())).not.toContain('overridden')
  })

  it('names what did not fit', () => {
    const text = buildSummary(
      input({ result: fitResult({ fits: false, placements: [], unplaced: ['nut', 'washer'] }) })
    )
    expect(text).toContain('Did not fit: nut, washer')
  })

  it('carries the §7 free-space explanation under what did not fit', () => {
    const text = buildSummary(
      input({
        result: fitResult({
          fits: false,
          placements: [],
          unplaced: ['bracket'],
          largestFreeSpace: [inToMm(2), inToMm(6), inToMm(4)],
          smallestUnplaced: { name: 'bracket', extentMm: [inToMm(1), inToMm(8), inToMm(3)] }
        })
      })
    )
    // Same sentence as the panel, same units, same gate — ADR-0017 parity.
    expect(text).toContain(
      'Largest free space: 6 × 4 × 2 in — smallest orientation of “bracket” needs 8 × 3 × 1 in.'
    )
  })

  it('carries the quantity bound on the Result line', () => {
    const text = buildSummary(input({ result: qtyResult({ count: 47, upperBound: 54 }) }))
    expect(text).toContain('Result: 47 fit (upper bound 54)')
  })

  it('caps the part list and points at the CSV for the rest', () => {
    const parts = Array.from({ length: 20 }, (_, i) => ({
      name: `part-${i}`,
      positions: positions(),
      weightG: 1
    }))
    const text = buildSummary(input({ request: request({ parts }) }))
    expect(text).toContain('part-11')
    expect(text).not.toContain('part-12')
    expect(text).toContain('…and 8 more — export the CSV for the full table.')
  })
})

// ADR-0017 §2. The whole point of the decision: an answer that is qualified on
// screen stays qualified once it leaves the app, because that is the moment it
// can no longer defend itself.
describe('warnings travel with every export', () => {
  const warned = input({
    warnings: [
      '“shell” is not a closed mesh, so the volume behind this weight is unreliable.',
      'Showing 50,000 of 54,872 in the 3D view — the count is exact, the drawing is partial.'
    ]
  })

  it('appears in the text summary', () => {
    const text = buildSummary(warned)
    for (const warning of warned.warnings) expect(text).toContain(warning)
  })

  it('appears in the CSV, quoted so the commas inside it cannot break the row', () => {
    const csv = buildCsv(warned)
    for (const warning of warned.warnings) {
      expect(csv).toContain(`Warning,"${warning}"`)
    }
    // The truncation note contains "50,000" — proof the quoting is load-bearing
    // and not decorative.
    const warningLine = csv.split('\n').find((line) => line.startsWith('Warning,"Showing'))
    expect(warningLine).toBeDefined()
    expect(splitCsv(warningLine as string)).toHaveLength(2)
  })
})

describe('suggestedFileName', () => {
  it('says what the file is — part and carton, not estimate (3)', () => {
    expect(suggestedFileName(input(), 'csv')).toBe('bracket-12x12x12in.csv')
  })

  it('sanitizes characters that a filesystem, a shell or an email would fight', () => {
    const name = suggestedFileName(input({ fileName: 'as1/oc:214 rev "b".stp' }), 'png')
    expect(name).toBe('as1-oc-214-rev-b-12x12x12in.png')
    expect(name).not.toMatch(/[\\/:*?"<>|]/)
  })

  it('falls back rather than producing a nameless file', () => {
    expect(suggestedFileName(input({ fileName: null }), 'csv')).toBe('estimate-12x12x12in.csv')
  })
})

/** Minimal RFC-4180 split, so column-count assertions test the CSV as a parser
 *  sees it rather than as a naive `split(',')` does. */
function splitCsv(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      cells.push(cell)
      cell = ''
    } else cell += ch
  }
  cells.push(cell)
  return cells
}
