import { afterEach, beforeEach, expect, describe, it } from 'vitest'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createCartonFitServer } from '../src/main/mcp/server'
import { resetOcctForTests } from '../src/main/occt/ingest'
import type { OcctWasmContext } from '../src/main/occt/wasmPath'
import type { EstimateReport } from '../src/main/mcp/estimate'
import type { InspectReport } from '../src/main/mcp/inspect'

// ADVERSARIAL VERIFY PASS: units on the wire (ADR-0029 slice
// `explicit-units-wire-contract`).
//
// WHY THIS SLICE EARNS A PASS OF ITS OWN. A missed conversion here does not
// throw, does not look wrong, and does not fail any other test: it returns a
// number of exactly the right magnitude for a different question. A human
// mis-typing millimetres for inches sees a sugar cube in the 3D view and fixes
// it in a second. An AI client receives `304.8` and has nothing to check it
// against — it will put the answer in a packing quote.
//
// So these tests are written to CATCH A CONVERSION, not to demonstrate one.
// The core technique is equivalence: ask the same physical question twice, in
// two unit systems, and demand the same answer. A missed conversion and a
// DOUBLED one both break equivalence, and the second is the one a "convert at
// the boundary" fix tends to introduce — a value converted by the caller's
// helper and again by the boundary's.

const REPO_ROOT = join(__dirname, '..')
const SAMPLES = join(REPO_ROOT, 'samples')
const CONTEXT: OcctWasmContext = { appPath: REPO_ROOT, isPackaged: false }
const CUBE = join(SAMPLES, 'cube-10x10.stp')

let client: Client
beforeEach(async () => {
  const server = createCartonFitServer({ occt: CONTEXT, version: '0.0.0-test' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'units', version: '1' })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
})
afterEach(async () => {
  await client.close()
  resetOcctForTests()
})

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args })
  const text =
    Array.isArray(result.content) && result.content[0]?.type === 'text'
      ? String(result.content[0].text)
      : ''
  expect(result.isError ?? false, `${name} failed: ${text}`).toBe(false)
  return result.structuredContent as T
}

function estimate(args: Record<string, unknown>): Promise<EstimateReport> {
  return call<EstimateReport>('estimate', {
    path: CUBE,
    mode: 'max-quantity',
    tier: 'fast',
    ...args
  })
}

const cartonIn = (x: number) => ({
  dimensions: { x, y: x, z: x, unit: 'in' as const },
  measured: 'inner' as const
})
const cartonMm = (x: number) => ({
  dimensions: { x, y: x, z: x, unit: 'mm' as const },
  measured: 'inner' as const
})

