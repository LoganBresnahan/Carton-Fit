import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createCartonFitServer } from '../src/main/mcp/server'
import { resetOcctForTests } from '../src/main/occt/ingest'
import type { OcctWasmContext } from '../src/main/occt/wasmPath'
import type { EstimateReport } from '../src/main/mcp/estimate'
import type { InspectReport } from '../src/main/mcp/inspect'
import { estimateOutput, inspectOutput } from '../src/main/mcp/schemas'

// ADVERSARIAL VERIFY PASS: the qualifications are STRUCTURALLY required
// (ADR-0029 slice `qualified-response-schema`).
//
// THE FAILURE THIS EXISTS TO PREVENT is not a crash. It is an AI client
// receiving `{count: 47}` with no upper bound, no binding constraint and no
// heuristic label, and repeating "47 fit" to an engineer as a fact. ADR-0029
// says a client that DROPS the qualifications is out of our hands; one that
// never received them is our bug — and the second failure is invisible from
// inside, because the reply is well-formed and the number is right.
//
// So "we always send them" is not the claim being tested. `optional()` on a
// schema field plus a code path that happens to populate it looks exactly like
// a required field until the day it doesn't. The claim is that the CONTRACT
// forbids their absence, which is tested three ways:
//   1. against the published JSON Schema, which is what a client is promised;
//   2. by mutation — delete a qualification from a real reply and prove the
//      schema rejects it (a test that cannot fail is not a test);
//   3. behaviourally, across the answer shapes where each hedge matters.

const REPO_ROOT = join(__dirname, '..')
const SAMPLES = join(REPO_ROOT, 'samples')
const CONTEXT: OcctWasmContext = { appPath: REPO_ROOT, isPackaged: false }
const CUBE = join(SAMPLES, 'cube-10x10.stp')
const OPEN_CUBE = join(SAMPLES, 'cube-10x10-open.stl')
const AS1 = join(SAMPLES, 'as1-oc-214.stp')

