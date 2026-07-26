# ADR-0018: Per-kind weight overrides, layered on the existing weight modes

Date: 2026-07-26
Status: Accepted
Relates to: ADR-0004 (inputs; weight is a hard constraint), ADR-0015 (flag
unmeasurable inputs), ADR-0016 (undo; saved estimates), ADR-0017 (export)

## Context

Both weight sources are file-wide: direct mode applies ONE number to every part
(`partWeightG` in `packing/request.ts`), and density mode applies one material
to every part's own mesh volume. Dogfooding a real 18-part assembly surfaced
the gap immediately: a mixed assembly has bolts that do not weigh what the
plate weighs, and steel bolts in an aluminium bracket are wrong under one
density however good the volumes are. Weight is a hard constraint (ADR-0004),
so a wrong per-part weight is a wrong count stated with confidence.

Two facts anchor the design:

- **The import already knows about kinds.** Assemblies instancing one product
  yield identically-named meshes, and `extractParts` uniques them with ordinal
  suffixes: `bolt`, `bolt (2)`, … `bolt (6)`. The suffix is our own; the base
  name is the product. Six bolts are one *kind*, and nobody should type the
  bolt weight six times.
- **Part names belong to the loaded file.** `unitPartName` already set the
  precedent: file-scoped state is cleared on import and stays out of the
  persisted settings, because `bolt → 23 g` silently applying to an unrelated
  file's bolt next week is corruption wearing a convenience's face.

## Decision

### 1. Overrides layer on the existing modes; there is no third mode

Effective weight per part = the override for its kind, if set, else whatever
the current mode computes (direct or density × volume). Density stays useful
as the *default generator* — set 7.85 for the steel, then correct the two
nylon parts — instead of a third mode forcing every weight to be typed from
scratch. The all-or-nothing entry a "per part" mode implies is exactly wrong
for the mixed-assembly case that motivated this.

### 2. The unit of override is the KIND — the base name before our suffix

One override for `bolt` covers `bolt (2)`…`bolt (6)`. Grouping is by the name
the file gave the product, so it is honest: identical names came from one
instanced product. A malformed file that gives two different parts one name
shares their weight — accepted, and visible, because the UI shows the group's
instance count.

### 3. File-scoped store slice, cleared on import, never in PackingSettings

A `partWeightsG` map (kind → grams) in its own slice, following `unitPartName`
exactly: cleared by `beginImport`/`importFailed`/`resetImport`, absent from
localStorage. Presets ("no part attached" — ADR-0016 vocabulary) never carry
it.

### 4. The ripples are part of the decision, not incidental

- **Open-mesh warning skips overridden kinds** (ADR-0015). An overridden part
  no longer derives weight from volume, so the warning would be false — and
  overriding is one of the two fixes the warning's own wording suggests, so
  entering the override must visibly retire the warning it answers.
- **Saved estimates carry the overrides** in the settings blob and restore
  re-applies them by kind; names the loaded file lacks are ignored, which is
  harmless by construction. The receipt's own numbers were always safe: the
  request stores resolved per-part grams.
- **Undo covers override edits** (ADR-0016 §2 extended past `settings`), with
  a per-kind change signature so bolt-then-nut is two steps and typing "23.5"
  into one field is one.
- **Export needs almost nothing** (ADR-0017): CSV and summary already read
  resolved weights off the request. Only the summary's "Part weight:" line
  changes, to say overrides are in play rather than claiming one source.

## Consequences

- Renderer-only: no schema change (the settings blob is opaque JSON to
  storage), no IPC change, no migration.
- The pack request builder takes the overrides as an argument and stays pure;
  the auto-run subscription gains one more slice to watch.
- A fourth piece of file-scoped state (`parts`, `unitPartName`, `contentHash`,
  now this) — if a fifth appears, consider a grouped "file session" slice
  rather than another parallel field. Revisit trigger, not built now.
- The UI grows a Part weights section that must not crowd the column: one row
  per kind with count, computed default shown until overridden, and a way to
  clear back to computed.

## Alternatives considered

- **A third weight mode ("per part")** — simpler selector, but all-or-nothing:
  every kind must be typed, the density default is lost, and switching modes
  discards the mental model of "defaults plus corrections". Rejected.
- **Override per instance, not per kind** — maximum flexibility nobody asked
  for: instances of one product weigh the same in reality, and eighteen rows
  where six kinds suffice is how the section gets scrolled past.
- **Persist overrides by kind name in localStorage** — convenient for repeat
  estimates on the same file, wrong for every other file (stale `bolt`).
  Saved estimates already cover the repeat case, keyed to a content hash.
- **Group by geometry hash instead of base name** — catches same-name-different
  -part files, but breaks the honest case (same product, same name) whenever
  tessellation differs between instances, and is invisible to the user. The
  name is what the UI shows, so the name is what the override binds to.

## Revisit triggers

- A material density library arrives (roadmap Later) → it becomes a richer
  default generator under the same override layer; this ADR's shape holds.
- A fifth piece of file-scoped state → consolidate the slices.
- Users override most kinds most of the time → the rejected third mode is
  telling us it was right after all; reconsider.
