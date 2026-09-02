import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createCartonFitServer } from '../src/main/mcp/server'
import { buildAppState } from '../src/main/mcp/appState'
import { isoTime, presetsReport, savedEstimatesReport } from '../src/main/mcp/data'
import type { ToolStorage } from '../src/main/mcp/data'
import type { OcctWasmContext } from '../src/main/occt/wasmPath'
import { DEFAULT_SETTINGS } from '../src/renderer/src/packing/settings'
import type { ConfigurationSummary, EstimateRow } from '../src/shared/storage'
import type { DriveAction, DriveBridge, DriveResult } from '../src/shared/mcpDrive'

// The v3 DATA tier (ADR-0029, slice `v3-data-tools`), driven through a real MCP
// client over the in-memory transport — the same arrangement the goldens use,
// and for the same reason: the zod schemas and the SDK's validation of
// structured output are contract surface (ADR-0020), and a direct call to the
// handler would prove nothing about either.
//
// What is faked here is deliberately only the two edges the tier sits between:
// the DATABASE (rows main reads) and the DRIVE BRIDGE (the running window). The
// tier's own job is choosing which of those answers a question, and that choice
// — read locally, write through the app — is what these pin.

const CONTEXT: OcctWasmContext = { appPath: join(__dirname, '..'), isPackaged: false }

const PRESETS: ConfigurationSummary[] = [
  { id: 1, name: 'Standard 12in', updatedAt: Date.UTC(2026, 7, 3, 14, 30) },
  { id: 2, name: 'Half-height', updatedAt: Date.UTC(2026, 7, 4, 9, 0) }
]

const ROWS: EstimateRow[] = [
  {
    id: 7,
    fileName: 'bracket.step',
    contentHash: 'abc',
    createdAt: Date.UTC(2026, 7, 4, 9, 0),
    settings: { ...DEFAULT_SETTINGS },
    result: { mode: 'max-quantity', count: 343, binding: 'space' }
  },
  {
    id: 4,
    fileName: 'housing.step',
    contentHash: 'def',
    createdAt: Date.UTC(2026, 7, 1, 8, 0),
    settings: { ...DEFAULT_SETTINGS },
    result: { mode: 'fit-check', fits: false, binding: 'weight' }
  }
]

/** The window, reduced to what the tier actually needs from it: a record of
 *  what was asked, and a plausible reply. */
function fakeDrive(): DriveBridge & { calls: DriveAction[] } {
  const calls: DriveAction[] = []
  const state = buildAppState({
    fileName: 'bracket.step',
    parts: [],
    settings: DEFAULT_SETTINGS,
    unitPartName: null,
    overrides: {},
    packStatus: 'done',
    view: 'packed'
  })
  return {
    calls,
    call(action: DriveAction): Promise<DriveResult> {
      calls.push(action)
      switch (action.type) {
        case 'save_preset':
        case 'save_estimate':
          return Promise.resolve({ kind: 'written' })
        case 'export_estimate':
          return Promise.resolve({
            kind: 'text',
            format: action.format,
            suggestedName: `bracket-12x12x12in.${action.format === 'csv' ? 'csv' : 'txt'}`,
            text: action.format === 'csv' ? 'name,quantity\n' : 'Carton Fit — estimate'
          })
        default:
          return Promise.resolve({
            kind: 'outcome',
            outcome: { state, estimate: { available: false, reason: 'not under test here' } }
          })
      }
    }
  }
}

function fakeStorage(): ToolStorage & { presets: ConfigurationSummary[] } {
  const presets = [...PRESETS]
  return {
    presets,
    listConfigurations: () => presets,
    recentEstimates: (limit) => ROWS.slice(0, limit ?? 50),
    estimateById: (id) => ROWS.find((row) => row.id === id) ?? null
  }
}

let client: Client
let drive: ReturnType<typeof fakeDrive>
let storage: ReturnType<typeof fakeStorage>

