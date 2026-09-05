import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createCartonFitServer } from '../src/main/mcp/server'
import type { OcctWasmContext } from '../src/main/occt/wasmPath'
import { resetOcctForTests } from '../src/main/occt/ingest'
import type { EstimateReport } from '../src/main/mcp/estimate'
import type { InspectReport } from '../src/main/mcp/inspect'
import { AS1_ASSEMBLY, CUBE_STEP, GOLDEN_PACKS } from '../samples/goldens'

// The MCP tools as the goldens' THIRD consumer (ADR-0005, ADR-0029 slice
// `goldens-third-consumer`).
//
// The point of driving a real client over a real transport rather than calling
// `estimateParts` directly: everything between the two — the zod input schemas,
// the SDK's validation of structured output against the output schema, the JSON
// round trip — is contract surface under ADR-0020, and it is exactly where a
// contract mistake would hide. A unit test of the function would pass with a
// schema that rejects every real call.
//
// The expectations are `samples/goldens.ts`, hand-computed, shared with the
// vitest math layer and the e2e specs. They are stated in INCHES because that
// is what the UI's defaults use — which makes every scenario here an imperial
// wire call as well, and a missed conversion cannot pass.

const REPO_ROOT = join(__dirname, '..')
const SAMPLES = join(REPO_ROOT, 'samples')
const CONTEXT: OcctWasmContext = { appPath: REPO_ROOT, isPackaged: false }

async function connect(): Promise<Client> {
  const server = createCartonFitServer({ occt: CONTEXT, version: '0.0.0-test' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'goldens', version: '1' })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  return client
}

let client: Client
beforeEach(async () => {
  client = await connect()
})
afterEach(async () => {
  await client.close()
  resetOcctForTests()
})

/** Call a tool and return its structured content, failing loudly on a tool
 *  error — an `isError` reply carries the message as text, and swallowing it
 *  would turn a diagnosable failure into an undefined-property crash. */
async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args })
  const text = Array.isArray(result.content) && result.content[0]?.type === 'text'
    ? String(result.content[0].text)
    : ''
  expect(result.isError ?? false, `${name} failed: ${text}`).toBe(false)
  return result.structuredContent as T
}

