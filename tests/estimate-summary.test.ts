import { describe, expect, it } from 'vitest'
import { estimateSummary, formatSavedAt } from '../src/renderer/src/packing/summary'
import type { EstimateRow } from '../src/shared/storage'

// One-line descriptions of SAVED estimates (ADR-0016). The rows hold JSON
// written by whatever build was running at the time, so the contract these
// tests pin is as much about surviving bad input as about wording: a list of
// receipts must never be the thing that throws because an old row lacks a field.

const row = (patch: Partial<EstimateRow> = {}): EstimateRow => ({
  id: 1,
  fileName: 'bracket.stp',
  contentHash: 'h',
  createdAt: 1_700_000_000_000,
  settings: { boxDimsMm: [304.8, 304.8, 304.8], unitSystem: 'imperial' },
  result: { mode: 'max-quantity', count: 500, binding: 'weight' },
  ...patch
})

describe('estimateSummary', () => {
  it('reads as the answer, the carton, and what bound it', () => {
    expect(estimateSummary(row())).toBe('500 fit · 12×12×12 in · weight-limited')
  })

  it('names the unit a count replicated, when the row recorded one', () => {
    // Three rows read "3 fit · 11×6×10 in" and were saved under three unit
    // parts (2026-09-04). A receipt that cannot say what it counted cannot be
    // picked from a list.
    expect(
      estimateSummary(
        row({ settings: { boxDimsMm: [304.8, 304.8, 304.8], unitSystem: 'imperial', unitPartName: 'plate' } })
      )
    ).toBe('500 fit · of plate · 12×12×12 in · weight-limited')
    // Rows from before the key existed, and whole-file counts, read as before.
    expect(estimateSummary(row())).toBe('500 fit · 12×12×12 in · weight-limited')
  })

  it('names a geometry-bound row, which read as nothing at all', () => {
    // 7th dogfood, and the half no reader could see. The line compared
    // `binding === 'space'` while `BindingConstraint` is 'geometry' | 'weight'
    // — 'space' is the DISPLAY word (verdict.ts) and never a stored value, so
    // every geometry-bound receipt fell through unlabelled. Visible in the
    // app's own sidebar the same day: bare "3 fit · 11×6×10 in" rows sitting
    // beside "weight-limited" ones, and nothing saying the bare ones were the
    // rows the CARTON stopped.
    expect(
      estimateSummary(row({ result: { mode: 'max-quantity', count: 3, binding: 'geometry' } }))
    ).toBe('3 fit · 12×12×12 in · space-limited')
  })

  it('says both limits when the carton and the cap land on the same count', () => {
    // The reader's finding: "3 fit · weight-limited" invites "so a lighter
    // alloy buys more per carton", and it buys nothing — `geometryBound` meets
    // the count, which proves the carton full over every arrangement. The
    // receipt is what gets skimmed, so it is where the tie has to survive.
    expect(
      estimateSummary(
        row({ result: { mode: 'max-quantity', count: 3, binding: 'weight', geometryBound: 3 } })
      )
    ).toBe('3 fit · 12×12×12 in · both limits')
    // A LOOSE bound is not a tie and must still name the cap alone.
    expect(
      estimateSummary(
        row({ result: { mode: 'max-quantity', count: 3, binding: 'weight', geometryBound: 5 } })
      )
    ).toBe('3 fit · 12×12×12 in · weight-limited')
    // Rows saved before `geometryBound` existed cannot prove a tie, so they
    // keep the single word rather than gaining a claim their JSON cannot back.
    expect(
      estimateSummary(row({ result: { mode: 'max-quantity', count: 3, binding: 'weight' } }))
    ).toBe('3 fit · 12×12×12 in · weight-limited')
  })

  it('claims no limit on a fit-check that fits', () => {
    // `binding` names the CLOSEST limit even when nothing bound (ADR-0029
    // amendment 1), so a successful fit-check carries one — and the receipt
    // was appending it, turning "everything fit" into "weight-limited". The
    // fixtures below hid it by omitting a field the engine always sets, which
    // is the second defect this file's fixtures have concealed that way.
    expect(
      estimateSummary(row({ result: { mode: 'fit-check', fits: true, binding: 'weight' } }))
    ).toBe('Fits · 12×12×12 in')
    // A fit-check that does NOT fit was bound by something, and says so.
    expect(
      estimateSummary(row({ result: { mode: 'fit-check', fits: false, binding: 'weight' } }))
    ).toBe("Doesn't fit · 12×12×12 in · weight-limited")
  })

  it('states a fit-check verdict in the panel’s own words', () => {
    expect(estimateSummary(row({ result: { mode: 'fit-check', fits: true } }))).toBe(
      'Fits · 12×12×12 in'
    )
    expect(estimateSummary(row({ result: { mode: 'fit-check', fits: false } }))).toContain(
      "Doesn't fit"
    )
  })

  it('shows the carton in the units it was entered in', () => {
    const metric = row({
      settings: { boxDimsMm: [300, 200, 100], unitSystem: 'metric' },
      result: { mode: 'fit-check', fits: true }
    })
    expect(estimateSummary(metric)).toBe('Fits · 300×200×100 mm')
  })

  it('does not print trailing zeros on whole inches, but keeps real fractions', () => {
    const odd = row({
      settings: { boxDimsMm: [298.45, 304.8, 304.8], unitSystem: 'imperial' },
      result: { mode: 'fit-check', fits: true }
    })
    expect(estimateSummary(odd)).toBe('Fits · 11.75×12×12 in')
  })

  it('groups a large count for readability', () => {
    expect(estimateSummary(row({ result: { mode: 'max-quantity', count: 27000 } }))).toContain(
      (27000).toLocaleString()
    )
  })

  // --- the defensive half: rows written by other builds --------------------

  it('drops the carton phrase rather than throwing when dims are missing', () => {
    expect(estimateSummary(row({ settings: {} }))).toBe('500 fit · weight-limited')
  })

  it('survives settings and result being the wrong type entirely', () => {
    expect(estimateSummary(row({ settings: 'nonsense', result: 42 }))).toBe('Saved estimate')
    expect(estimateSummary(row({ settings: null, result: null }))).toBe('Saved estimate')
  })

  it('ignores a mode it does not recognise', () => {
    // A future tier or mode must not make old clients throw.
    expect(estimateSummary(row({ result: { mode: 'nesting', count: 5 } }))).toBe('12×12×12 in')
  })

  it('ignores a malformed dimension list', () => {
    const bad = row({ settings: { boxDimsMm: [1, 2], unitSystem: 'imperial' } })
    expect(estimateSummary(bad)).toBe('500 fit · weight-limited')
    const nonNumeric = row({ settings: { boxDimsMm: [1, 'x', 3], unitSystem: 'imperial' } })
    expect(estimateSummary(nonNumeric)).toBe('500 fit · weight-limited')
  })

  it('never returns an empty string — a row the user saved always gets a line', () => {
    expect(estimateSummary(row({ settings: {}, result: {} }))).toBe('Saved estimate')
  })
})

describe('formatSavedAt', () => {
  const NOON = new Date(2026, 6, 25, 12, 0, 0).getTime()

  it('shows a time for something saved today', () => {
    const earlier = new Date(2026, 6, 25, 9, 30, 0).getTime()
    // Locale-dependent formatting, so assert the SHAPE, not a literal string.
    expect(formatSavedAt(earlier, NOON)).toMatch(/9[:.]30/)
  })

  it('shows a date for something saved on another day', () => {
    const lastWeek = new Date(2026, 6, 18, 9, 30, 0).getTime()
    const shown = formatSavedAt(lastWeek, NOON)
    expect(shown).toMatch(/18/)
    expect(shown).not.toMatch(/9[:.]30/)
  })

  it('returns an empty string for a nonsense timestamp instead of "Invalid Date"', () => {
    expect(formatSavedAt(Number.NaN, NOON)).toBe('')
  })
})