async function connect(options: { withStorage: boolean } = { withStorage: true }): Promise<Client> {
  drive = fakeDrive()
  storage = fakeStorage()
  const server = createCartonFitServer({
    occt: CONTEXT,
    version: '9.9.9+abc1234',
    drive,
    storage: options.withStorage ? storage : undefined
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const connected = new Client({ name: 'v3-tests', version: '1' })
  await Promise.all([connected.connect(clientTransport), server.connect(serverTransport)])
  return connected
}

beforeEach(async () => {
  client = await connect()
})
afterEach(async () => {
  await client.close()
})

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args })
  const text =
    Array.isArray(result.content) && result.content[0]?.type === 'text'
      ? String(result.content[0].text)
      : ''
  expect(result.isError ?? false, `${name} failed: ${text}`).toBe(false)
  return result.structuredContent as T
}

async function callExpectingError(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args })
  expect(result.isError, `${name} was expected to fail`).toBe(true)
  return Array.isArray(result.content) && result.content[0]?.type === 'text'
    ? String(result.content[0].text)
    : ''
}

describe('the published surface', () => {
  it('adds seven data tools to the drive tier', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'apply_preset',
      'capture_view',
      'estimate',
      'export_estimate',
      'get_app_state',
      'get_estimate',
      'inspect_model',
      'list_presets',
      'list_saved_estimates',
      'load_model',
      'restore_estimate',
      'save_estimate',
      'save_preset',
      'set_inputs',
      'set_part_weight'
    ])
  })

  it('publishes NO way to delete the user’s saved data', async () => {
    // A deliberate absence, and worth a test because it is the kind of gap a
    // later "for completeness" edit closes without noticing. Everything else in
    // this tier is recoverable — a wrong preset is re-applied, a wrong restore
    // is one Ctrl+Z — but a deleted preset is gone, and the person whose data
    // it is may not be at the screen.
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).filter((name) => /delete|remove|clear/.test(name))).toEqual(
      []
    )
  })

  it('is absent entirely when the app has no database to offer', async () => {
    // The same rule the drive tier follows: a tool that shrugs is worse than
    // absence (ADR-0029). The headless entry has a bridge for nothing and no
    // storage, so the data tier must not appear at all rather than fail per
    // call.
    await client.close()
    client = await connect({ withStorage: false })
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name)).not.toContain('list_presets')
    expect(tools.map((tool) => tool.name)).toContain('get_app_state')
  })
})

describe('reads answer from the database, not the window', () => {
  it('lists presets with absolute timestamps', async () => {
    const report = await call<{ presets: Array<{ name: string; savedAt: string }> }>('list_presets')
    expect(report.presets).toEqual([
      { name: 'Standard 12in', savedAt: '2026-08-03T14:30:00.000Z' },
      { name: 'Half-height', savedAt: '2026-08-04T09:00:00.000Z' }
    ])
    // Not one round trip to the renderer: a list the window relayed could
    // disagree with the list the database holds, and there is no reason for a
    // read main can answer to leave main.
    expect(drive.calls).toEqual([])
  })

  it('lists saved estimates with the app’s own one-line receipt', async () => {
    const report = await call<{
      estimates: Array<{ id: number; file: string; summary: string }>
    }>('list_saved_estimates')
    expect(report.estimates.map((row) => row.id)).toEqual([7, 4])
    // `estimateSummary` is the function the saved-estimates panel renders, so
    // what Claude reads out and what the person sees are the same sentence.
    expect(report.estimates[0]?.summary).toContain('343 fit')
    expect(report.estimates[0]?.summary).toContain('space-limited')
    expect(report.estimates[1]?.summary).toContain("Doesn't fit")
    expect(drive.calls).toEqual([])
  })

  it('passes a limit through', async () => {
    const report = await call<{ estimates: unknown[] }>('list_saved_estimates', { limit: 1 })
    expect(report.estimates).toHaveLength(1)
  })
})