describe('the same question in two unit systems is the same question', () => {
  it('12 in and 304.8 mm give the same count', async () => {
    // 12 in = 304.8 mm exactly, and floor(304.8/10) = 30 per axis → 27,000.
    // A conversion applied once too often would ask about 7,741 mm or 0.47 in
    // and answer 456,533 or 0 — both plausible-looking numbers on their own.
    const imperial = await estimate({ carton: cartonIn(12) })
    const metric = await estimate({ carton: cartonMm(304.8) })
    expect(imperial.outcome).toEqual(metric.outcome)
    expect(imperial.outcome.mode === 'max-quantity' && imperial.outcome.count).toBe(27_000)
  })

  it('a weight cap in lb and the same cap in g bind identically', async () => {
    const args = { carton: cartonIn(12), weight: { partWeight: { value: 10, unit: 'g' as const } } }
    const inLb = await estimate({ ...args, maxWeight: { value: 1, unit: 'lb' } })
    const inG = await estimate({ ...args, maxWeight: { value: 453.59237, unit: 'g' } })
    expect(inLb.outcome).toEqual(inG.outcome)
    // 453.59237 g / 10 g = 45 parts, by hand — and the cap binds, not the box.
    expect(inLb.outcome.mode === 'max-quantity' && inLb.outcome.count).toBe(45)
    expect(inLb.binding.constraint).toBe('weight')
  })

  it('a kg cap agrees with the same cap in g', async () => {
    const args = { carton: cartonIn(12), weight: { partWeight: { value: 100, unit: 'g' as const } } }
    const inKg = await estimate({ ...args, maxWeight: { value: 2, unit: 'kg' } })
    const inG = await estimate({ ...args, maxWeight: { value: 2000, unit: 'g' } })
    expect(inKg.outcome).toEqual(inG.outcome)
    expect(inKg.outcome.mode === 'max-quantity' && inKg.outcome.count).toBe(20)
  })

  it('clearances convert independently of the carton they sit in', async () => {
    // The trap: a carton in mm and a clearance in inches. A boundary that
    // converts the clearance with the CARTON's unit would read 0.5 as 0.5 mm.
    // By hand: 100 mm carton, 12.7 mm gaps (0.5 in) between parts, 10 mm cube →
    // floor((100 + 12.7) / (10 + 12.7)) = floor(4.96) = 4 per axis → 64.
    const mixed = await estimate({
      carton: cartonMm(100),
      clearances: { betweenParts: { value: 0.5, unit: 'in' } }
    })
    const same = await estimate({
      carton: cartonMm(100),
      clearances: { betweenParts: { value: 12.7, unit: 'mm' } }
    })
    expect(mixed.outcome).toEqual(same.outcome)
    expect(mixed.outcome.mode === 'max-quantity' && mixed.outcome.count).toBe(64)
  })

  it('wall thickness converts on its own terms, not the carton’s', async () => {
    // Outer 12 in with a 25.4 mm (1 in) wall → inner 12 − 2 = 10 in = 254 mm,
    // floor(254/10) = 25 per axis → 15,625. Reading the wall as 25.4 IN would
    // leave a negative carton; reading it as 1 MM would leave 12 in − 2 mm and
    // answer 30³.
    const mixed = await estimate({
      carton: {
        dimensions: { x: 12, y: 12, z: 12, unit: 'in' },
        measured: 'outer',
        wallThickness: { value: 25.4, unit: 'mm' }
      }
    })
    expect(mixed.outcome.mode === 'max-quantity' && mixed.outcome.count).toBe(15_625)
    expect(mixed.request.innerCarton.x).toBeCloseTo(254, 6)
  })

  it('refuses outer dimensions with no wall thickness instead of guessing zero', async () => {
    const result = await client.callTool({
      name: 'estimate',
      arguments: {
        path: CUBE,
        mode: 'max-quantity',
        tier: 'fast',
        carton: { dimensions: { x: 12, y: 12, z: 12, unit: 'in' }, measured: 'outer' }
      }
    })
    expect(result.isError).toBe(true)
  })
})

describe('every echoed number carries its own unit', () => {
  it('answers in the units the caller asked for, length and weight separately', async () => {
    // ADR-0024's decoupling, exercised in the combination that a single
    // `units: 'imperial'` field could not express: inches and kilograms.
    const report = await estimate({
      carton: cartonIn(12),
      maxWeight: { value: 10, unit: 'lb' },
      weight: { partWeight: { value: 1, unit: 'g' } },
      outputUnits: { length: 'in', weight: 'kg' }
    })
    expect(report.units).toEqual({ length: 'in', weight: 'kg' })
    expect(report.request.innerCarton).toEqual({
      x: expect.closeTo(12, 9),
      y: expect.closeTo(12, 9),
      z: expect.closeTo(12, 9),
      unit: 'in'
    })
    expect(report.request.maxWeight.unit).toBe('kg')
    expect(report.request.maxWeight.value).toBeCloseTo(4.5359237, 6)
  })

  it('defaults to the app’s canonical units rather than guessing a locale', async () => {
    const report = await estimate({ carton: cartonMm(100) })
    expect(report.units).toEqual({ length: 'mm', weight: 'g' })
    expect(report.request.innerCarton.unit).toBe('mm')
    expect(report.request.innerCarton.x).toBeCloseTo(100, 9)
  })

  it('round-trips an inch carton back to the inches that were sent', async () => {
    // The doubled-conversion detector on the OUTPUT side: 12 in in, 12 in out.
    // A second conversion on the way back would echo 0.472 or 304.8.
    const report = await estimate({ carton: cartonIn(12), outputUnits: { length: 'in' } })
    expect(report.request.innerCarton.x).toBeCloseTo(12, 9)
  })

  it('clamped clearances are echoed as what was honored, with their unit', async () => {
    const report = await estimate({
      carton: cartonMm(100),
      clearances: { betweenParts: { value: -5, unit: 'mm' } }
    })
    expect(report.request.clearances.betweenParts).toEqual({ value: 0, unit: 'mm' })
  })

  it('echoes a NON-ZERO clearance in the caller’s units', async () => {
    // Deliberately not the clamped case above: zero survives any number of
    // conversions unchanged, so a test that only checks the clamp cannot see a
    // doubled conversion on the way out. Found by mutating `fromMm` to convert
    // twice and watching this file stay green.
    const report = await estimate({
      carton: cartonMm(200),
      clearances: { betweenParts: { value: 0.5, unit: 'in' }, wall: { value: 1, unit: 'in' } },
      outputUnits: { length: 'in' }
    })
    expect(report.request.clearances.betweenParts.value).toBeCloseTo(0.5, 9)
    expect(report.request.clearances.wall).toEqual({ value: expect.closeTo(1, 9), unit: 'in' })
  })

  it('echoes the same clearance in millimetres when asked in millimetres', async () => {
    const report = await estimate({
      carton: cartonMm(200),
      clearances: { betweenParts: { value: 0.5, unit: 'in' } }
    })
    expect(report.request.clearances.betweenParts).toEqual({
      value: expect.closeTo(12.7, 9),
      unit: 'mm'
    })
  })
})

