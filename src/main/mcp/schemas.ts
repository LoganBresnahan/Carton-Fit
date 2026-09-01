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

const heuristicQualification = z.object({ heuristic: z.boolean(), note: z.string() })

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