describe('writes go through the running app', () => {
  it('save_preset saves what is on screen, then reports the database’s list', async () => {
    // The tool sends a NAME and nothing else: the settings being saved are the
    // app's current ones, read renderer-side. A tool that carried a settings
    // blob would be a second source of truth for what "current" means.
    storage.presets.push({ id: 3, name: 'New one', updatedAt: Date.UTC(2026, 7, 5) })
    const report = await call<{ presets: Array<{ name: string }> }>('save_preset', {
      name: 'New one'
    })
    expect(drive.calls).toEqual([{ type: 'save_preset', name: 'New one' }])
    expect(report.presets.map((preset) => preset.name)).toContain('New one')
  })

  it('save_estimate asks the app and answers with the list that now exists', async () => {
    const report = await call<{ estimates: unknown[] }>('save_estimate')
    expect(drive.calls).toEqual([{ type: 'save_estimate' }])
    expect(report.estimates).toHaveLength(ROWS.length)
  })

  it('apply_preset settles and reports where the app stands, version stamped', async () => {
    const outcome = await call<{ state: { version: string } }>('apply_preset', {
      name: 'Half-height'
    })
    expect(drive.calls).toEqual([
      { type: 'apply_preset', name: 'Half-height', units: undefined }
    ])
    // One number, one source: main stamps it, because main is the only process
    // that knows which build this is (ADR-0020, ADR-0027).
    expect(outcome.state.version).toBe('9.9.9+abc1234')
  })
})

describe('restore_estimate', () => {
  it('looks the row up in main and hands the renderer the whole thing', async () => {
    // The renderer restores the same bytes the list reported. Sending only the
    // id would mean a second lookup, and two lookups can disagree — a row
    // saved twice in the same millisecond is exactly the case the store's
    // `id DESC` tiebreak exists for.
    await call('restore_estimate', { id: 4 })
    expect(drive.calls).toEqual([
      { type: 'restore_estimate', row: ROWS[1], units: undefined }
    ])
  })

  it('an unknown id says how to find a real one, and never reaches the app', async () => {
    const message = await callExpectingError('restore_estimate', { id: 999 })
    expect(message).toContain('999')
    expect(message).toContain('list_saved_estimates')
    expect(drive.calls).toEqual([])
  })
})

describe('export_estimate', () => {
  it('returns the text rather than writing a file', async () => {
    const report = await call<{ format: string; suggestedName: string; text: string }>(
      'export_estimate',
      { format: 'summary' }
    )
    expect(drive.calls).toEqual([{ type: 'export_estimate', format: 'summary' }])
    expect(report.format).toBe('summary')
    expect(report.text).toContain('Carton Fit')
    // The name the app's own save dialog would have offered, so a client that
    // does write the file names it the way the app would (ADR-0017 §3).
    expect(report.suggestedName).toBe('bracket-12x12x12in.txt')
  })

  it('refuses a format it does not have rather than improvising one', async () => {
    // The PNG is `capture_view`'s job; the schema is what stops a client
    // asking this tool for one and getting an empty string.
    await callExpectingError('export_estimate', { format: 'png' })
    expect(drive.calls).toEqual([])
  })
})

describe('the report builders', () => {
  it('a row whose blob cannot be read still gets a row', async () => {
    // The user's data. Hiding a row we cannot summarize would be worse than
    // saying so — the same rule `estimateSummary` already follows for the panel.
    const report = savedEstimatesReport([
      { id: 1, fileName: 'x.step', contentHash: '', createdAt: 0, settings: null, result: 'junk' }
    ])
    expect(report.estimates[0]).toMatchObject({ id: 1, summary: 'Saved estimate' })
  })

  it('an unreadable timestamp says so instead of throwing', () => {
    expect(isoTime(Number.NaN)).toBe('unknown')
    expect(isoTime(0)).toBe('1970-01-01T00:00:00.000Z')
  })

  it('an empty database is an empty list, not an error', () => {
    expect(presetsReport([])).toEqual({ presets: [] })
    expect(savedEstimatesReport([])).toEqual({ estimates: [] })
  })
})
