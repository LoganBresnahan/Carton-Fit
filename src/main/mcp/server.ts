import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { readModel } from '../occt/ingest'
import type { OcctWasmContext } from '../occt/wasmPath'
import { estimateParts, EstimateInputError, type EstimateInput } from './estimate'
import { inspectParts } from './inspect'
import { estimateInput, estimateOutput, inspectInput, inspectOutput } from './schemas'

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
