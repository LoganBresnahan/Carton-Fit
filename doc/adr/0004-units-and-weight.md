# ADR-0004: Canonical mm/g internally; weight as a hard cap (default 35 lb)

Date: 2026-07-24
Status: Accepted

## Context

STEP files are effectively always millimeters; the likely audience works in inches and
pounds. Mixed-unit arithmetic is a classic source of silent errors. Separately, real
packages have weight limits (carrier and ergonomic), so geometry alone can't answer
"how many per box" — but CAD files carry no mass, so part weight must come from the
user somehow.

## Decision

- **Canonical internal units are millimeters and grams.** All computation (geometry,
  packing, weight) happens in mm/g. Conversion to inches/lb lives only in
  `core/units.ts` and is applied at the UI boundary. The UI offers a mm ⇄ in toggle,
  with weights following as kg ⇄ lb.
- **Max package weight** is a user input, **default 35 lb**, treated as a hard
  constraint alongside geometric fit. Every result states which constraint was
  binding (geometry or weight).
- **Part weight** comes from either a direct per-part entry or a material/density
  selection multiplied by mesh volume (signed-tetrahedron sum over the triangle mesh).
- Box **inside** dimensions are the physical truth; an optional wall-thickness field
  lets users enter outside dimensions instead (`inner = outer − 2 × wall`).

## Consequences

- One conversion chokepoint: unit bugs are confined to `units.ts` and its tests; a
  grep for `25.4` outside that file is a convention violation.
- Density-derived weight depends on mesh volume, which is exact only for closed
  meshes; open/dirty meshes may need a warning and fall back to direct entry.
- Weight capping in quantity mode is trivial (`floor(maxWeight / partWeight)`), so the
  interesting reporting work is attributing the binding constraint, not the math.

## Alternatives considered

- **Compute in whatever unit the user chose** — rejected; spreads conversions through
  every formula and invites Mars Climate Orbiter bugs.
- **Weight as a warning rather than a cap** — rejected; a 35 lb limit that doesn't
  bind isn't a limit, and the user framed it as a constraint.

## Revisit triggers

- Users need box tare weight (carton + dunnage mass) included in the limit.
- The material list needs to grow into a real density library or per-org presets.
- Non-uniform parts (hollow castings vs. solid stock) make density × volume misleading.
