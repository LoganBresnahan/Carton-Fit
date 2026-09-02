import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { readModel } from '../occt/ingest'
import type { OcctWasmContext } from '../occt/wasmPath'
import type { DriveBridge, DriveOutcome, EstimateAvailability } from '../../shared/mcpDrive'
import { estimateParts, EstimateInputError, type EstimateInput } from './estimate'
import type { SetInputsRequest } from './inputs'
import { inspectParts } from './inspect'
import { toG } from './wire'
import {
  captureViewInput,
  driveOutcomeOutput,
  estimateInput,
  estimateOutput,
  getAppStateInput,
  getEstimateInput,
  inspectInput,
  inspectOutput,
  loadModelInput,
  setInputsInput,
  setPartWeightInput
} from './schemas'

// The v1 tool surface (ADR-0029). Two tools, both stateless, both answering
// about a file on disk with no window involved.
//
// This module is a REGISTRATION LAYER and nothing else: it owns no geometry, no
// packing, no unit math, and no wording. Everything it hands back came from the
// same modules the app's own screen reads. That is what makes the goldens a
// meaningful third consumer (ADR-0005) rather than a test of a parallel
// implementation.
//
// The transport is not decided here either — `createCartonFitServer` returns a
// server an in-memory transport can drive in tests today and a stdio transport
// will drive from the packaged app in phase 3.

/**
 * Tool descriptions are contract, not documentation.
 *
 * They are the only mechanism that reaches an AI client's reasoning BEFORE it
 * calls anything, so anything the app refuses to do has to be said here or the
 * client will improvise it. ADR-0028 is the case that forced this: a bulk-dump
 * count has no deterministic answer, and the motivating transcript is a
 * recording of a model producing three different confident ones. Absence of a
 * bulk tool does not prevent that — a client with a volume and a packing
 * fraction will happily multiply. Saying so does.
 */
const BULK_GUIDANCE =
  'For parts POURED IN LOOSE rather than placed, this count is a ceiling, not an ' +
  'estimate: a random pile cannot beat an ordered stack. There is no deterministic ' +
  'answer for a loose dump — do not derive one by applying a packing fraction to this ' +
  'number. Report the ceiling and recommend a fill trial: dump a counted sample, ' +
  'measure the height, extrapolate (ADR-0028).'

export interface ServerOptions {
  /** Where the app's files are, for locating the OCCT wasm. */
  occt: OcctWasmContext
  /** App version, reported in the handshake. */
  version: string
  /** The route to the RUNNING APP's renderer, present only when the server is
   *  hosted inside the app (--mcp-server). With it, the v2 drive tools are
   *  registered; without it — the headless entry — they are deliberately
   *  ABSENT rather than present-and-shrugging (ADR-0029: a tool that shrugs is
   *  worse than absence). */
  drive?: DriveBridge
}

/** Turn any failure into the message an AI client will read out loud. Input
 *  errors say what to fix; anything else keeps its own message, because a
 *  swallowed cause here surfaces as "the tool didn't work" to someone who
 *  cannot see this process. */
function toolError(err: unknown): CallToolResult {
  const message =
    err instanceof EstimateInputError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err)
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** A successful reply. The report goes back BOTH as structured content — which
 *  the SDK validates against the tool's output schema, so a dropped
 *  qualification fails the call — and as text, because a client that does not
 *  read structured content must not silently receive less. */
function toolOk(report: object): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
    structuredContent: report as Record<string, unknown>
  }
}

