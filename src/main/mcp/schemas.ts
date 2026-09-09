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
  // LENGTH ONLY, and that is the whole of the 4th dogfood's finding here: this
  // tool weighs nothing, so a `weight` it accepted, resolved and echoed was a
  // parameter that appeared to do something on the one call you would use to
  // sanity-check a weight. Narrowing an optional input is not a break — an
  // unknown key is stripped, not refused — while REMOVING `units.weight` from
  // the output would be, under ADR-0020's rule for output schemas, so the echo
  // stays until a major and is documented there rather than quietly dropped.
  outputUnits: z
    .object({ length: lengthUnit.optional() })
    .optional()
    .describe(
      'Units to answer lengths and volumes in; defaults to the app’s internal mm. There is ' +
        'no weight to choose here — this tool reports geometry, not weights.'
    )
}

const knownFalse = z.object({ known: z.literal(false), reason: z.string() })

/** Lengths only — `inspect_model` weighs nothing, so its reply names no weight
 *  unit. The INPUT was narrowed on the 4th dogfood and the output echo was left
 *  for a major; ADR-0020's amendment moved that boundary, so the two halves
 *  finally agree (8th run). */
export const lengthOnlyUnits = z.object({ length: lengthUnit })

export const inspectOutput = {
  file: z.object({ path: z.string(), name: z.string() }),
  totals: z.object({ parts: z.number(), kinds: z.number(), triangles: z.number() }),
  boundingBox: dimensionsValue,
  kinds: z.array(
    z.object({
      kind: z.string(),
      count: z.number(),
      // SCOPE IN THE NAME, not only in a description (10th dogfood): this was
      // `triangles` / `size` / `volume`, a kind total between two per-instance
      // figures with nothing saying so, and it was the one object on this
      // surface whose members carried no description at all.
      trianglesTotal: z
        .number()
        .describe('Triangles across ALL instances of this kind — the only total here.'),
      sizePerInstance: dimensionsValue.describe(
        'Bounding box of ONE instance, as modelled, when every instance is placed the same ' +
          'way. Otherwise the extents are sorted largest-first, so instances that are one box ' +
          'turned 90° agree on it; a kind whose instances differ in shape still gets one ' +
          'instance’s numbers.'
      ),
      volumePerInstance: volumeValue.describe(
        'Enclosed volume of ONE instance. Multiply by count for the kind; a reader who ' +
          'divided it by count would be wrong by that factor.'
      ),
      closedMesh: z.boolean(),
      instancesAlike: z
        .boolean()
        .describe(
          'Whether every instance of this kind has the same SHAPE — one box, possibly turned ' +
            '90° between instances, which no tier can tell apart. False only when an instance’s ' +
            'box differs even when turned, and then the estimate qualifies its answer.'
        )
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
  units: lengthOnlyUnits
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

export const heuristicQualification = z.object({
  searchIsHeuristic: z
    .boolean()
    .describe(
      'Whether the SEARCH that produced this count is heuristic. Always true: grid fill and ' +
        'extreme-point refinement are both lower bounds (ADR-0003). It says nothing about ' +
        'whether this particular answer is optimal — that is provenOptimal.'
    ),
  provenOptimal: z
    .boolean()
    .describe(
      'Whether a rigorous bound MEETS the count, which proves no arrangement beats it under ' +
        'these limits — the cap among them. True is a proof, not a hope; false means only ' +
        'that nothing here rules out a better arrangement.'
    ),
  note: z.string()
})

export const estimateOutput = {
  request: z.object({
    mode: z.enum(['fit-check', 'max-quantity']),
    tier: z.enum(['fast', 'thorough', 'nesting']),
    innerCarton: dimensionsValue,
    clearances: z.object({ betweenParts: lengthValue, wall: lengthValue }),
    maxWeight: weightValue,
    packedWeight: weightValue,
    unitPart: z
      .string()
      .nullable()
      .describe('max-quantity: the part being replicated; null means the whole file as one unit.')
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
      // THE THREE COUNT-CEILINGS, each with its guidance ON THE FIELD. They
      // had only code comments until the 5th dogfood, which is to say they had
      // none: a comment reaches whoever edits this file, and the reader who
      // has to choose between three similar numbers is on the other side of
      // the wire (ADR-0029 amendment 7).
      upperBound: z
        .union([z.object({ known: z.literal(true), count: z.number() }), knownFalse])
        .describe(
          'A ceiling on the count AS ASKED, weight cap included — it moves when the cap ' +
            'moves, so it says nothing about the carton on its own.'
        ),
      geometryBound: z
        .union([z.object({ known: z.literal(true), count: z.number() }), knownFalse])
        .describe(
          'A rigorous ceiling on what space alone allows. Equal to count it PROVES the ' +
            'carton is full. Above count it proves nothing whatever — a ceiling is allowed ' +
            'to be loose and this one routinely is, by more than one. Never quote it as ' +
            'capacity; read spaceOnlyCount for that.'
        ),
      spaceOnlyCount: z
        .union([z.object({ known: z.literal(true), count: z.number() }), knownFalse])
        .describe(
          'How many the CARTON ALONE takes: the same search with the weight cap lifted. ' +
            'Above count, an arrangement we hold — room, proven constructively. Equal to ' +
            'count on a weight-bound answer, the search found no more: evidence, not proof. ' +
            'Equal to count on a space-bound answer, it IS that answer. This is the field ' +
            'that tells a roomy carton from a full one.'
        ),
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
  binding: z.object({
    constraint: z
      .enum(['geometry', 'weight'])
      .describe('The window and both exports call "geometry" *space*; same constraint, one token here.'),
    // Required, not optional: "did anything actually stop this" is the
    // qualification the note used to overstate (2026-09-02 dogfood finding).
    bound: z.boolean(),
    // The evidence behind any claim about the constraint NOT named above.
    // `known: false` is the honest common case: a bound is not a placement,
    // so "the carton has room" is usually unprovable (2026-09-03 finding).
    otherConstraint: z.union([
      z.object({
        known: z.literal(true),
        atLimit: z.boolean(),
        // What KIND of claim this is (ADR-0033): 'bound' and 'arrangement' are
        // proofs, 'arithmetic' is exact, 'search' is our own heuristic failing
        // to find more — evidence, never a proof, and the field is what stops a
        // reader promoting it to one.
        evidence: z.enum(['bound', 'arrangement', 'arithmetic', 'search'])
      }),
      knownFalse
    ]),
    note: z.string()
  }),
  utilization: z.object({
    fraction: z.number(),
    percent: z.string(),
    // Named because a reader could not act on the number without asking
    // (2026-09-03): it is placed BOUNDING BOXES over the inner carton, not
    // material volume — air inside a part's box is not usable by another part.
    basis: z.literal('bounding-boxes'),
    of: z
      .enum(['parts', 'unit-part', 'whole-file'])
      .describe(
        'Whose boxes the fill counts. "parts": every part placed, summed (fit-check). ' +
          '"unit-part": count × one kind’s box (max-quantity with a unit part). "whole-file": ' +
          'count × the whole file’s box as ONE unit, the air between its parts counted — so the ' +
          'same parts in the same carton read higher here than in fit-check, and the two are ' +
          'not comparable.'
      )
  }),
  qualifications: z.object({
    heuristic: heuristicQualification,
    weightInput: z.union([
      z.object({
        supplied: z.literal(true),
        // RENAMED from `source` on 2026-09-05, the 8th dogfood (ADR-0020
        // amendment). Four readers took `source` for provenance across five
        // runs — the last of them on a build whose schema already said it was
        // not, which is what settled it: a description does not reach a reader
        // who is reading values. It is a mode, the app has always called it
        // `weightMode`, and the wire was the only thing calling it a source.
        mode: z
          .enum(['direct', 'density'])
          .describe('The weight MODE that was set. An input, not a claim about this answer.'),
        overriddenKinds: z.array(z.string()),
        // The 2026-09-03 finding: the mode described the setting while a script
        // reading it drew a conclusion about the answer. Scoped to the parts
        // this pack actually weighed.
        countedWeightFrom: z
          .enum(['direct', 'density', 'override', 'mixed'])
          .describe(
            'Where the grams behind THIS answer came from: override when every counted part ' +
              'was priced by hand, mixed when some were, else the mode that derived them.'
          )
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
    ]),
    // Additive, so a minor under ADR-0020 §3 — no existing field changes shape.
    mixedInstances: z
      .union([
        z.object({ affected: z.literal(false) }),
        z.object({ affected: z.literal(true), kinds: z.array(z.string()), note: z.string() })
      ])
      .describe(
        'Whether any kind counted here has instances at different orientations, so their ' +
          'bounding boxes differ and each was packed with its own. The same test behind ' +
          'inspect_model’s instancesAlike, repeated here because this tool takes a file path ' +
          'and is often the only one a caller runs.'
      )
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

/** A customer on the wire (ADR-0035 §4): id and name, nothing else. */
export const customerRef = z.union([
  z.object({ id: z.number().int(), name: z.string() }),
  z.null()
])

/** The groups `inputs` is read in — the vocabulary of both provenance lists. */
const inputGroups = z.array(
  z.enum(['mode', 'tier', 'carton', 'clearances', 'maxWeight', 'weight', 'displayUnits'])
)

export const appStateObject = z.object({
  version: z.string().describe('The Carton Fit build answering — one version number for app and tools (ADR-0020).'),
  file: z.union([
    z.object({ loaded: z.literal(false) }),
    z.object({
      loaded: z.literal(true),
      name: z.string(),
      parts: z.number(),
      kinds: z.number(),
      savedEstimates: z
        .number()
        .int()
        .optional()
        .describe(
          'How many saved estimates this document holds (on every reply that carries state), counting ' +
            'every version the person has linked to it (ADR-0034) and EVERY customer’s rows — the ' +
            'document’s total, where the app’s own panel counts house plus the active customer. ' +
            'The rows themselves are list_saved_estimates with scope "model", whose ' +
            'withheldByCustomer gives the split.'
        )
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
    weight: z
      .union([
        z.object({ mode: z.literal('direct'), partWeight: weightValue }),
        z.object({ mode: z.literal('density'), densityGPerCm3: z.number() })
      ])
      .describe(
        'Which way the panel is set to get a base weight: a figure typed once for every ' +
          'part, or a density to derive it from. NOT where the counted weight came from — a ' +
          'per-kind override beats this for that kind, and the estimate’s ' +
          '`countedWeightFrom` is the provenance field.'
      ),
    overrides: z.array(z.object({ kind: z.string(), weight: weightValue })),
    unitPart: z.union([z.string(), z.null()]),
    displayUnits: z.object({ length: lengthUnit, maxWeight: weightUnit, partWeight: weightUnit }),
    provenance: z
      .object({
        changedThisSession: inputGroups.describe(
          'The input groups whose VALUE differs from what the app launched with. A group written ' +
            'to the value it already had — or moved and moved back — is not here; it is in ' +
            'setThisSession. This is a comparison of values, not a history of edits.'
        ),
        // The twelfth run (2026-09-08): a reader set seven groups to the values
        // the app had inherited, got [], and proved it with a round trip —
        // wall 0.25→0.5 listed clearances, 0.5→0.25 dropped it. Two questions,
        // two fields (ADR-0034 amendment 2): did the numbers move, and did a
        // hand touch them.
        setThisSession: inputGroups.describe(
          'The input groups WRITTEN since the app launched — by you, by another client on the ' +
            'same running app, or by the person at the window — whether or not the value moved. ' +
            'A group here and not in changedThisSession was set to the value it already had.'
        ),
        unchangedAre: z
          .enum(['earlier-session', 'defaults'])
          .describe('What every group NOT in changedThisSession is: left by an earlier session, or the app’s defaults.')
      })
      .describe(
        'Where these inputs came from. They persist between launches, so a group in neither list ' +
          'was inherited untouched — set what your answer depends on rather than trusting it, and ' +
          'setThisSession will show that you did even when the value was already right. "This ' +
          'session" is the app’s launch, not your connection: a second client on the same running ' +
          'app sees the first one’s writes. Overrides and the unit part are not listed: they are ' +
          'cleared on every load (see load_model’s `cleared`).'
      )
  }),
  packStatus: z.enum(['idle', 'packing', 'done', 'failed']),
  view: z.enum(['model', 'packed']),
  units: outputUnits,
  customer: customerRef.describe(
    'Who the app is working for (ADR-0035), or null for house. A label on what the app ' +
      'shows and saves — nothing in an estimate depends on it. Change it with set_customer.'
  )
})

/** An estimate that exists, or the reason it does not — never a bare absence. */
export const estimateAvailability = z.union([
  z.object({ available: z.literal(true), report: z.object(estimateOutput) }),
  z.object({ available: z.literal(false), reason: z.string() })
])

/** What every mutating drive tool (and get_app_state) returns. */
export const driveOutcomeOutput = {
  state: appStateObject,
  estimate: estimateAvailability,
  // Only a load fills this in. Optional and additive, so it is a minor under
  // ADR-0020 and no other tool's reply changes shape.
  cleared: z
    .object({
      unitPart: z.union([z.string(), z.null()]),
      overriddenKinds: z.array(z.string())
    })
    .optional()
    .describe(
      'Only on load_model: the unit part and per-kind weight overrides this load threw ' +
        'away, since kind names belong to the file that was open. An empty list and a null ' +
        'unit part mean there was nothing to clear — not that clearing was skipped.'
    ),
  // The mirror (16th dogfood): a preset never carries these, so what a preset
  // LEAVES in force is what produced the count beside it.
  kept: z
    .object({
      unitPart: z.union([z.string(), z.null()]),
      overriddenKinds: z.array(z.string())
    })
    .optional()
    .describe(
      'Only on apply_preset: the unit part and per-kind weight overrides the preset left in ' +
        'force — a preset never carries either, so these produced the count in this reply ' +
        'and the preset did not. Empty means nothing was in force. Read this before trusting ' +
        'a count that differs from the one the preset was saved beside.'
    )
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

/** Which customer's rows a list answers with (ADR-0035 §4). */
export const customerFilter = z.enum(['active', 'all'])

const customerFilterInput = customerFilter
  .optional()
  .describe(
    '"active": the presets or receipts for the customer the app is working for, PLUS house ' +
      '(rows with no customer) — what the app’s own lists show. "all": every customer’s. ' +
      'Defaults to "active"; the reply’s `customer` says which you got.'
  )

const customerName = z
  .union([z.string(), z.null()])
  .describe('Whose row this is, or null for house.')

export const listPresetsInput = { customer: customerFilterInput }

/** The 13th run's finding: two lists that differ in label and not in content
 *  read as one list. A count of what the filter hid is the field that can be
 *  false (ADR-0035 amendment 1). */
const withheldByCustomer = z
  .number()
  .int()
  .nonnegative()
  .describe(
    'How many rows the customer filter hid from this reply — other customers’ rows that ' +
      '`customer: "all"` would show. 0 when nothing was hidden, including under "all".'
  )

export const presetsOutput = {
  customer: customerFilter.describe('Which rows these are: "active" or "all".'),
  withheldByCustomer,
  presets: z.array(z.object({ name: z.string(), savedAt, customer: customerName }))
}

export const listCustomersInput = {}

export const customersOutput = {
  customers: z.array(z.object({ id: z.number().int(), name: z.string() })),
  active: customerRef.describe('Who the app is working for right now, or null for house.')
}

export const setCustomerInput = {
  id: z
    .union([z.number().int(), z.null()])
    .describe('A customer id as list_customers reports it, or null for house.'),
  outputUnits: outputUnitsInput
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

export const estimatesScope = z.enum(['model', 'all'])

export const listSavedEstimatesInput = {
  customer: customerFilterInput,
  scope: estimatesScope
    .optional()
    .describe(
      '"model": the receipts kept for the loaded document — the same list the app’s panel ' +
        'shows, found by the file’s content (and any earlier versions the person linked), ' +
        'never by its name. "all": every part’s receipts — still under the customer filter, ' +
        'which is its own axis: `customer: "all"` widens that one. Defaults to "model" when ' +
        'a file is loaded and "all" otherwise; the reply’s `scope` says which you got.'
    ),
  limit: z.number().int().positive().optional().describe('How many, newest first. Defaults to 50.')
}

export const savedEstimatesOutput = {
  scope: estimatesScope.describe(
    'Which rows this is: "model" is the loaded document’s receipts, "all" is every part’s — ' +
      'either way under the `customer` filter beside it.'
  ),
  customer: customerFilter.describe('Which customers’ rows: "active" (plus house) or "all".'),
  withheldByCustomer,
  estimates: z.array(
    z.object({
      id: z.number().describe('Pass this to restore_estimate.'),
      file: z.string(),
      savedAt,
      customer: customerName,
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
