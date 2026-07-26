import { useAppStore } from '../store'
import { partKinds } from '../packing/kinds'
import { partWeightG } from '../packing/request'
import { gToWeight, weightToG, weightUnitLabel } from '../core/units'

// Per-kind weight overrides (ADR-0018).
//
// A declarative island over the store (ADR-0006): it derives the kind list from
// the imported parts and writes overrides. No packing, no IPC — changing an
// override is an ordinary store write, and auto-run re-packs off the back of it
// like any other input.
//
// One row per KIND, not per part: an assembly instancing one product six times
// yields `bolt`…`bolt (6)`, and six rows asking the same question is how a
// section gets scrolled past. The count is shown so the grouping is visible
// rather than something the user has to infer.

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4

export default function PartWeightsPanel(): React.JSX.Element | null {
  const parts = useAppStore((s) => s.parts)
  const settings = useAppStore((s) => s.settings)
  const overrides = useAppStore((s) => s.partWeightsG)
  const setPartWeight = useAppStore((s) => s.setPartWeight)

  const kinds = partKinds(parts)
  // Nothing imported, or a single kind that the file-wide weight already
  // describes perfectly — in both cases this section would only add noise.
  if (kinds.length < 2) return null

  const unit = weightUnitLabel(settings.unitSystem)

  return (
    <section className="panel-section" data-testid="part-weights-panel">
      <h2>Part weights</h2>
      <p className="panel-hint">
        Per kind. Blank uses the weight above; type to override one kind.
      </p>

      <ul className="kind-list" data-testid="kind-list">
        {kinds.map(({ kind, count, sample }) => {
          const override = overrides[kind]
          const hasOverride = typeof override === 'number'
          // What this kind weighs if left alone — shown as the placeholder, so
          // the default is visible without being mistaken for an entered value.
          const fallback = round4(gToWeight(partWeightG(sample, settings), settings.unitSystem))
          return (
            <li key={kind} data-testid="kind-item">
              <span className="kind-name" title={kind}>
                {kind}
                {count > 1 && <span className="kind-count"> ×{count}</span>}
              </span>
              <span className="field-input">
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="kind-weight"
                  aria-label={`Weight for ${kind}`}
                  data-testid={`kind-weight-${kind}`}
                  placeholder={String(fallback)}
                  value={hasOverride ? round4(gToWeight(override, settings.unitSystem)) : ''}
                  onChange={(e) => {
                    const raw = e.target.value
                    // An empty field means "no override" — the way to get the
                    // computed weight back is to clear the box, which is what
                    // a user expects of a field showing a placeholder default.
                    if (raw.trim() === '') return setPartWeight(kind, null)
                    const value = parseFloat(raw)
                    if (Number.isNaN(value) || value < 0) return
                    setPartWeight(kind, weightToG(value, settings.unitSystem))
                  }}
                />
                <span className="field-unit">{unit}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
