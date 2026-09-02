import { z } from 'zod'

// The wire SCHEMAS (ADR-0029, slices `explicit-units-wire-contract` and
// `qualified-response-schema`). Declared with zod because that is what the MCP
// SDK's `registerTool` consumes; the SDK publishes them to the client as JSON
// Schema, which is how an AI client learns what a call must contain.
//
// TWO PROPERTIES ARE LOAD-BEARING HERE, AND BOTH ARE ABOUT REQUIREDNESS.
//
// 1. Every unit is required, nowhere is a unit inferred. `LengthValue` has no
//    default: a caller that means millimetres must say so. The alternative —
//    defaulting to mm — is a silent inch-for-millimetre error the day someone
//    types inches, and the reply would be self-consistent while being wrong.
//
// 2. Every qualification is required IN THE OUTPUT SCHEMA. The SDK validates a
//    tool's structured result against its output schema, so a hedge that went
//    missing is a failed call rather than a confident answer — the mechanical
//    enforcement of ADR-0029's "one that never received them is our bug".
//    Values that may genuinely not exist are modelled as a discriminated
//    `{known:false, reason}` / `{known:true, …}` rather than as optional
//    fields, so "there is no upper bound" and "this build forgot the upper
//    bound" stop looking identical on the wire.
//
// Changing anything here is an ADR-0020 surface change: additive is a minor
// version, anything a caller could be relying on is a major.

/**
 * The JSON Schema dialect every tool declares on the wire.
 *
 * Found by dogfooding on the first Store Claude Desktop (2026-09-02): the
 * handshake succeeded, all 15 tools listed, and every call was rejected before
 * it reached the app — "JSON Schema declares an unsupported dialect
 * (draft-07)… the default validator supports 2020-12 only". The MCP SDK (1.x,
 * latest included) stamps draft-07 on every schema it converts and exposes no
 * option to change it, while current clients validate 2020-12 only
 * (typescript-sdk#2532, SEP-1613 makes 2020-12 the protocol default). Our own
 * suite was green because the SDK's *client* still accepts draft-07 — which is
 * why `tests/mcp-schema-dialect.test.ts` now pins the label directly.
 */
export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema'

/**
 * A tool schema as it must be HANDED to `registerTool`.
 *
 * The SDK accepts a raw shape or an object instance. A raw shape it rebuilds
 * into a fresh `z.object` — discarding any metadata — and then converts with
 * zod's `toJSONSchema` at the SDK's hardcoded draft-7 target. An object
 * INSTANCE passes through untouched, and zod lets root metadata override the
 * `$schema` it would otherwise stamp. So this is the whole fix: same shape,
 * same validation (the SDK parses through this very instance), one label.
 *
 * It is a label change and nothing more, and that was measured rather than
 * assumed: for every schema on this surface the draft-07 and 2020-12 bodies
 * zod emits are byte-identical. If a future schema uses a construct where the
 * two dialects genuinely differ, the dialect test's body comparison is what
 * says so.
 */
export function wire<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).meta({ $schema: JSON_SCHEMA_DIALECT })
}

export const lengthUnit = z.enum(['mm', 'in'])
export const weightUnit = z.enum(['g', 'kg', 'lb'])
export const volumeUnit = z.enum(['mm3', 'in3'])

export const lengthValue = z
  .object({ value: z.number(), unit: lengthUnit })
  .describe('A length. The unit is required — nothing here is assumed to be millimetres.')

export const weightValue = z
  .object({ value: z.number(), unit: weightUnit })
  .describe('A weight. Weight units are independent of length units (ADR-0024).')

export const volumeValue = z.object({ value: z.number(), unit: volumeUnit })

export const dimensionsValue = z
  .object({ x: z.number(), y: z.number(), z: z.number(), unit: lengthUnit })
  .describe('A box in the carton’s own axes. The axes are not interchangeable.')

export const outputUnits = z.object({ length: lengthUnit, weight: weightUnit })

export const outputUnitsInput = z
  .object({ length: lengthUnit.optional(), weight: weightUnit.optional() })
  .optional()
  .describe('Units to answer in. Length and weight are chosen separately; both default to the app’s internal units, mm and g.')