describe('inspect_model measures in the caller’s units too', () => {
  it('reports the cube in inches, volume in cubic inches', async () => {
    // 10 mm = 0.3937 in; 1000 mm³ = 1000/25.4³ = 0.061024 in³. Cubing is where
    // a length-only conversion factor silently under-converts volume by 645×.
    const report = await call<InspectReport>('inspect_model', {
      path: CUBE,
      outputUnits: { length: 'in' }
    })
    expect(report.boundingBox.x).toBeCloseTo(10 / 25.4, 9)
    expect(report.kinds[0].volume.unit).toBe('in3')
    expect(report.kinds[0].volume.value).toBeCloseTo(1000 / 25.4 ** 3, 9)
  })

  it('metric and imperial reports describe the same cube', async () => {
    const mm = await call<InspectReport>('inspect_model', { path: CUBE })
    const inch = await call<InspectReport>('inspect_model', {
      path: CUBE,
      outputUnits: { length: 'in' }
    })
    expect(inch.boundingBox.x * 25.4).toBeCloseTo(mm.boundingBox.x, 9)
    expect(inch.kinds[0].volume.value * 25.4 ** 3).toBeCloseTo(mm.kinds[0].volume.value, 6)
  })

  it('length units do not drag weight units along', async () => {
    const report = await call<InspectReport>('inspect_model', {
      path: CUBE,
      outputUnits: { length: 'in' }
    })
    expect(report.units.weight).toBe('g')
  })
})

describe('a unit is never inferred', () => {
  it('rejects a length with no unit rather than assuming millimetres', async () => {
    const result = await client.callTool({
      name: 'estimate',
      arguments: {
        path: CUBE,
        mode: 'max-quantity',
        tier: 'fast',
        carton: { dimensions: { x: 12, y: 12, z: 12 }, measured: 'inner' }
      }
    })
    expect(result.isError).toBe(true)
  })

  it('rejects a weight with no unit', async () => {
    const result = await client.callTool({
      name: 'estimate',
      arguments: {
        path: CUBE,
        mode: 'max-quantity',
        tier: 'fast',
        carton: cartonIn(12),
        maxWeight: { value: 35 }
      }
    })
    expect(result.isError).toBe(true)
  })

  it('rejects a unit it does not know, rather than falling back to a default', async () => {
    const result = await client.callTool({
      name: 'estimate',
      arguments: {
        path: CUBE,
        mode: 'max-quantity',
        tier: 'fast',
        carton: { dimensions: { x: 30, y: 30, z: 30, unit: 'cm' }, measured: 'inner' }
      }
    })
    expect(result.isError).toBe(true)
  })
})
