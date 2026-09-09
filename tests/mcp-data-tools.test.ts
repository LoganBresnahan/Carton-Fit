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
  { id: 1, name: 'Standard 12in', updatedAt: Date.UTC(2026, 7, 3, 14, 30), customerId: null },
  { id: 2, name: 'Half-height', updatedAt: Date.UTC(2026, 7, 4, 9, 0), customerId: null }
]

const ROWS: EstimateRow[] = [
  {
    id: 7,
    fileName: 'bracket.step',
    contentHash: 'abc',
    createdAt: Date.UTC(2026, 7, 4, 9, 0),
    customerId: null,
    settings: { ...DEFAULT_SETTINGS },
    // `binding` is 'geometry' | 'weight'; 'space' is the DISPLAY word and no
    // engine ever wrote it into a row. This fixture said 'space' and so kept a
    // dead comparison in `estimateSummary` looking alive for two months
    // (7th dogfood, 2026-09-04) — the assertion below is unchanged, because
    // what a reader SEES was always meant to be "space-limited".
    result: { mode: 'max-quantity', count: 343, binding: 'geometry' }
  },
  {
    id: 4,
    fileName: 'housing.step',
    contentHash: 'def',
    createdAt: Date.UTC(2026, 7, 1, 8, 0),
    customerId: null,
    settings: { ...DEFAULT_SETTINGS },
    result: { mode: 'fit-check', fits: false, binding: 'weight' }
  }
]

/** The window, reduced to what the tier actually needs from it: a record of
 *  what was asked, and a plausible reply. */