let client: Client
beforeEach(async () => {
  const server = createCartonFitServer({ occt: CONTEXT, version: '0.0.0-test' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'qualifications', version: '1' })
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

const carton = (x: number, unit: 'mm' | 'in' = 'mm') => ({
  dimensions: { x, y: x, z: x, unit },
  measured: 'inner' as const
})

function estimate(args: Record<string, unknown>): Promise<EstimateReport> {
  return call<EstimateReport>('estimate', { path: CUBE, tier: 'fast', ...args })
}

// --- 1. the published contract -------------------------------------------

interface JsonSchema {
  required?: string[]
  properties?: Record<string, JsonSchema>
}

async function outputSchemaOf(tool: string): Promise<JsonSchema> {
  const { tools } = await client.listTools()
  const found = tools.find((entry) => entry.name === tool)
  expect(found?.outputSchema, `${tool} publishes no output schema`).toBeDefined()
  return found!.outputSchema as JsonSchema
}

describe('the published schema forbids an unqualified answer', () => {
  it('estimate requires its qualifications, and every one of them', async () => {
    const schema = await outputSchemaOf('estimate')
    expect(schema.required).toContain('qualifications')
    expect(schema.required).toContain('binding')
    const qualifications = schema.properties?.qualifications
    // Named individually rather than as a count: a future qualification added
    // to the object is welcome, one of these quietly going optional is not.
    for (const key of ['heuristic', 'weightInput', 'clearances', 'openMesh']) {
      expect(qualifications?.required, `qualifications.${key} is optional`).toContain(key)
    }
  })

  it('inspect_model requires its own', async () => {
    const schema = await outputSchemaOf('inspect_model')
    expect(schema.required).toContain('qualifications')
    for (const key of ['openMesh', 'mixedInstances']) {
      expect(schema.properties?.qualifications?.required).toContain(key)
    }
  })
})

// --- 2. mutation: prove the schema is what enforces it --------------------

describe('the schema rejects a reply with a hedge missing', () => {
  const estimateSchema = z.object(estimateOutput)
  const inspectSchema = z.object(inspectOutput)

  it('accepts a real reply', async () => {
    const report = await estimate({ mode: 'max-quantity', carton: carton(100) })
    expect(estimateSchema.safeParse(report).success).toBe(true)
  })

  for (const key of ['heuristic', 'weightInput', 'clearances', 'openMesh'] as const) {
    it(`rejects a reply with qualifications.${key} deleted`, async () => {
      const report = await estimate({ mode: 'max-quantity', carton: carton(100) })
      const mutated = structuredClone(report) as EstimateReport
      delete (mutated.qualifications as unknown as Record<string, unknown>)[key]
      expect(estimateSchema.safeParse(mutated).success).toBe(false)
    })
  }

  it('rejects a count whose upper bound was simply omitted', async () => {
    // The exact shape ADR-0022's "absence over misinformation" would produce if
    // it were passed straight to the wire: the key gone, indistinguishable from
    // a build that forgot it. On the wire, absence must be a statement.
    const report = await estimate({ mode: 'max-quantity', carton: carton(100) })
    const mutated = structuredClone(report) as EstimateReport
    delete (mutated.outcome as unknown as Record<string, unknown>).upperBound
    expect(estimateSchema.safeParse(mutated).success).toBe(false)
  })

  it('rejects an unknown value that gives no reason', async () => {
    const report = await estimate({ mode: 'max-quantity', carton: carton(100) })
    const mutated = structuredClone(report) as EstimateReport
    if (mutated.outcome.mode === 'max-quantity') {
      mutated.outcome.upperBound = { known: false } as never
    }
    expect(estimateSchema.safeParse(mutated).success).toBe(false)
  })

  it('rejects a binding constraint stated without one', async () => {
    const report = await estimate({ mode: 'max-quantity', carton: carton(100) })
    const mutated = structuredClone(report) as EstimateReport
    delete (mutated as unknown as Record<string, unknown>).binding
    expect(estimateSchema.safeParse(mutated).success).toBe(false)
  })

  it('rejects an inspect reply with its open-mesh finding deleted', async () => {
    const report = await call<InspectReport>('inspect_model', { path: CUBE })
    const mutated = structuredClone(report) as InspectReport
    delete (mutated.qualifications as unknown as Record<string, unknown>).openMesh
    expect(inspectSchema.safeParse(mutated).success).toBe(false)
  })
})

// --- 3. behaviour, across the shapes where each hedge matters -------------

describe('every answer arrives qualified', () => {
  it('labels a count as heuristic and pairs it with a rigorous bound', async () => {
    const report = await estimate({ mode: 'max-quantity', carton: carton(12, 'in') })
    // The flag is the claim about METHOD and never lapses. The note's hedge is
    // a claim about the RESULT, and this carton is an exact-fit grid whose
    // rigorous bound meets its count — so the note states optimality instead of
    // inviting a search the bound in the same payload forecloses (2026-09-03).
    expect(report.qualifications.heuristic.heuristic).toBe(true)
    expect(report.qualifications.heuristic.note).toMatch(/no arrangement beats this/)
    expect(report.outcome.mode === 'max-quantity' && report.outcome.upperBound.known).toBe(true)
    if (report.outcome.mode === 'max-quantity' && report.outcome.upperBound.known) {
      // ADR-0022 §7: the bound is a cap no arrangement can beat, so it can never
      // sit below the count that was actually achieved.
      expect(report.outcome.upperBound.count).toBeGreaterThanOrEqual(report.outcome.count)
    }
  })

  it('reports the geometry-only bound beside the joint one', async () => {
    // WHY THIS FIELD IS ON THE WIRE AT ALL (2026-09-03). Two dogfood clients,
    // in different products, both reached for `upperBound` as evidence about
    // the carton — one calling it "unstable", the other correctly deducing it
    // was joint. A number a client cannot compute is a number it will guess at,
    // so the guess is replaced with the measurement.
    const report = await estimate({
      mode: 'max-quantity',
      carton: carton(100),
      weight: { partWeight: { value: 1, unit: 'g' } },
      maxWeight: { value: 10, unit: 'g' }
    })
    if (report.outcome.mode !== 'max-quantity') throw new Error('mode')
    expect(report.outcome.count).toBe(10)
    // The cap decides the joint bound…
    expect(report.outcome.upperBound).toEqual({ known: true, count: 10 })
    // …and the carton, asked on its own, says something else entirely. If these
    // two were ever equal here the field would be pointless.
    expect(report.outcome.geometryBound.known).toBe(true)
    if (report.outcome.geometryBound.known) {
      expect(report.outcome.geometryBound.count).toBeGreaterThan(report.outcome.count)
    }
  })

  it('says so when no weight was given, instead of letting "space-bound" imply one was', async () => {
    const report = await estimate({ mode: 'max-quantity', carton: carton(100) })
    expect(report.qualifications.weightInput.supplied).toBe(false)
    if (!report.qualifications.weightInput.supplied) {
      expect(report.qualifications.weightInput.note).toMatch(/space only/)
    }
    expect(report.binding.constraint).toBe('geometry')
  })

  it('says whether the constraint actually BOUND — and on a comfortable fit, that nothing did', async () => {
    // The dogfood finding of 2026-09-02, verbatim: a fit at 38% of the weight
    // cap, everything placed, and the note said "the weight cap stopped this".
    // A 10 mm cube in a 100 mm carton, 1 g against a 2 g cap: weight has the
    // least headroom (50% vs 0.1% fill), so the core names it — correctly — and
    // the report must not turn "closest" into "stopped".
    const report = await estimate({
      mode: 'fit-check',
      carton: carton(100),
      weight: { partWeight: { value: 1, unit: 'g' } },
      maxWeight: { value: 2, unit: 'g' }
    })
    expect(report.outcome).toMatchObject({ mode: 'fit-check', fits: true })
    expect(report.binding.constraint).toBe('weight')
    expect(report.binding.bound).toBe(false)
    expect(report.binding.note).toMatch(/^Nothing bound/)
    expect(report.binding.note).toMatch(/50% of the weight cap/)
    expect(report.binding.note).toMatch(/Weight is the closer limit/)
    expect(report.binding.note).not.toMatch(/stopped/)
  })

  it('a count is always bound — it is where a constraint stopped it', async () => {
    const report = await estimate({
      mode: 'max-quantity',
      carton: carton(100),
      weight: { partWeight: { value: 1, unit: 'g' } },
      maxWeight: { value: 10, unit: 'g' }
    })
    expect(report.binding).toMatchObject({ constraint: 'weight', bound: true })
    expect(report.binding.note).toMatch(/stopped/)
  })

  // ADR-0029 phase-2 amendment 2 (2026-09-03 dogfood): the note may not assert
  // what the OTHER constraint was doing unless a field proves it. The sentence
  // these replace — "The weight cap stopped this, not the carton — there is
  // room left" — was false on the run that found it: a plate whose count was
  // capped at 3 by weight AND by a carton with nowhere to put a 4th.
  it('will not claim the carton has room, because a bound is not an arrangement', async () => {
    // 10 g of 1 g cubes in a carton that would hold a thousand: the cap really
    // did stop it, and the carton really is roomy — but nothing here has tried
    // to place an 11th, so the report says only what it checked.
    const report = await estimate({
      mode: 'max-quantity',
      carton: carton(100),
      weight: { partWeight: { value: 1, unit: 'g' } },
      maxWeight: { value: 10, unit: 'g' }
    })
    expect(report.outcome).toMatchObject({ mode: 'max-quantity', count: 10 })
    expect(report.binding.constraint).toBe('weight')
    expect(report.binding.otherConstraint).toMatchObject({ known: false })
    expect(report.binding.note).toMatch(/weight cap stopped this at 10/)
    // The exact words that shipped the false claim, and the claim itself.
    expect(report.binding.note).not.toMatch(/room left/)
    expect(report.binding.note).not.toMatch(/not the carton/)
  })

  it('says both limits landed when the geometry bound proves it', async () => {
    // 10 mm cubes in a 25 mm carton: 2 per axis, so 8 by geometry — and a cap
    // of exactly 8 g ties it. The engine labels a tie 'weight' by convention;
    // the note must not turn that convention into "the carton had room".
    const report = await estimate({
      mode: 'max-quantity',
      carton: carton(25),
      weight: { partWeight: { value: 1, unit: 'g' } },
      maxWeight: { value: 8, unit: 'g' }
    })
    expect(report.outcome).toMatchObject({ mode: 'max-quantity', count: 8 })
    expect(report.binding.constraint).toBe('weight')
    expect(report.binding.otherConstraint).toEqual({ known: true, atLimit: true })
    expect(report.binding.note).toMatch(/Both limits land on 8/)
    expect(report.binding.note).not.toMatch(/room left/)
  })

  it('says the cap has room only where the engine has actually settled it', async () => {
    // Same carton, a cap nowhere near binding: geometry stops the count at 8,
    // and 'geometry' means — by the engine's own arithmetic — that the cap
    // allows strictly more. That one IS provable, so it is said.
    const report = await estimate({
      mode: 'max-quantity',
      carton: carton(25),
      weight: { partWeight: { value: 1, unit: 'g' } },
      maxWeight: { value: 1000, unit: 'g' }
    })
    expect(report.binding.constraint).toBe('geometry')
    expect(report.binding.otherConstraint).toEqual({ known: true, atLimit: false })
    expect(report.binding.note).toMatch(/not the weight cap/)
  })

  it('a non-fit that is also over the cap says both, not just the carton', async () => {
    // The cube cannot enter a 5 mm carton, and at 100 g against a 1 g cap it
    // could not have travelled anyway. Exact arithmetic on the weight side, so
    // the report states it rather than hedging.
    const report = await estimate({
      mode: 'fit-check',
      carton: carton(5),
      weight: { partWeight: { value: 100, unit: 'g' } },
      maxWeight: { value: 1, unit: 'g' }
    })
    expect(report.outcome).toMatchObject({ mode: 'fit-check', fits: false })
    expect(report.binding.constraint).toBe('geometry')
    expect(report.binding.otherConstraint).toEqual({ known: true, atLimit: true })
    expect(report.binding.note).toMatch(/weight cap would have too/)
  })

  it('a non-fit is bound, by the carton', async () => {
    // A 10 mm cube cannot enter a 5 mm carton.
    const report = await estimate({ mode: 'fit-check', carton: carton(5) })
    expect(report.outcome).toMatchObject({ mode: 'fit-check', fits: false })
    expect(report.binding).toMatchObject({ constraint: 'geometry', bound: true })
  })

  it('names the weight source when one was given', async () => {
    const report = await estimate({
      mode: 'max-quantity',
      carton: carton(100),
      weight: { partWeight: { value: 1, unit: 'g' } },
      maxWeight: { value: 10, unit: 'g' }
    })
    expect(report.qualifications.weightInput).toEqual({
      supplied: true,
      source: 'direct',
      overriddenKinds: [],
      // With nothing overridden the two agree — which is why the disagreement
      // below went unnoticed for as long as it did.
      countedWeightFrom: 'direct'
    })
    expect(report.binding.constraint).toBe('weight')
  })

  it('says where the counted grams came from, not just which mode was set', async () => {
    // THE 2026-09-03 FINDING. A max-quantity count replicates ONE unit; price
    // that unit by hand and no density is involved in the answer, however the
    // mode is set. `source` said "density" and a script reading it would have
    // recorded a derived weight for a number that was typed in.
    const report = await estimate({
      path: AS1,
      mode: 'max-quantity',
      carton: carton(24, 'in'),
      weight: { densityGPerCm3: 7.85 },
      unitPart: 'plate',
      overrides: [{ kind: 'plate', weight: { value: 10, unit: 'lb' } }]
    })
    if (report.qualifications.weightInput.supplied !== true) throw new Error('supplied')
    // The setting is reported honestly, and is now clearly labelled as such…
    expect(report.qualifications.weightInput.source).toBe('density')
    // …while the answer's own provenance is the hand-entered number.
    expect(report.qualifications.weightInput.countedWeightFrom).toBe('override')
  })

  it('calls it mixed when only some counted parts were priced by hand', async () => {
    // Fit-check weighs the whole file, so one override among five kinds is
    // genuinely a mixture — and flattening that to either extreme would be a
    // worse answer than naming it.
    const report = await estimate({
      path: AS1,
      mode: 'fit-check',
      carton: carton(24, 'in'),
      weight: { densityGPerCm3: 7.85 },
      overrides: [{ kind: 'plate', weight: { value: 10, unit: 'lb' } }]
    })
    if (report.qualifications.weightInput.supplied !== true) throw new Error('supplied')
    expect(report.qualifications.weightInput.countedWeightFrom).toBe('mixed')
  })

  it('reports a density weight over an open mesh as unreliable, and says what to do', async () => {
    // The silent-wrong-answer path ADR-0015 exists for: the volume is 33% light,
    // nothing throws, and weight is a HARD constraint — so the count is wrong
    // and confident. An AI client cannot see the mesh; this sentence is all it has.
    const report = await call<EstimateReport>('estimate', {
      path: OPEN_CUBE,
      mode: 'max-quantity',
      tier: 'fast',
      carton: carton(100),
      weight: { densityGPerCm3: 7.85 }
    })
    expect(report.qualifications.openMesh.affected).toBe(true)
    if (report.qualifications.openMesh.affected) {
      expect(report.qualifications.openMesh.parts).toContain('cube-10x10-open')
      expect(report.qualifications.openMesh.note).toMatch(/not a closed mesh/)
      expect(report.qualifications.openMesh.note).toMatch(/directly/)
    }
  })

  it('retires that warning when the weight is given directly — the fix it recommends', async () => {
    const report = await call<EstimateReport>('estimate', {
      path: OPEN_CUBE,
      mode: 'max-quantity',
      tier: 'fast',
      carton: carton(100),
      weight: { partWeight: { value: 8, unit: 'g' } }
    })
    expect(report.qualifications.openMesh.affected).toBe(false)
  })

  it('admits when it clamped a clearance rather than answering a different question', async () => {
    const report = await estimate({
      mode: 'max-quantity',
      carton: carton(100),
      clearances: { betweenParts: { value: -5, unit: 'mm' } }
    })
    expect(report.qualifications.clearances.asRequested).toBe(false)
    if (!report.qualifications.clearances.asRequested) {
      expect(report.qualifications.clearances.note).toMatch(/clamped to zero/)
    }
  })

  it('says the drawing is partial when the count outruns the placements', async () => {
    // A 1 mm-ish part in a big carton counts past MAX_GRID_PLACEMENTS (50,000).
    // `count` stays exact; what is incomplete is the layout — and an AI client
    // reading placements would otherwise conclude the count is wrong.
    const report = await estimate({ mode: 'max-quantity', carton: carton(2000) })
    if (report.outcome.mode === 'max-quantity' && !report.outcome.layout.complete) {
      expect(report.outcome.layout.counted).toBeGreaterThan(report.outcome.layout.shown)
      expect(report.outcome.layout.note).toMatch(/the count is exact/)
    } else {
      expect.unreachable('a 2 m carton of 10 mm cubes should outrun the placement cap')
    }
  })

  it('explains a non-fit with the space it had left', async () => {
    // 190 mm: AS1's 180 × 150 × 20 plate goes in, one part does not — the
    // narrow band where a non-fit is a placement outcome rather than a part
    // that could never fit in any carton this size.
    const report = await call<EstimateReport>('estimate', {
      path: AS1,
      mode: 'fit-check',
      tier: 'fast',
      carton: carton(190)
    })
    expect(report.outcome.mode).toBe('fit-check')
    if (report.outcome.mode === 'fit-check') {
      expect(report.outcome.fits).toBe(false)
      expect(report.outcome.unplaced.length).toBeGreaterThan(0)
      // Present or absent, it is a STATEMENT either way — never a missing key.
      expect(typeof report.outcome.largestFreeSpace.known).toBe('boolean')
      if (!report.outcome.largestFreeSpace.known) {
        expect(report.outcome.largestFreeSpace.reason.length).toBeGreaterThan(0)
      }
    }
  })

  it('states there is nothing left over when everything fit', async () => {
    const report = await call<EstimateReport>('estimate', {
      path: AS1,
      mode: 'fit-check',
      tier: 'fast',
      carton: carton(24, 'in')
    })
    if (report.outcome.mode === 'fit-check') {
      expect(report.outcome.fits).toBe(true)
      expect(report.outcome.largestFreeSpace.known).toBe(false)
      if (!report.outcome.largestFreeSpace.known) {
        expect(report.outcome.largestFreeSpace.reason).toMatch(/everything fit/)
      }
    }
  })

  it('refuses the disabled nesting tier by name instead of silently doing something else', async () => {
    const result = await client.callTool({
      name: 'estimate',
      arguments: { path: CUBE, mode: 'max-quantity', tier: 'nesting', carton: carton(100) }
    })
    expect(result.isError).toBe(true)
  })

  it('flags a kind whose instances do not share a bounding box', async () => {
    // AS1 instances one product at several orientations, and geometry arrives
    // with the placement baked in — so a per-kind size describes ONE of them.
    const report = await call<InspectReport>('inspect_model', { path: AS1 })
    const varying = report.kinds.filter((kind) => !kind.instancesAlike)
    expect(varying.length).toBeGreaterThan(0)
    expect(report.qualifications.mixedInstances.affected).toBe(true)
    if (report.qualifications.mixedInstances.affected) {
      expect(report.qualifications.mixedInstances.kinds).toEqual(
        expect.arrayContaining(varying.map((kind) => kind.kind))
      )
    }
  })
})
