import { describe, expect, it } from 'vitest'
import { panelWidthFromStored, useAppStore } from '../src/renderer/src/store'
import {
  DEFAULT_PANEL_WIDTH,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH
} from '../src/renderer/src/layout/panel-width'

const WIDE = 2560

describe('panelWidthFromStored', () => {
  it('reads a stored width back', () => {
    expect(panelWidthFromStored(JSON.stringify({ panelWidth: 480 }), WIDE)).toBe(480)
  })

  it('is the default with nothing stored', () => {
    expect(panelWidthFromStored(null, WIDE)).toBe(DEFAULT_PANEL_WIDTH)
  })

  it('is the default for corrupt JSON', () => {
    expect(panelWidthFromStored('{"panelWidth":', WIDE)).toBe(DEFAULT_PANEL_WIDTH)
    expect(panelWidthFromStored('not json at all', WIDE)).toBe(DEFAULT_PANEL_WIDTH)
  })

  it('is the default when the field is missing or the wrong type', () => {
    expect(panelWidthFromStored('{}', WIDE)).toBe(DEFAULT_PANEL_WIDTH)
    expect(panelWidthFromStored(JSON.stringify({ panelWidth: '480' }), WIDE)).toBe(
      DEFAULT_PANEL_WIDTH
    )
    expect(panelWidthFromStored(JSON.stringify({ panelWidth: null }), WIDE)).toBe(
      DEFAULT_PANEL_WIDTH
    )
  })

  it('ignores anything else in the blob', () => {
    // A future layout preference must not disturb this one (ADR-0026 revisit).
    expect(panelWidthFromStored(JSON.stringify({ panelWidth: 300, splitPct: 40 }), WIDE)).toBe(300)
  })

  it('clamps a value stored on a wider monitor, before the first frame', () => {
    // 620 was fine where it was saved; on a 1000px window half is 500.
    expect(panelWidthFromStored(JSON.stringify({ panelWidth: 620 }), 1000)).toBe(500)
    expect(panelWidthFromStored(JSON.stringify({ panelWidth: 100 }), WIDE)).toBe(MIN_PANEL_WIDTH)
    expect(panelWidthFromStored(JSON.stringify({ panelWidth: 9000 }), WIDE)).toBe(MAX_PANEL_WIDTH)
  })
})

describe('panel width store slice', () => {
  it('defaults to 360 with no storage available', () => {
    expect(useAppStore.getState().panelWidth).toBe(DEFAULT_PANEL_WIDTH)
  })

  it('setPanelWidth writes the slice', () => {
    useAppStore.getState().setPanelWidth(500)
    expect(useAppStore.getState().panelWidth).toBe(500)
    useAppStore.getState().setPanelWidth(DEFAULT_PANEL_WIDTH)
  })

  it('stays out of settings, so presets and estimates cannot carry it', () => {
    // ADR-0026 §6: the whole reason for a separate key.
    expect('panelWidth' in useAppStore.getState().settings).toBe(false)
  })
})
