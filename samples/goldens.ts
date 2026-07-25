// Golden expectations for the committed sample parts (ADR-0005).
//
// These live in `samples/` beside the parts themselves, NOT in a test folder,
// because the ADR makes them the shared fixtures for all three layers: vitest
// asserts the math against them, the e2e specs assert the running app against
// them, and dogfooding uses them as the "known answer" to sanity-check a build
// by hand. One definition, so the layers cannot silently disagree.
//
// Every number here is HAND-COMPUTED from the part's dimensions and the stated
// box, then confirmed against the production build. Deriving them from the
// engine would make the tests tautological — they would pass on any consistent
// wrong answer, which is precisely the off-by-one class this project keeps
// hitting (see the 5 lb / 0.01 lb case below).

export interface GoldenPart {
  /** File name inside `samples/`. */
  file: string
  /** Parts the importer must find. */
  partCount: number
  /** Triangles across all parts. */
  triangleCount?: number
  /** Bounding box in millimetres. */
  sizeMm?: [number, number, number]
  /** Enclosed volume in mm³ (closed meshes only). */
  volumeMm3?: number
}

export const CUBE_STL: GoldenPart = {
  file: 'cube-10x10.stl',
  partCount: 1,
  triangleCount: 12, // 2 per face × 6
  sizeMm: [10, 10, 10],
  volumeMm3: 1000
}

export const CUBE_STEP: GoldenPart = {
  file: 'cube-10x10.stp',
  partCount: 1,
  sizeMm: [10, 10, 10],
  volumeMm3: 1000
}

export const AS1_ASSEMBLY: GoldenPart = {
  file: 'as1-oc-214.stp',
  partCount: 18, // instance-disambiguated (ADR-0002 addendum)
  triangleCount: 5040
}

/** One end-to-end packing scenario with a hand-computed answer. */
export interface GoldenPack {
  name: string
  part: GoldenPart
  /** Inner carton, in INCHES as typed into the UI (defaults are imperial). */
  cartonIn: [number, number, number]
  mode: 'fit-check' | 'max-quantity'
  tier: 'fast' | 'thorough'
  /** Max package weight in lb, when the scenario exercises the cap. */
  maxWeightLb?: number
  /** Per-part weight in lb, when the scenario exercises the cap. */
  partWeightLb?: number
  /** Expected count (max-quantity) — exact. */
  count?: number
  /** Expected fit verdict (fit-check). */
  fits?: boolean
  /** Which hard constraint bound the answer (ADR-0004: always reported). */
  binding: 'space' | 'weight'
  /** Carton fill as the UI renders it. */
  fill?: string
  /** How the number was derived, so a failure is diagnosable, not just red. */
  derivation: string
}

export const GOLDEN_PACKS: readonly GoldenPack[] = [
  {
    name: 'cube fits a 12 in carton',
    part: CUBE_STL,
    cartonIn: [12, 12, 12],
    mode: 'fit-check',
    tier: 'fast',
    fits: true,
    binding: 'space',
    fill: '<1%',
    derivation: '10 mm cube in a 304.8 mm box: trivially fits; 1000 / 304.8³ = 0.0035%'
  },
  {
    name: 'cube max-quantity in a 12 in carton',
    part: CUBE_STL,
    cartonIn: [12, 12, 12],
    mode: 'max-quantity',
    tier: 'fast',
    count: 27_000,
    binding: 'space',
    fill: '95%',
    derivation: 'floor(304.8 / 10) = 30 per axis → 30³ = 27,000; 27e6 / 304.8³ = 95.3%'
  },
  {
    name: 'cube max-quantity in a 3 in carton (slack on the far faces)',
    part: CUBE_STL,
    cartonIn: [3, 3, 3],
    mode: 'max-quantity',
    tier: 'fast',
    count: 343,
    binding: 'space',
    fill: '78%',
    derivation: 'floor(76.2 / 10) = 7 per axis → 7³ = 343; 343e3 / 76.2³ = 77.5%'
  },
  {
    name: 'thorough ties fast on an axis-aligned cube',
    part: CUBE_STL,
    cartonIn: [12, 12, 12],
    mode: 'max-quantity',
    tier: 'thorough',
    count: 27_000,
    binding: 'space',
    derivation: 'OBB == AABB for an axis-aligned box, so the superset guarantee ties'
  },
  {
    name: 'weight cap binds before geometry',
    part: CUBE_STL,
    cartonIn: [12, 12, 12],
    mode: 'max-quantity',
    tier: 'fast',
    maxWeightLb: 5,
    partWeightLb: 0.01,
    count: 500,
    binding: 'weight',
    derivation:
      'floor(5 / 0.01) = 500, far below the 27,000 geometry allows. Regression: in ' +
      'canonical grams this ratio lands a hair under 500 in binary and once ' +
      'reported 499 — found by dogfooding, fixed with a tolerant floor.'
  },
  {
    name: 'AS1 assembly fits a 24 in carton',
    part: AS1_ASSEMBLY,
    cartonIn: [24, 24, 24],
    mode: 'fit-check',
    tier: 'fast',
    fits: true,
    binding: 'space',
    derivation: 'all 18 parts placed by the greedy shelf in a 609.6 mm box'
  }
]
