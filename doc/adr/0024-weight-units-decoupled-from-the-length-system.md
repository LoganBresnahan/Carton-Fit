# 0024 — Weight units decoupled from the length system; inputs are typed, not spun

Status: Accepted (2026-08-26)

## Context

ADR-0004 established canonical mm/g storage with a single display `unitSystem`
toggle: `imperial` means in + lb, `metric` means mm + kg. Dogfooding feedback
(2026-08-26) says that coupling is wrong for weights:

1. Users want to enter weights in **grams** while measuring the carton in
   **inches** — small machined parts are weighed in grams whatever the shop's
   length convention, while carrier weight caps are quoted in pounds. One
   toggle cannot express "inches, but grams", and the metric side of the
   current toggle shows **kg**, which nobody asked for on a 3 g bolt.
2. The spinner arrows on the number inputs are disliked outright — users type
   the number. The arrows are also 0.7 rem of click target that changes a
   dimension by ±1 unit-agnostically (1 mm or 1 in depending on display), which
   makes them a precision hazard next to a field people paste into.

What must not change: canonical storage stays grams (ADR-0004), the persisted
settings key is a versioned surface (ADR-0020), and the exports must keep
saying exactly what the panel says (ADR-0017 §2).

## Decision

1. **`unitSystem` governs lengths only.** The header toggle relabels from
   `in / lb` to just the length unit (`in` ⇄ `mm`). No length behavior changes.
2. **Each weight input owns its display unit.** A new type
   `WeightUnit = 'g' | 'kg' | 'lb'` and two new persisted settings fields:
   - `maxWeightUnit` — the "Max package" field, and every display that is
     spent *against* the cap: the results panel's "X of Y" line, and the
     summary/CSV packed-weight and max-weight rows. The cap and its running
     total must share a unit or the comparison stops being readable.
   - `partWeightUnit` — the "Per part" field, the per-kind overrides panel
     (ADR-0018), and the per-part weight columns in both exports.
   Selectors render *beside the input they govern* (replacing the static unit
   label), which is where the user's eye already is when the unit is wrong.
3. **Conversion happens at the selector, storage never moves.** Switching a
   selector re-displays the same canonical grams in the new unit — it does not
   scale the value. `35 lb` becomes `15875.71 g`, not `35 g`.
4. **Legacy settings derive, so nobody's display jumps.** A persisted blob
   lacking the new fields gets them from its own `unitSystem`: imperial → `lb`,
   metric → `kg`. Fresh installs default to `lb` (matching ADR-0004's imperial
   default). Old saved estimates restore without the fields and simply keep
   the current selection — display units are preferences, not part of the
   answer.
5. **Number inputs lose their spinner buttons** (CSS, app-wide). Typing,
   pasting, and the keyboard arrows (which ADR-0016 §2's undo rule depends on)
   all still work; only the click targets go. Chromium is the only engine this
   app renders in, so the `::-webkit-*-spin-button` rule is complete.
6. **Clicking a number field selects its whole value** (amended 2026-08-26,
   same feedback thread), so typing replaces rather than appends — the
   companion affordance to §5: the fields are type-first, and the first thing
   typed should not have to be Backspace. `select()` on focus alone gets
   collapsed by the focusing click's own mouseup, so the handler swallows that
   one mouseup and no other (`components/select-on-focus.ts`); a second click
   in an already-focused field places the caret normally for in-place edits.
   Applies to every number input; text fields (preset name) keep native
   behavior, matching the undo routing split from ADR-0016 §2.

## Consequences

- `weightToG` / `gToWeight` / `weightUnitLabel` over `UnitSystem` are deleted
  from `core/units.ts`, replaced by `WeightUnit`-keyed conversions plus
  `legacyWeightUnit(unitSystem)` for the derivation in one place. Compile
  errors, not defaults, find every call site — the same reasoning that made
  `openMeshParts`' overrides parameter required (item 13).
- The settings shape grows two fields. They ride existing machinery for free:
  presets and saved estimates serialize the whole settings object, undo
  snapshots it, and `packing/summary.ts` is already defensive about fields it
  does not know.
- Changing a unit selector is a settings write, so it lands on the undo stack
  and triggers auto-run like the old toggle did. The rebuilt request is
  identical (canonical grams), so the estimate cannot change — the existing
  "converts display units without changing the stored answer" e2e pins the
  same property for the new selectors.
- A density entry stays `g/cm³` — it is a material property with one
  conventional unit here, not a weight.

## Alternatives considered

- **One shared `weightUnit` for all weight inputs.** Fewer fields, but it
  cannot express the motivating case (cap in lb, parts in g) — the request was
  literally "a selector per input".
- **Per-row units in the overrides panel.** A unit per kind row is a table of
  dropdowns answering a question nobody asked; kinds in one file are weighed
  on one scale. The panel shares `partWeightUnit`.
- **`oz` in the unit list.** Not requested; add on request, the type is one
  union member away.
- **`step` attributes / `inputmode` instead of hiding spinners.** The
  complaint is the arrows' existence, not their step size.

## Revisit triggers

- A request for ounces, or for remembering units per preset differently from
  the live settings.
- If the overrides panel ever needs mixed units per kind (a file mixing cast
  parts priced in lb with fasteners in g), reopen the per-row alternative.