// --- inspect_model --------------------------------------------------------

export const inspectInput = {
  path: z.string().describe('Absolute path to a STEP file (.step or .stp) on this machine.'),
  outputUnits: outputUnitsInput
}

const knownFalse = z.object({ known: z.literal(false), reason: z.string() })

export const inspectOutput = {
  file: z.object({ path: z.string(), name: z.string() }),
  totals: z.object({ parts: z.number(), kinds: z.number(), triangles: z.number() }),
  boundingBox: dimensionsValue,
  kinds: z.array(
    z.object({
      kind: z.string(),
      count: z.number(),
      triangles: z.number(),
      size: dimensionsValue,
      volume: volumeValue,
      closedMesh: z.boolean(),
      instancesAlike: z.boolean()
    })
  ),
  qualifications: z.object({
    openMesh: z.union([
      z.object({ affected: z.literal(false) }),
      z.object({ affected: z.literal(true), kinds: z.array(z.string()), note: z.string() })
    ]),
    mixedInstances: z.union([
      z.object({ affected: z.literal(false) }),
      z.object({ affected: z.literal(true), kinds: z.array(z.string()), note: z.string() })
    ])
  }),
  units: outputUnits
}

// --- estimate -------------------------------------------------------------

export const estimateInput = {
  path: z.string().describe('Absolute path to a STEP file (.step or .stp) on this machine.'),
  mode: z
    .enum(['fit-check', 'max-quantity'])
    .describe(
      'fit-check: do all the parts in the file fit this carton? max-quantity: how many copies of one part fit?'
    ),
  tier: z
    .enum(['fast', 'thorough'])
    .describe(
      'fast: axis-aligned bounding boxes. thorough: searches part orientations too — slower, never worse.'
    ),
  carton: z.object({
    dimensions: dimensionsValue,
    measured: z
      .enum(['inner', 'outer'])
      .describe('Inside dimensions are what a part must fit into; outer needs wallThickness.'),
    wallThickness: lengthValue.optional()
  }),
  clearances: z
    .object({ betweenParts: lengthValue.optional(), wall: lengthValue.optional() })
    .optional()
    .describe('Minimum gaps. Both default to zero.'),
  maxWeight: weightValue.optional().describe('Hard cap on packed weight. Defaults to 35 lb.'),
  weight: z
    .object({
      partWeight: weightValue.optional().describe('Weight of one part.'),
      densityGPerCm3: z
        .number()
        .optional()
        .describe(
          'Material density; weight = density × mesh volume. Wrong, not approximate, on a mesh that is not closed — check inspect_model first.'
        )
    })
    .optional()
    .describe('Give a part weight OR a density, or neither for a space-only answer.'),
  overrides: z
    .array(z.object({ kind: z.string(), weight: weightValue }))
    .optional()
    .describe('Per-kind weight overrides, keyed by the kind names inspect_model reports.'),
  unitPart: z
    .string()
    .optional()
    .describe('max-quantity only: which part to replicate. Omitted fuses the whole file into one unit.'),
  outputUnits: outputUnitsInput
}

export const heuristicQualification = z.object({ heuristic: z.boolean(), note: z.string() })