describe('the server publishes v1', () => {
  it('offers exactly the two v1 tools, with schemas', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(['estimate', 'inspect_model'])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} has no input schema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} has no output schema`).toBeDefined()
    }
  })

  it('tells the client what a bulk answer is worth, before it asks (ADR-0028)', async () => {
    // The description is the only thing that reaches a client's reasoning ahead
    // of a call, and a bulk-dump count is precisely what a client will otherwise
    // derive for itself from a volume and a packing fraction.
    const { tools } = await client.listTools()
    const estimate = tools.find((tool) => tool.name === 'estimate')
    expect(estimate?.description).toMatch(/ceiling/i)
    expect(estimate?.description).toMatch(/fill trial/i)
  })

  it('sends the reader to spaceOnlyCount for the carton, not to geometryBound', async () => {
    // The 5th dogfood's finding, and the mechanism behind two earlier ones:
    // this description used to say geometryBound was the field that "can tell
    // a roomy carton from a full one". True on 2026-09-03, when it was the
    // only space field; false the same evening, when ADR-0033 added the
    // constructive answer. A reader following the old sentence quoted a
    // ceiling that is routinely loose.
    const { tools } = await client.listTools()
    const estimate = tools.find((tool) => tool.name === 'estimate')
    expect(estimate?.description).toMatch(/spaceOnlyCount/)
    expect(estimate?.description).toMatch(/above the count it proves nothing/i)
    expect(estimate?.description).not.toMatch(/only IT can tell/i)
  })

  it('carries the choice between the three ceilings ON the fields', async () => {
    // A code comment reaches whoever edits schemas.ts; the reader choosing
    // between three similar numbers is on the other side of the wire.
    const { tools } = await client.listTools()
    const estimate = tools.find((tool) => tool.name === 'estimate')
    const outcome = estimate?.outputSchema?.properties?.outcome as {
      anyOf?: { properties?: Record<string, { description?: string }> }[]
    }
    const qty = outcome.anyOf?.find((variant) => variant.properties?.spaceOnlyCount)
    expect(qty?.properties?.geometryBound?.description).toMatch(/never quote it as capacity/i)
    expect(qty?.properties?.spaceOnlyCount?.description).toMatch(/roomy carton from a full one/i)
    expect(qty?.properties?.upperBound?.description).toMatch(/moves when the cap moves/i)
  })
})

describe('inspect_model against the hand-computed goldens', () => {
  it('measures the 10 mm cube', async () => {
    const report = await call<InspectReport>('inspect_model', {
      path: join(SAMPLES, CUBE_STEP.file)
    })
    expect(report.totals.parts).toBe(CUBE_STEP.partCount)
    expect(report.boundingBox.unit).toBe('mm')
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(report.boundingBox[axis]).toBeCloseTo(CUBE_STEP.sizeMm![0], 3)
    }
    const [kind] = report.kinds
    expect(kind.volume).toEqual({ value: expect.closeTo(CUBE_STEP.volumeMm3!, 3), unit: 'mm3' })
    expect(kind.closedMesh).toBe(true)
    expect(report.qualifications.openMesh.affected).toBe(false)
  })

  it('counts AS1’s 18 solids as 5 kinds', async () => {
    const report = await call<InspectReport>('inspect_model', {
      path: join(SAMPLES, AS1_ASSEMBLY.file)
    })
    expect(report.totals.parts).toBe(AS1_ASSEMBLY.partCount)
    expect(report.totals.triangles).toBe(AS1_ASSEMBLY.triangleCount)
    // The hand census behind the golden: 1 plate + 2 brackets + 1 rod + 6 bolts
    // + 8 nuts. Kinds, not parts — that is the grouping ADR-0018 weights bind to.
    const counts = Object.fromEntries(report.kinds.map((kind) => [kind.kind, kind.count]))
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(18)
    expect(report.kinds).toHaveLength(report.totals.kinds)
    expect(Math.max(...report.kinds.map((kind) => kind.count))).toBe(8) // the nuts
  })

  it('reports in inches when asked, without touching the weight units', async () => {
    const report = await call<InspectReport>('inspect_model', {
      path: join(SAMPLES, CUBE_STEP.file),
      outputUnits: { length: 'in' }
    })
    expect(report.units).toEqual({ length: 'in' })
    expect(report.boundingBox.x).toBeCloseTo(10 / 25.4, 6)
    expect(report.kinds[0].volume.unit).toBe('in3')
  })
})

// One test per golden packing scenario — the same list the e2e specs walk
// through the real UI, asked here through the tool instead.
describe('estimate against GOLDEN_PACKS', () => {
  for (const golden of GOLDEN_PACKS) {
    it(`golden: ${golden.name}`, async () => {
      const report = await call<EstimateReport>('estimate', {
        path: join(SAMPLES, golden.part.file),
        mode: golden.mode,
        tier: golden.tier,
        carton: {
          dimensions: {
            x: golden.cartonIn[0],
            y: golden.cartonIn[1],
            z: golden.cartonIn[2],
            unit: 'in'
          },
          measured: 'inner'
        },
        ...(golden.maxWeightLb !== undefined
          ? { maxWeight: { value: golden.maxWeightLb, unit: 'lb' } }
          : {}),
        ...(golden.partWeightLb !== undefined
          ? { weight: { partWeight: { value: golden.partWeightLb, unit: 'lb' } } }
          : {})
      })

      // `derivation` rides along so a red test says why the number should have
      // been what it was, the way the e2e specs do.
      const because = `\n  expected by hand: ${golden.derivation}`

      if (golden.count !== undefined) {
        expect(report.outcome.mode).toBe('max-quantity')
        if (report.outcome.mode === 'max-quantity') {
          expect(report.outcome.count, because).toBe(golden.count)
        }
      }
      if (golden.fits !== undefined) {
        expect(report.outcome.mode).toBe('fit-check')
        if (report.outcome.mode === 'fit-check') {
          expect(report.outcome.fits, because).toBe(golden.fits)
        }
      }
      // ADR-0004: which hard constraint bound the answer, always. The goldens
      // say "space"; the engine's word for it is "geometry".
      expect(report.binding.constraint, because).toBe(
        golden.binding === 'space' ? 'geometry' : 'weight'
      )
      expect(report.request.tier).toBe(golden.tier)
      // ADR-0003: a heuristic result must never reach a client as a proof.
      //
      // The FLAG carries that unconditionally — the placement really was found
      // heuristically, whatever the bound says. The NOTE hedges only while the
      // bound leaves room: these goldens are exact-fit grids where the rigorous
      // bound meets the count, and "a mixed arrangement may fit more" beside
      // `upperBound === count` is the self-contradiction the 2026-09-03 dogfood
      // caught. Method and result are different claims, so they are asserted
      // separately rather than by grepping one string for both.
      if (golden.mode === 'max-quantity' && (golden.count ?? 0) > 0) {
        expect(report.qualifications.heuristic.heuristic, because).toBe(true)
        const note = report.qualifications.heuristic.note
        const outcome = report.outcome
        const bound =
          outcome.mode === 'max-quantity' && outcome.upperBound.known
            ? outcome.upperBound.count
            : undefined
        if (outcome.mode === 'max-quantity' && bound === outcome.count) {
          expect(note, because).toMatch(/no arrangement beats this/)
          expect(note, because).not.toMatch(/may fit more/)
        } else {
          expect(note, because).toMatch(/Heuristic/)
        }
      }
    })
  }

  it('the weight-capped golden reports the cap it spent, in the caller’s units', async () => {
    // The 5 lb / 0.01 lb scenario is the one that once answered 499 (a float
    // floor bug found by dogfooding). Here it also pins that the cap and the
    // packed weight come back in lb because the CALL was in lb — the number and
    // its unit travel together or the 500 means nothing.
    const golden = GOLDEN_PACKS.find((pack) => pack.binding === 'weight')!
    const report = await call<EstimateReport>('estimate', {
      path: join(SAMPLES, golden.part.file),
      mode: golden.mode,
      tier: golden.tier,
      carton: { dimensions: { x: 12, y: 12, z: 12, unit: 'in' }, measured: 'inner' },
      maxWeight: { value: golden.maxWeightLb!, unit: 'lb' },
      weight: { partWeight: { value: golden.partWeightLb!, unit: 'lb' } },
      outputUnits: { length: 'in', weight: 'lb' }
    })
    expect(report.request.maxWeight).toEqual({ value: expect.closeTo(5, 6), unit: 'lb' })
    expect(report.request.packedWeight.unit).toBe('lb')
    expect(report.request.packedWeight.value).toBeCloseTo(5, 2)
  })
})