export function createCartonFitServer(options: ServerOptions): McpServer {
  const server = new McpServer(
    { name: 'carton-fit', version: options.version },
    {
      instructions:
        'Carton Fit measures CAD parts and computes how they pack into a shipping carton. ' +
        'It supplies the numbers; the judgment — materials, handling, whether a plan is ' +
        'sensible — is yours. Every answer carries its own qualifications: read them, and ' +
        'pass them on. A count from this engine is a placement that was actually found, ' +
        'never a proof that no better one exists.'
    }
  )

  server.registerTool(
    'inspect_model',
    {
      title: 'Inspect a CAD model',
      description:
        'Read a STEP file and report its geometry, grouped by part kind: how many of each, ' +
        'bounding box, enclosed volume, and whether each mesh is closed. Call this before ' +
        'estimating with a density — an open mesh makes a density-derived weight wrong ' +
        'rather than approximate.',
      inputSchema: inspectInput,
      outputSchema: inspectOutput
    },
    async ({ path, outputUnits }) => {
      try {
        const parts = await readModel(path, options.occt)
        return toolOk(inspectParts(path, parts, outputUnits))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  if (options.drive !== undefined) {
    registerDriveTools(server, options.drive, options.version)
  }

  server.registerTool(
    'estimate',
    {
      title: 'Estimate a packing',
      description:
        'Pack the parts in a STEP file into a carton and report the answer with its ' +
        'qualifications: the verdict or count, which hard constraint was binding (space or ' +
        'weight), how full the carton is, and — for a count — a rigorous upper bound beside ' +
        'it. Placement is heuristic: a positive result is a concrete arrangement that was ' +
        'found, a count is a floor, and neither is a proof that nothing better exists. ' +
        BULK_GUIDANCE,
      inputSchema: estimateInput,
      outputSchema: estimateOutput
    },
    async ({ path, outputUnits, ...rest }) => {
      try {
        const parts = await readModel(path, options.occt)
        const input = { ...rest, outputUnits } as EstimateInput
        return toolOk(estimateParts(parts, input))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  return server
}

/**
 * The v2 DRIVE tier (ADR-0029): tools that read and write the running app.
 *
 * Thin by decree — every handler forwards to the renderer's drive host over
 * the bridge, where the store's own actions do the work and the settle
 * protocol (mcp/settle.ts in the renderer) holds the reply until the estimate
 * reflects the change. The version is stamped into every state reply HERE,
 * because main is the one process that knows it — one number, one source.
 */
function registerDriveTools(server: McpServer, drive: DriveBridge, version: string): void {
  /** A drive outcome with the version stamped in, shaped for `driveOutcomeOutput`. */
  function stamped(outcome: DriveOutcome): { state: object; estimate: EstimateAvailability } {
    return { ...outcome, state: { ...outcome.state, version } }
  }

  const SETTLED =
    'The reply is not sent until the app has re-estimated for this change, so the estimate ' +
    'in it is never stale.'

  server.registerTool(
    'load_model',
    {
      title: 'Load a model into the app',
      description:
        'Load a CAD file (.step, .stp, .stl) into the running Carton Fit window, exactly as if ' +
        'it were dropped there — the person at the screen sees what you loaded. ' +
        SETTLED,
      inputSchema: loadModelInput,
      outputSchema: driveOutcomeOutput
    },
    async ({ path, outputUnits }) => {
      try {
        const bytes = await readFile(path).catch((err: unknown) => {
          throw new Error(
            `could not read ${path}: ${err instanceof Error ? err.message : String(err)}`
          )
        })
        const result = await drive.call({
          type: 'load_model',
          name: basename(path),
          bytes: new Uint8Array(bytes),
          units: outputUnits
        })
        if (result.kind !== 'outcome') throw new Error('unexpected drive reply')
        return toolOk(stamped(result.outcome))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'set_inputs',
    {
      title: 'Set the app’s packing inputs',
      description:
        'Change any of the running app’s inputs — carton, clearances, weight cap, weight ' +
        'source, mode, tier, display units — as a PARTIAL update: anything omitted keeps its ' +
        'current value. Auto-run recomputes immediately, and the change lands on the app’s ' +
        'undo stack like a person’s edit (one call = one Ctrl+Z step). ' +
        SETTLED,
      inputSchema: setInputsInput,
      outputSchema: driveOutcomeOutput
    },
    async ({ outputUnits, unitPart, ...input }) => {
      try {
        const result = await drive.call({
          type: 'set_inputs',
          input: input as SetInputsRequest,
          unitPart,
          units: outputUnits
        })
        if (result.kind !== 'outcome') throw new Error('unexpected drive reply')
        return toolOk(stamped(result.outcome))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'set_part_weight',
    {
      title: 'Override one part kind’s weight',
      description:
        'Set the weight of every part of one kind by hand (ADR-0018), overriding the direct or ' +
        'density-derived weight — use it when someone has actually weighed the part, which also ' +
        'retires the open-mesh warning for that kind. Pass null to clear. ' +
        SETTLED,
      inputSchema: setPartWeightInput,
      outputSchema: driveOutcomeOutput
    },
    async ({ kind, weight, outputUnits }) => {
      try {
        const result = await drive.call({
          type: 'set_part_weight',
          partKind: kind,
          grams: weight === null ? null : toG(weight),
          units: outputUnits
        })
        if (result.kind !== 'outcome') throw new Error('unexpected drive reply')
        return toolOk(stamped(result.outcome))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'get_estimate',
    {
      title: 'Read the app’s current estimate',
      description:
        'The estimate the running app is showing right now, with every qualification the screen ' +
        'carries: binding constraint, upper bound beside the count, open-mesh and truncation ' +
        'warnings. If a recompute is in flight, this waits for it rather than answering from ' +
        'the previous inputs. ' +
        BULK_GUIDANCE,
      inputSchema: getEstimateInput,
      outputSchema: estimateOutput
    },
    async ({ outputUnits }) => {
      try {
        const result = await drive.call({ type: 'get_estimate', units: outputUnits })
        if (result.kind !== 'estimate') throw new Error('unexpected drive reply')
        if (!result.estimate.available) {
          return {
            content: [{ type: 'text', text: result.estimate.reason }],
            isError: true
          }
        }
        return toolOk(result.estimate.report)
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'get_app_state',
    {
      title: 'Read where the app stands',
      description:
        'The running app’s state: which file is loaded, every input as the app understands it, ' +
        'mode, tier, display units, and this build’s version. Does not wait for an in-flight ' +
        'recompute — the estimate field says one is running instead.',
      inputSchema: getAppStateInput,
      outputSchema: driveOutcomeOutput
    },
    async ({ outputUnits }) => {
      try {
        const result = await drive.call({ type: 'get_app_state', units: outputUnits })
        if (result.kind !== 'outcome') throw new Error('unexpected drive reply')
        return toolOk(stamped(result.outcome))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'capture_view',
    {
      title: 'See the app’s 3D view',
      description:
        'A PNG of the running app’s 3D viewport — the packed carton once an estimate exists, or ' +
        'the model. This is the same scene the person at the window sees; use it to check an ' +
        'arrangement rather than imagining one.',
      inputSchema: captureViewInput
    },
    async ({ view }) => {
      try {
        const result = await drive.call({ type: 'capture_view', view })
        if (result.kind !== 'image') throw new Error('unexpected drive reply')
        return {
          content: [{ type: 'image', data: result.pngBase64, mimeType: 'image/png' }]
        }
      } catch (err) {
        return toolError(err)
      }
    }
  )
}