function fakeDrive(): DriveBridge & {
  calls: DriveAction[]
  document: string | null
  customer: { id: number; name: string } | null
} {
  const calls: DriveAction[] = []
  const state = buildAppState({
    customer: null,
    settingsAtLaunch: DEFAULT_SETTINGS,
    settingsWritten: [],
    launchSource: 'defaults',
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
    /** The loaded document's hash, as the renderer would answer (ADR-0034 §3). */
    document: null,
    /** Who the window is working for (ADR-0035 §3). */
    customer: null,
    call(action: DriveAction): Promise<DriveResult> {
      calls.push(action)
      switch (action.type) {
        case 'get_document':
          return Promise.resolve({
            kind: 'document',
            contentHash: this.document,
            fileName: this.document === null ? null : 'bracket.step',
            customer: this.customer
          })
        case 'set_customer':
          this.customer = action.id === null ? null : { id: action.id, name: `c${action.id}` }
          return Promise.resolve({
            kind: 'outcome',
            outcome: {
              state: { ...state, customer: this.customer },
              estimate: { available: false, reason: 'not under test here' }
            }
          })
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

/** The house-plus-active rule the real stores apply (ADR-0035 §3). */
function forCustomer<T extends { customerId: number | null }>(
  rows: T[],
  scope: { activeId: number | null } | undefined
): T[] {
  if (scope === undefined) return rows
  return rows.filter((r) => r.customerId === null || r.customerId === scope.activeId)
}

const CUSTOMERS = [
  { id: 1, name: 'Acme', createdAt: 1 },
  { id: 2, name: 'Beta', createdAt: 2 }
]

function fakeStorage(): ToolStorage & { presets: ConfigurationSummary[] } {
  const presets = [...PRESETS]
  return {
    presets,
    listConfigurations: (customer) => forCustomer(presets, customer),
    recentEstimates: (limit, customer) => forCustomer(ROWS, customer).slice(0, limit ?? 50),
    estimatesForDocument: (hash, limit, customer) =>
      forCustomer(
        ROWS.filter((row) => row.contentHash === hash),
        customer
      ).slice(0, limit ?? 50),
    estimateById: (id) => ROWS.find((row) => row.id === id) ?? null,
    listCustomers: () => CUSTOMERS
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
  it('adds nine data tools to the drive tier', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'apply_preset',
      'capture_view',
      'estimate',
      'export_estimate',
      'get_app_state',
      'get_estimate',
      'inspect_model',
      'list_customers',
      'list_presets',
      'list_saved_estimates',
      'load_model',
      'restore_estimate',
      'save_estimate',
      'save_preset',
      'set_customer',
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
    // ADR-0034 §4 gave the PANEL a Delete for saved estimates and kept it
    // off the wire; the list tool's description carries that promise, and
    // this pins the sentence beside the absence.
    const list = tools.find((tool) => tool.name === 'list_saved_estimates')
    expect(list?.description).toMatch(/cannot be deleted or replaced from here/)
  })

  it('warns about surviving overrides on apply_preset, where a client meets them', async () => {
    // The 4th dogfood read this behaviour off a live reply and called it
    // silent. It was not — overriddenKinds and countedWeightFrom were both in
    // the payload — but the SENTENCE explaining it lived on save_preset, which
    // a client that only ever applies a preset never reads. ADR-0029's rule is
    // that a surprise is announced where a client meets it, so both tools now
    // carry it.
    const { tools } = await client.listTools()
    const apply = tools.find((tool) => tool.name === 'apply_preset')
    const save = tools.find((tool) => tool.name === 'save_preset')
    for (const description of [apply?.description, save?.description]) {
      expect(description).toMatch(/override/i)
      expect(description).toMatch(/unit part/i)
    }
    // And the reply's own fields are named, so the warning points somewhere.
    expect(apply?.description).toMatch(/overriddenKinds/)
  })

  it('does not offer inspect_model a weight unit it cannot use', async () => {
    // inspect_model reports geometry and weighs nothing, but took, resolved
    // and echoed a weight unit — a parameter that appeared to do something on
    // the one call you would use to sanity-check a weight (4th dogfood).
    const { tools } = await client.listTools()
    const inspect = tools.find((tool) => tool.name === 'inspect_model')
    const units = (inspect?.inputSchema.properties as Record<string, { properties?: object }>)
      .outputUnits
    expect(Object.keys(units.properties ?? {})).toEqual(['length'])
    expect(inspect?.description).toMatch(/nothing here is weighed/i)
  })

  it('still answers when a client sends the weight unit it used to accept', async () => {
    // Narrowing an optional input must not turn old callers into failures: an
    // unknown key is stripped, not refused. That is what keeps this a minor
    // change under ADR-0020 rather than a break.
    const result = await client.callTool({
      name: 'inspect_model',
      arguments: {
        path: join(__dirname, '..', 'samples', 'cube-10x10.stp'),
        outputUnits: { length: 'in', weight: 'lb' }
      }
    })
    expect(result.isError ?? false).toBe(false)
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

describe('the drive tools say what they persist', () => {
  it('discloses that the inputs survive the session, on both tools that touch them', async () => {
    // 9th dogfood, and the fifth sighting of inherited state: `save_preset` and
    // `save_estimate` both announce that they write, while the INPUTS were
    // written silently — the only write on this surface no description
    // mentioned. A reader who trusts what they find derives against inputs a
    // previous session chose, and the hazard is not hypothetical: an inherited
    // density of 2.70 instead of 7.85 returns the same COUNT on the reference
    // plate for an entirely different reason.
    //
    // Lives with the DRIVE tools, not the goldens: these two are registered
    // only when a drive is present (ADR-0029's tiers), so the goldens' v1-only
    // server cannot see them.
    const { tools } = await client.listTools()
    const setInputs = tools.find((tool) => tool.name === 'set_inputs')
    const appState = tools.find((tool) => tool.name === 'get_app_state')
    // The AFFIRMATIVE claim, not the word: both descriptions also contain
    // "do NOT persist" about the file-scoped half, so a bare /persist/ passed
    // even with the disclosure deleted. Caught by mutation, which is the only
    // thing that could have caught it.
    expect(setInputs?.description).toMatch(/inputs persist between/i)
    expect(appState?.description).toMatch(/inputs persist between/i)
    // And the exception, which is what keeps the disclosure honest: file-scoped
    // state does NOT survive a load.
    expect(setInputs?.description).toMatch(/cleared on load_model/)
    expect(appState?.description).toMatch(/cleared whenever a file loads/)
    // 10th dogfood: the same reply carries a cap in GRAMS and a displayUnits
    // saying the person reads pounds. Both true, and the default is documented
    // — but station 0's whole job is checking what you inherited, so the reader
    // most likely to be burned is the one who did not know to ask for units.
    // Said on the tool rather than changed in the defaults: one tool defaulting
    // differently from the rest trades one surprise for another.
    expect(appState?.description).toMatch(/displayUnits/)
    expect(appState?.description).toMatch(/output units/i)
  })
})

describe('reads answer from the database, not the window', () => {
  it('lists presets with absolute timestamps', async () => {
    const report = await call<{
      customer: string
      presets: Array<{ name: string; savedAt: string; customer: string | null }>
    }>('list_presets')
    expect(report.customer).toBe('active')
    expect(report.presets).toEqual([
      { name: 'Standard 12in', savedAt: '2026-08-03T14:30:00.000Z', customer: null },
      { name: 'Half-height', savedAt: '2026-08-04T09:00:00.000Z', customer: null }
    ])
    // Not a round trip to the renderer for the ROWS: a list the window relayed
    // could disagree with the list the database holds. The one question asked
    // is who the window is working for (ADR-0035 §4).
    expect(drive.calls).toEqual([{ type: 'get_document' }])
  })

  // ADR-0035 §4: the customer axis, on both lists, with the tag named per row.
  describe('the customer axis', () => {
    beforeEach(() => {
      storage.presets.push({ id: 9, name: 'Acme box', updatedAt: Date.UTC(2026, 7, 6), customerId: 1 })
      storage.presets.push({ id: 10, name: 'Beta box', updatedAt: Date.UTC(2026, 7, 6), customerId: 2 })
    })

    it('list_presets: house plus the active customer by default, named per row', async () => {
      drive.customer = { id: 1, name: 'Acme' }
      const report = await call<{
        customer: string
        presets: Array<{ name: string; customer: string | null }>
      }>('list_presets')
      expect(report.customer).toBe('active')
      expect(report.presets.map((p) => [p.name, p.customer])).toEqual([
        ['Standard 12in', null],
        ['Half-height', null],
        ['Acme box', 'Acme']
      ])
    })

    it('list_presets: "all" is every customer’s, and says so', async () => {
      drive.customer = { id: 1, name: 'Acme' }
      const report = await call<{ customer: string; presets: Array<{ name: string }> }>(
        'list_presets',
        { customer: 'all' }
      )
      expect(report.customer).toBe('all')
      expect(report.presets.map((p) => p.name)).toContain('Beta box')
    })

    it('house active means house only', async () => {
      const report = await call<{ presets: Array<{ name: string }> }>('list_presets')
      expect(report.presets.map((p) => p.name)).toEqual(['Standard 12in', 'Half-height'])
    })

    it('list_saved_estimates composes the two axes independently', async () => {
      drive.document = 'abc'
      drive.customer = { id: 2, name: 'Beta' }
      const report = await call<{
        scope: string
        customer: string
        estimates: Array<{ id: number; customer: string | null }>
      }>('list_saved_estimates', { scope: 'all', customer: 'active' })
      expect(report).toMatchObject({ scope: 'all', customer: 'active' })
      // Every document, but only house + Beta rows: the fixtures are all house.
      expect(report.estimates.map((r) => [r.id, r.customer])).toEqual([
        [7, null],
        [4, null]
      ])
    })

    it('list_customers names them and who is active', async () => {
      drive.customer = { id: 2, name: 'Beta' }
      const report = await call<{ customers: unknown[]; active: unknown }>('list_customers')
      expect(report).toEqual({
        customers: [
          { id: 1, name: 'Acme' },
          { id: 2, name: 'Beta' }
        ],
        active: { id: 2, name: 'Beta' }
      })
    })

    it('set_customer goes through the window and answers with the state', async () => {
      const report = await call<{ state: { customer: unknown; version: string } }>(
        'set_customer',
        { id: 1 }
      )
      expect(drive.calls).toEqual([{ type: 'set_customer', id: 1, units: undefined }])
      expect(report.state.customer).toEqual({ id: 1, name: 'c1' })
      expect(report.state.version).toBe('9.9.9+abc1234')
    })

    it('publishes no way to create a customer', async () => {
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name).filter((n) => /create|add|new/.test(n))).toEqual([])
      const list = tools.find((t) => t.name === 'list_customers')
      expect(list?.description).toMatch(/person’s act/)
    })
  })

  it('lists saved estimates with the app’s own one-line receipt', async () => {
    const report = await call<{
      scope: string
      estimates: Array<{ id: number; file: string; summary: string }>
    }>('list_saved_estimates')
    expect(report.estimates.map((row) => row.id)).toEqual([7, 4])
    // Nothing loaded: nothing to scope to, and the reply says so.
    expect(report.scope).toBe('all')
    // `estimateSummary` is the function the saved-estimates panel renders, so
    // what Claude reads out and what the person sees are the same sentence.
    expect(report.estimates[0]?.summary).toContain('343 fit')
    expect(report.estimates[0]?.summary).toContain('space-limited')
    expect(report.estimates[1]?.summary).toContain("Doesn't fit")
    // The one thing it asks the window is which document is loaded.
    expect(drive.calls).toEqual([{ type: 'get_document' }])
  })

  // ADR-0034 §3 / ADR-0029 amendment 8: the list follows the panel's rule.
  describe('scopes to the loaded document', () => {
    type Report = { scope: string; estimates: Array<{ id: number }> }

    it('by default, when a file is loaded', async () => {
      drive.document = 'abc'
      const report = await call<Report>('list_saved_estimates')
      expect(report.scope).toBe('model')
      expect(report.estimates.map((row) => row.id)).toEqual([7])
    })

    it('widens to every part on request', async () => {
      drive.document = 'abc'
      const report = await call<Report>('list_saved_estimates', { scope: 'all' })
      expect(report.scope).toBe('all')
      expect(report.estimates.map((row) => row.id)).toEqual([7, 4])
    })

    it('asked for the model with nothing loaded, answers all and says so', async () => {
      const report = await call<Report>('list_saved_estimates', { scope: 'model' })
      expect(report.scope).toBe('all')
      expect(report.estimates).toHaveLength(2)
    })

    it('a document with no receipts is an empty scoped list, not everything', async () => {
      drive.document = 'never-saved'
      const report = await call<Report>('list_saved_estimates')
      expect(report).toEqual({ scope: 'model', customer: 'active', estimates: [] })
    })

    it('the list a save lands in is the document’s', async () => {
      drive.document = 'abc'
      const report = await call<Report>('save_estimate')
      expect(report.scope).toBe('model')
      expect(report.estimates.map((row) => row.id)).toEqual([7])
    })
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
    storage.presets.push({
      id: 3,
      name: 'New one',
      updatedAt: Date.UTC(2026, 7, 5),
      customerId: null
    })
    const report = await call<{ presets: Array<{ name: string }> }>('save_preset', {
      name: 'New one'
    })
    // The write, then the one question that scopes the reply (ADR-0035 §4).
    expect(drive.calls).toEqual([{ type: 'save_preset', name: 'New one' }, { type: 'get_document' }])
    expect(report.presets.map((preset) => preset.name)).toContain('New one')
  })

  it('save_estimate asks the app and answers with the list that now exists', async () => {
    const report = await call<{ scope: string; estimates: unknown[] }>('save_estimate')
    // The write, then the one question that scopes the reply (ADR-0034 §3).
    expect(drive.calls).toEqual([{ type: 'save_estimate' }, { type: 'get_document' }])
    // The fake window has nothing loaded, so the reply is honest about that:
    // every row, and `scope` says so. With a document it is the document's.
    expect(report.scope).toBe('all')
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
      {
        id: 1,
        fileName: 'x.step',
        contentHash: '',
        createdAt: 0,
        settings: null,
        result: 'junk',
        customerId: null
      }
    ])
    expect(report.estimates[0]).toMatchObject({ id: 1, summary: 'Saved estimate' })
  })

  it('an unreadable timestamp says so instead of throwing', () => {
    expect(isoTime(Number.NaN)).toBe('unknown')
    expect(isoTime(0)).toBe('1970-01-01T00:00:00.000Z')
  })

  it('an empty database is an empty list, not an error', () => {
    expect(presetsReport([])).toEqual({ customer: 'all', presets: [] })
    expect(savedEstimatesReport([])).toEqual({ scope: 'all', customer: 'all', estimates: [] })
    expect(savedEstimatesReport([], 'model', 'active')).toEqual({
      scope: 'model',
      customer: 'active',
      estimates: []
    })
  })
})
