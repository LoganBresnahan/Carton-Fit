import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createCartonFitServer } from '../src/main/mcp/server'
import * as schemas from '../src/main/mcp/schemas'
import { JSON_SCHEMA_DIALECT } from '../src/main/mcp/schemas'
import { buildAppState } from '../src/main/mcp/appState'
import type { ToolStorage } from '../src/main/mcp/data'
import type { OcctWasmContext } from '../src/main/occt/wasmPath'
import { DEFAULT_SETTINGS } from '../src/renderer/src/packing/settings'
import type { DriveBridge, DriveResult } from '../src/shared/mcpDrive'

// THE DIALECT ON THE WIRE (ADR-0029, dogfood finding of 2026-09-02).
//
// Every other MCP test in this suite talks to the server through the SDK's
// own client, and that client accepts a draft-07 schema without complaint —
// which is exactly why 763 green tests shipped a server that no current Claude
// Desktop could call: the handshake succeeded, all fifteen tools listed, and
// every call was rejected client-side for declaring "an unsupported dialect
// (draft-07); the default validator supports 2020-12 only". The SDK stamps
// draft-07 on everything it converts and offers no switch. The fix is one
// label (`wire()` in schemas.ts); this file is the test the SDK client could
// never be, because it reads the label instead of tolerating it.
//
// Two things are pinned, and the second is what keeps the first honest:
//   1. every tool's published input AND output schema declares 2020-12;
//   2. for every schema shape on this surface, the draft-07 and 2020-12
//      bodies zod emits are IDENTICAL — so the label change is exactly a label
//      change. A future schema built from a construct where the two dialects
//      genuinely differ fails here, which is the moment `wire()` would need to
//      become a real conversion rather than a rename.

const CONTEXT: OcctWasmContext = { appPath: join(__dirname, '..'), isPackaged: false }

/** The smallest bridge that lets every drive/data tool REGISTER. Nothing here
 *  is called: tools/list is the whole conversation. */
function inertDrive(): DriveBridge {
  const state = buildAppState({
    fileName: null,
    parts: [],
    settings: DEFAULT_SETTINGS,
    unitPartName: null,
    overrides: {},
    packStatus: 'idle',
    view: 'packed'
  })
  return {
    call: (): Promise<DriveResult> =>
      Promise.resolve({
        kind: 'outcome',
        outcome: { state, estimate: { available: false, reason: 'not under test' } }
      })
  }
}

const inertStorage: ToolStorage = {
  listConfigurations: () => [],
  recentEstimates: () => [],
  estimateById: () => null
}

let client: Client

beforeEach(async () => {
  const server = createCartonFitServer({
    occt: CONTEXT,
    version: '0.0.0-test',
    drive: inertDrive(),
    storage: inertStorage
  })
  const [serverEnd, clientEnd] = InMemoryTransport.createLinkedPair()
  await server.connect(serverEnd)
  client = new Client({ name: 'dialect-test', version: '0' })
  await client.connect(clientEnd)
})

afterEach(async () => {
  await client.close()
})

type Published = { $schema?: unknown } & Record<string, unknown>

describe('every published tool schema declares JSON Schema 2020-12', () => {
  it('on the FULL surface — all fifteen tools, input and output alike', async () => {
    const { tools } = await client.listTools()
    // The count is asserted so a tool registered without `wire()` cannot hide
    // by simply not being here.
    expect(tools).toHaveLength(15)
    for (const tool of tools) {
      const input = tool.inputSchema as Published
      expect(input.$schema, `${tool.name} input`).toBe(JSON_SCHEMA_DIALECT)
      if (tool.outputSchema !== undefined) {
        const output = tool.outputSchema as Published
        expect(output.$schema, `${tool.name} output`).toBe(JSON_SCHEMA_DIALECT)
      }
    }
  })

  it('and the string "draft-07" appears nowhere in tools/list', async () => {
    // Belt and braces against a nested `$schema` — a validator that rejects
    // the dialect rejects it wherever it is declared.
    const { tools } = await client.listTools()
    expect(JSON.stringify(tools)).not.toContain('draft-07')
  })
})

describe('the relabel is exactly a relabel', () => {
  /** Every exported raw shape in schemas.ts — a plain object whose values are
   *  all zod schemas. Enumerated rather than listed so a shape added tomorrow
   *  is covered the day it lands. */
  const shapes = Object.entries(schemas).filter(([, value]) => {
    if (typeof value !== 'object' || value === null || '_zod' in value) return false
    const fields = Object.values(value as Record<string, unknown>)
    return fields.length > 0 && fields.every((f) => typeof f === 'object' && f !== null && '_zod' in f)
  }) as Array<[string, z.ZodRawShape]>

  it('found the shapes it means to check', () => {
    expect(shapes.map(([name]) => name)).toEqual(
      expect.arrayContaining(['estimateInput', 'estimateOutput', 'inspectOutput', 'driveOutcomeOutput'])
    )
  })

  it.each(shapes)('%s: draft-07 and 2020-12 bodies are identical', (_name, shape) => {
    const strip = (schema: unknown): unknown => {
      const copy = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>
      delete copy['$schema']
      return copy
    }
    for (const io of ['input', 'output'] as const) {
      const d07 = z.toJSONSchema(z.object(shape), { target: 'draft-07', io })
      const d20 = z.toJSONSchema(z.object(shape), { target: 'draft-2020-12', io })
      expect(strip(d07)).toEqual(strip(d20))
    }
  })
})
