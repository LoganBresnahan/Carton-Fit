import { useAppStore } from '../store'

// Max-quantity unit selection (ADR-0003): "copies of a selected part, or the
// whole file as a unit". Thin declarative island — the choice lives in the
// store, and the auto-runner rebuilds the estimate when it changes.
//
// Only meaningful in max-quantity mode: fit-check always asks about the whole
// file, so the control hides rather than sitting there inert.

const WHOLE_FILE = ''

export default function UnitPicker() {
  const mode = useAppStore((s) => s.settings.mode)
  const parts = useAppStore((s) => s.parts)
  const unitPartName = useAppStore((s) => s.unitPartName)
  const setUnitPartName = useAppStore((s) => s.setUnitPartName)

  if (mode !== 'max-quantity' || parts.length === 0) return null

  // A single-part file has nothing to choose between.
  if (parts.length === 1) return null

  return (
    <label className="field unit-picker" data-testid="unit-picker">
      <span className="field-label">Count</span>
      <select
        className="unit-select"
        data-testid="unit-select"
        value={unitPartName ?? WHOLE_FILE}
        onChange={(e) => setUnitPartName(e.target.value === WHOLE_FILE ? null : e.target.value)}
      >
        <option value={WHOLE_FILE}>Whole file ({parts.length} parts, as one unit)</option>
        {parts.map((part, i) => (
          <option key={`${part.name}-${i}`} value={part.name}>
            {part.name}
          </option>
        ))}
      </select>
    </label>
  )
}