export const estimateOutput = {
  request: z.object({
    mode: z.enum(['fit-check', 'max-quantity']),
    tier: z.enum(['fast', 'thorough', 'nesting']),
    innerCarton: dimensionsValue,
    clearances: z.object({ betweenParts: lengthValue, wall: lengthValue }),
    maxWeight: weightValue,
    packedWeight: weightValue
  }),
  outcome: z.union([
    z.object({
      mode: z.literal('fit-check'),
      fits: z.boolean(),
      placed: z.number(),
      total: z.number(),
      unplaced: z.array(z.string()),
      largestFreeSpace: z.union([
        z.object({ known: z.literal(true), size: dimensionsValue }),
        knownFalse
      ]),
      smallestUnplaced: z.union([
        z.object({ known: z.literal(true), name: z.string(), size: dimensionsValue }),
        knownFalse
      ])
    }),
    z.object({
      mode: z.literal('max-quantity'),
      count: z.number(),
      upperBound: z.union([z.object({ known: z.literal(true), count: z.number() }), knownFalse]),
      layout: z.union([
        z.object({ complete: z.literal(true) }),
        z.object({
          complete: z.literal(false),
          shown: z.number(),
          counted: z.number(),
          note: z.string()
        })
      ])
    })
  ]),
  binding: z.object({ constraint: z.enum(['geometry', 'weight']), note: z.string() }),
  utilization: z.object({ fraction: z.number(), percent: z.string() }),
  qualifications: z.object({
    heuristic: heuristicQualification,
    weightInput: z.union([
      z.object({
        supplied: z.literal(true),
        source: z.enum(['direct', 'density']),
        overriddenKinds: z.array(z.string())
      }),
      z.object({ supplied: z.literal(false), note: z.string() })
    ]),
    clearances: z.union([
      z.object({ asRequested: z.literal(true) }),
      z.object({ asRequested: z.literal(false), note: z.string() })
    ]),
    openMesh: z.union([
      z.object({ affected: z.literal(false) }),
      z.object({ affected: z.literal(true), parts: z.array(z.string()), note: z.string() })
    ])
  }),
  units: outputUnits
}

// --- the drive tier (v2 — slice `v2-drive-tools`) -------------------------
//
// These tools answer about THE RUNNING APP, so their replies carry the app's
// state next to the estimate: a mis-set input must be visible beside a
// surprising answer. The same requiredness rules as v1 hold — units on every
// value, qualifications structural, absence always carrying its reason.

const partialDimensions = dimensionsValue.describe(
  'Carton dimensions in the carton’s own axes. The unit is required.'
)

export const appStateObject = z.object({
  version: z.string().describe('The Carton Fit build answering — one version number for app and tools (ADR-0020).'),
  file: z.union([
    z.object({ loaded: z.literal(false) }),
    z.object({
      loaded: z.literal(true),
      name: z.string(),
      parts: z.number(),
      kinds: z.number()
    })
  ]),
  inputs: z.object({
    mode: z.enum(['fit-check', 'max-quantity']),
    tier: z.enum(['fast', 'thorough', 'nesting']),
    carton: z.object({
      dimensions: dimensionsValue,
      measured: z.enum(['inner', 'outer']),
      wallThickness: lengthValue
    }),
    clearances: z.object({ betweenParts: lengthValue, wall: lengthValue }),
    maxWeight: weightValue,
    weight: z.union([
      z.object({ source: z.literal('direct'), partWeight: weightValue }),
      z.object({ source: z.literal('density'), densityGPerCm3: z.number() })
    ]),
    overrides: z.array(z.object({ kind: z.string(), weight: weightValue })),
    unitPart: z.union([z.string(), z.null()]),
    displayUnits: z.object({ length: lengthUnit, maxWeight: weightUnit, partWeight: weightUnit })
  }),
  packStatus: z.enum(['idle', 'packing', 'done', 'failed']),
  view: z.enum(['model', 'packed']),
  units: outputUnits
})

/** An estimate that exists, or the reason it does not — never a bare absence. */
export const estimateAvailability = z.union([
  z.object({ available: z.literal(true), report: z.object(estimateOutput) }),
  z.object({ available: z.literal(false), reason: z.string() })
])

/** What every mutating drive tool (and get_app_state) returns. */
export const driveOutcomeOutput = {
  state: appStateObject,
  estimate: estimateAvailability
}

export const loadModelInput = {
  path: z.string().describe('Absolute path to a model file (.step, .stp, .stl) on this machine — loaded into the running app exactly as if dropped on the window.'),
  outputUnits: outputUnitsInput
}

