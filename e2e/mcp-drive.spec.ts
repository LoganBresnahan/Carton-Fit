import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { CUBE_STL, GOLDEN_PACKS } from '../samples/goldens'
import type { DriveOutcome } from '../src/shared/mcpDrive'
import type { AppStateReport } from '../src/main/mcp/appState'
import type { EstimateReport } from '../src/main/mcp/estimate'
import { SAMPLES } from './harness'
import {
  callStructured,
  connect,
  expectedServerVersion,
  nodeModeEnv,
  shimLaunch,
  stopSpawnedApp
} from './mcpClient'

/**
 * The v2 drive tier (ADR-0029, slice `v2-drive-tools`): Claude's half of the
 * conversation with the RUNNING app — connected the way Claude Desktop
 * actually connects, through the `--mcp` shim and the app's pipe (slice
 * `mcp-shim-single-instance`). These specs rode the app's own stdio until the
 * first Windows CI run showed that transport cannot exist there (a GUI
 * process never receives stdin — ADR-0029's Windows finding), which also made
 * the shim the only route these behaviours can be proven on for the primary
 * target. Each spec's shim spawns a detached, hidden app; the drive calls
 * reveal it, so `stopSpawnedApp` must put it away afterwards.
 *
 * The assertion that earns this file its place is the SETTLE RACE: set_inputs
 * changes the carton and the very same reply must carry the estimate for the
 * NEW carton — never the previous one. Auto-run is debounced and worker-run,
 * so a naive implementation answers from `packStatus: 'done'` while that done
 * still belongs to the last question; the golden counts (27,000 vs 343) are
 * different enough that a stale answer cannot pass by luck. The ordering
 * itself is pinned at the unit layer (tests/mcp-drive-settle.test.ts); this
 * proves it through the real debounce, worker, store and bridge.
 */

type Outcome = { state: AppStateReport; estimate: DriveOutcome['estimate'] }

function reportOf(outcome: Outcome): EstimateReport {
  expect(outcome.estimate.available, 'expected an estimate in the drive reply').toBe(true)
  if (!outcome.estimate.available) throw new Error('unreachable')
  return outcome.estimate.report
}

async function loadCube(client: Client): Promise<Outcome> {
  return callStructured<Outcome>(client, 'load_model', {
    path: join(SAMPLES, CUBE_STL.file)
  })
}

function goldenNamed(name: string): (typeof GOLDEN_PACKS)[number] {
  const golden = GOLDEN_PACKS.find((pack) => pack.name === name)
  if (!golden) throw new Error(`golden scenario missing: ${name}`)
  return golden
}

test('a drive journey: every reply carries the estimate for ITS OWN inputs', async () => {
  test.setTimeout(120_000)
  const shim = shimLaunch()
  const client = await connect(shim, nodeModeEnv())
  try {
    const loaded = await loadCube(client)
    expect(loaded.state.file).toMatchObject({ loaded: true, name: CUBE_STL.file, parts: 1 })
    expect(loaded.state.version).toBe(expectedServerVersion())

    // Golden: 12 in carton → 27,000 cubes. The reply to the set_inputs call
    // itself must already say so (auto-run: setting inputs IS estimating).
    const big = goldenNamed('cube max-quantity in a 12 in carton')
    const bigOutcome = await callStructured<Outcome>(client, 'set_inputs', {
      mode: big.mode,
      tier: big.tier,
      carton: {
        dimensions: { x: big.cartonIn[0], y: big.cartonIn[1], z: big.cartonIn[2], unit: 'in' },
        measured: 'inner'
      },
      outputUnits: { length: 'in', weight: 'lb' }
    })
    const bigReport = reportOf(bigOutcome)
    expect(bigReport.outcome).toMatchObject({ mode: 'max-quantity', count: big.count })
    expect(bigReport.request.innerCarton.unit).toBe('in')

    // THE RACE PIN. Shrink the carton and read the count out of the same
    // reply: 343, immediately. A settle that trusted the pre-existing 'done'
    // would return 27,000 here — a plausible, confident, wrong answer.
    const small = goldenNamed('cube max-quantity in a 3 in carton (slack on the far faces)')
    const smallOutcome = await callStructured<Outcome>(client, 'set_inputs', {
      carton: {
        dimensions: {
          x: small.cartonIn[0],
          y: small.cartonIn[1],
          z: small.cartonIn[2],
          unit: 'in'
        }
      }
    })
    expect(reportOf(smallOutcome).outcome).toMatchObject({ count: small.count })

    // And get_estimate agrees — same settle, read-only.
    const read = await callStructured<EstimateReport>(client, 'get_estimate', {})
    expect(read.outcome).toMatchObject({ mode: 'max-quantity', count: small.count })

    // Golden: the weight cap binds before geometry (5 lb / 0.01 lb → 500).
    const capped = goldenNamed('weight cap binds before geometry')
    const cappedOutcome = await callStructured<Outcome>(client, 'set_inputs', {
      carton: {
        dimensions: {
          x: capped.cartonIn[0],
          y: capped.cartonIn[1],
          z: capped.cartonIn[2],
          unit: 'in'
        }
      },
      maxWeight: { value: capped.maxWeightLb ?? 0, unit: 'lb' },
      weight: { partWeight: { value: capped.partWeightLb ?? 0, unit: 'lb' } }
    })
    const cappedReport = reportOf(cappedOutcome)
    expect(cappedReport.outcome).toMatchObject({ count: capped.count })
    expect(cappedReport.binding.constraint).toBe('weight')

    // get_app_state reads back what this conversation did to the app.
    const state = await callStructured<Outcome>(client, 'get_app_state', {})
    expect(state.state.file).toMatchObject({ loaded: true, name: CUBE_STL.file })
    expect(state.state.inputs.mode).toBe('max-quantity')
    expect(state.state.version).toBe(expectedServerVersion())
  } finally {
    await client.close()
    await stopSpawnedApp(shim.profile)
  }
})

