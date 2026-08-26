import { describe, expect, it } from 'vitest'
import {
  clampPanelWidth,
  DEFAULT_PANEL_WIDTH,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH
} from '../src/renderer/src/layout/panel-width'

// A window wide enough that only the absolute bounds bind.
const WIDE = 2560

describe('clampPanelWidth', () => {
  it('passes a width inside the bounds through untouched', () => {
    expect(clampPanelWidth(420, WIDE)).toBe(420)
    expect(clampPanelWidth(DEFAULT_PANEL_WIDTH, WIDE)).toBe(DEFAULT_PANEL_WIDTH)
  })

  it('holds the minimum against a narrower request', () => {
    expect(clampPanelWidth(120, WIDE)).toBe(MIN_PANEL_WIDTH)
    expect(clampPanelWidth(0, WIDE)).toBe(MIN_PANEL_WIDTH)
    expect(clampPanelWidth(-500, WIDE)).toBe(MIN_PANEL_WIDTH)
  })

  it('holds the absolute maximum on a wide window', () => {
    expect(clampPanelWidth(5000, WIDE)).toBe(MAX_PANEL_WIDTH)
  })

  it('takes half the window as the max when that is tighter than 640', () => {
    // 1000px window: half is 500, so 640 never applies.
    expect(clampPanelWidth(600, 1000)).toBe(500)
    expect(clampPanelWidth(400, 1000)).toBe(400)
  })

  it('lets the window win when half of it is under the minimum', () => {
    // 480px window: half is 240. The panel goes under its 280 minimum rather
    // than taking more than half the screen and leaving no viewport.
    expect(clampPanelWidth(DEFAULT_PANEL_WIDTH, 480)).toBe(240)
    expect(clampPanelWidth(300, 480)).toBe(240)
    // The minimum still applies, lowered to the ceiling: a narrower request is
    // raised to it, so the two bounds never cross.
    expect(clampPanelWidth(200, 480)).toBe(240)
  })

  it('reads a non-finite request as the default width', () => {
    // Infinity is corruption of the same class as NaN, not a request for the
    // widest allowed panel.
    expect(clampPanelWidth(NaN, WIDE)).toBe(DEFAULT_PANEL_WIDTH)
    expect(clampPanelWidth(Infinity, WIDE)).toBe(DEFAULT_PANEL_WIDTH)
  })

  it('falls back to the absolute max when the window width is unknown', () => {
    expect(clampPanelWidth(5000, NaN)).toBe(MAX_PANEL_WIDTH)
    expect(clampPanelWidth(400, NaN)).toBe(400)
  })
})