export const setInputsInput = {
  mode: z.enum(['fit-check', 'max-quantity']).optional(),
  tier: z.enum(['fast', 'thorough']).optional(),
  carton: z
    .object({
      dimensions: partialDimensions.optional(),
      measured: z.enum(['inner', 'outer']).optional(),
      wallThickness: lengthValue.optional()
    })
    .optional(),
  clearances: z
    .object({ betweenParts: lengthValue.optional(), wall: lengthValue.optional() })
    .optional(),
  maxWeight: weightValue.optional(),
  weight: z
    .object({
      partWeight: weightValue.optional(),
      densityGPerCm3: z.number().optional()
    })
    .optional()
    .describe('Give a part weight OR a density, not both. Setting one switches the app to that weight mode.'),
  displayUnits: z
    .object({
      length: lengthUnit.optional(),
      maxWeight: weightUnit.optional(),
      partWeight: weightUnit.optional()
    })
    .optional()
    .describe('What the app’s own panel DISPLAYS — independent of outputUnits, which governs this reply.'),
  unitPart: z
    .union([z.string(), z.null()])
    .optional()
    .describe('max-quantity: which part kind to replicate; null returns to the whole file as one unit.'),
  outputUnits: outputUnitsInput
}

export const setPartWeightInput = {
  kind: z.string().describe('A part kind name as get_app_state or inspect_model reports it.'),
  weight: z
    .union([weightValue, z.null()])
    .describe('The measured weight of one part of this kind, or null to clear the override and return to the computed weight.'),
  outputUnits: outputUnitsInput
}

export const getEstimateInput = {
  outputUnits: outputUnitsInput
}

export const getAppStateInput = {
  outputUnits: outputUnitsInput
}

export const captureViewInput = {
  view: z
    .enum(['model', 'packed'])
    .optional()
    .describe('Pin which view to capture; omitted captures whatever the app is showing (the packed carton once an estimate exists).')
}

// --- the data tier (v3 — slice `v3-data-tools`) ---------------------------
//
// Presets and saved estimates: the app's own persisted data (ADR-0007,
// ADR-0016), reachable by a client that cannot click the panels. Reads are
// answered from the database directly; writes and restores go through the
// running app, so what gets saved is what is on screen and what gets applied
// lands on the undo stack.
//
// DELETION IS DELIBERATELY ABSENT. Every other tool in this tier is
// recoverable — a wrong preset is re-applied, a wrong restore is one Ctrl+Z —
// but a deleted preset is gone, and the person whose data it is may not be
// watching. ADR-0029's v3 scope is presets/saved estimates/exports, and none of
// that requires destroying any. The app's own buttons remain the way to delete.

const savedAt = z
  .string()
  .describe('When this was saved, ISO 8601 UTC — or "unknown" for a row whose timestamp is unreadable.')

export const listPresetsInput = {}

export const presetsOutput = {
  presets: z.array(z.object({ name: z.string(), savedAt }))
}

export const savePresetInput = {
  name: z
    .string()
    .min(1)
    .describe(
      'What to call it. An existing preset of the same name is REPLACED with the app’s current settings.'
    )
}

export const applyPresetInput = {
  name: z.string().min(1).describe('A preset name as list_presets reports it.'),
  outputUnits: outputUnitsInput
}

export const listSavedEstimatesInput = {
  limit: z.number().int().positive().optional().describe('How many, newest first. Defaults to 50.')
}

export const savedEstimatesOutput = {
  estimates: z.array(
    z.object({
      id: z.number().describe('Pass this to restore_estimate.'),
      file: z.string(),
      savedAt,
      summary: z
        .string()
        .describe('The one-line receipt the app’s own list shows for this row — same sentence.')
    })
  )
}

export const saveEstimateInput = {}

export const restoreEstimateInput = {
  id: z.number().int().describe('A saved estimate’s id, as list_saved_estimates reports it.'),
  outputUnits: outputUnitsInput
}

export const exportEstimateInput = {
  format: z
    .enum(['csv', 'summary'])
    .describe(
      'csv: the per-part measurements table. summary: the paste-into-a-quote text block, warnings included.'
    )
}

export const exportEstimateOutput = {
  format: z.enum(['csv', 'summary']),
  suggestedName: z
    .string()
    .describe('The filename the app would offer — part, carton and units — if the person saved this themselves.'),
  text: z.string()
}