test('capture_view returns the packed scene as a real image', async () => {
  test.setTimeout(120_000)
  const shim = shimLaunch()
  const client = await connect(shim, nodeModeEnv())
  try {
    await loadCube(client)
    const small = goldenNamed('cube max-quantity in a 3 in carton (slack on the far faces)')
    await callStructured<Outcome>(client, 'set_inputs', {
      mode: small.mode,
      tier: small.tier,
      carton: {
        dimensions: {
          x: small.cartonIn[0],
          y: small.cartonIn[1],
          z: small.cartonIn[2],
          unit: 'in'
        },
        measured: 'inner'
      }
    })

    const result = await client.callTool({ name: 'capture_view', arguments: {} })
    expect(result.isError ?? false).toBe(false)
    const image = Array.isArray(result.content) ? result.content[0] : undefined
    expect(image?.type).toBe('image')
    if (image?.type !== 'image') throw new Error('unreachable')
    expect(image.mimeType).toBe('image/png')
    const bytes = Buffer.from(image.data, 'base64')
    // A real PNG of a 343-cube scene, not a blank read-back (the ADR-0017
    // lesson: a cleared drawing buffer still yields a valid, tiny PNG).
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
    expect(bytes.byteLength).toBeGreaterThan(10_000)
  } finally {
    await client.close()
    await stopSpawnedApp(shim.profile)
  }
})

test('set_part_weight drives the ADR-0018 overrides, and refuses unknown kinds helpfully', async () => {
  test.setTimeout(120_000)
  const shim = shimLaunch()
  const client = await connect(shim, nodeModeEnv())
  try {
    await loadCube(client)

    const wrong = await client.callTool({
      name: 'set_part_weight',
      arguments: { kind: 'flange', weight: { value: 1, unit: 'g' } }
    })
    expect(wrong.isError).toBe(true)
    const text = Array.isArray(wrong.content) ? String(wrong.content[0]?.text ?? '') : ''
    expect(text).toContain('cube-10x10') // the refusal names what IS there

    // The override rides the same machinery: cap 5 lb, per-part 0.01 lb via
    // OVERRIDE (not the weight field) → the golden 500, weight-bound.
    const capped = goldenNamed('weight cap binds before geometry')
    await callStructured<Outcome>(client, 'set_inputs', {
      mode: capped.mode,
      tier: capped.tier,
      carton: {
        dimensions: {
          x: capped.cartonIn[0],
          y: capped.cartonIn[1],
          z: capped.cartonIn[2],
          unit: 'in'
        },
        measured: 'inner'
      },
      maxWeight: { value: capped.maxWeightLb ?? 0, unit: 'lb' }
    })
    const overridden = await callStructured<Outcome>(client, 'set_part_weight', {
      kind: 'cube-10x10',
      weight: { value: capped.partWeightLb ?? 0, unit: 'lb' }
    })
    const report = reportOf(overridden)
    expect(report.outcome).toMatchObject({ count: capped.count })
    expect(report.binding.constraint).toBe('weight')
    expect(report.qualifications.weightInput).toMatchObject({ overriddenKinds: ['cube-10x10'] })
  } finally {
    await client.close()
    await stopSpawnedApp(shim.profile)
  }
})
