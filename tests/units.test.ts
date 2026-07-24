import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_WEIGHT_G,
  gToLb,
  gToWeight,
  inToMm,
  lbToG,
  lengthToMm,
  mmToIn,
  mmToLength,
  weightToG
} from '../src/renderer/src/core/units'

describe('length conversions', () => {
  it('converts inches to mm exactly', () => {
    expect(inToMm(1)).toBe(25.4)
    expect(inToMm(12)).toBeCloseTo(304.8, 10)
  })

  it('round-trips mm ⇄ in', () => {
    for (const mm of [0, 0.001, 1, 25.4, 1000, 12345.678]) {
      expect(inToMm(mmToIn(mm))).toBeCloseTo(mm, 9)
    }
  })

  it('metric passes through unchanged', () => {
    expect(lengthToMm(42, 'metric')).toBe(42)
    expect(mmToLength(42, 'metric')).toBe(42)
  })

  it('imperial converts at the boundary', () => {
    expect(lengthToMm(2, 'imperial')).toBeCloseTo(50.8, 10)
    expect(mmToLength(50.8, 'imperial')).toBeCloseTo(2, 10)
  })
})

describe('weight conversions', () => {
  it('converts pounds to grams exactly', () => {
    expect(lbToG(1)).toBe(453.59237)
  })

  it('round-trips g ⇄ lb', () => {
    for (const g of [0, 1, 453.59237, 15875.7, 100000]) {
      expect(lbToG(gToLb(g))).toBeCloseTo(g, 8)
    }
  })

  it('kg is grams over 1000', () => {
    expect(weightToG(1.5, 'metric')).toBe(1500)
    expect(gToWeight(1500, 'metric')).toBe(1.5)
  })

  it('default max weight is 35 lb in grams', () => {
    expect(DEFAULT_MAX_WEIGHT_G).toBeCloseTo(15875.73295, 5)
    expect(gToLb(DEFAULT_MAX_WEIGHT_G)).toBeCloseTo(35, 10)
  })
})
