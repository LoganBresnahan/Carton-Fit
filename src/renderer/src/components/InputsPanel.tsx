import { useAppStore } from '../store'
import {
  WEIGHT_UNITS,
  gToWeight,
  lengthToMm,
  lengthUnitLabel,
  mmToLength,
  weightToG,
  type UnitSystem,
  type WeightUnit
} from '../core/units'
import type { Vec3 } from '../core/packing/types'
import { selectAllOnFocus } from './select-on-focus'

// The inputs panel (roadmap item 3 / ADR-0004). Storage is canonical mm/g; this
// component is the ONLY place that converts — display via mmToLength/gToWeight,
// commit via lengthToMm/weightToG. The mm⇄in toggle flips length display only;
// each weight input carries its own unit selector (ADR-0024).

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4

function NumberField(props: {
  label: string
  canonical: number
  unitSystem: UnitSystem
  onCommit: (canonical: number) => void
  testid?: string
}) {
  const { label, canonical, unitSystem, onCommit, testid } = props
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="number"
          min={0}
          step="any"
          value={round4(mmToLength(canonical, unitSystem))}
          data-testid={testid}
          {...selectAllOnFocus}
          onChange={(e) => {
            const d = parseFloat(e.target.value)
            if (Number.isNaN(d)) return
            onCommit(lengthToMm(d, unitSystem))
          }}
        />
        <span className="field-unit">{lengthUnitLabel(unitSystem)}</span>
      </span>
    </label>
  )
}

/** Selecting a unit re-displays the same canonical grams — it never scales the
 *  stored value (ADR-0024 §3). */
export function WeightUnitSelect(props: {
  unit: WeightUnit
  onChange: (unit: WeightUnit) => void
  ariaLabel: string
  testid?: string
}) {
  return (
    <select
      className="weight-unit-select"
      aria-label={props.ariaLabel}
      data-testid={props.testid}
      value={props.unit}
      onChange={(e) => props.onChange(e.target.value as WeightUnit)}
    >
      {WEIGHT_UNITS.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </select>
  )
}

function WeightField(props: {
  label: string
  canonical: number
  unit: WeightUnit
  onCommit: (canonicalG: number) => void
  onUnitChange: (unit: WeightUnit) => void
  testid?: string
}) {
  const { label, canonical, unit, onCommit, onUnitChange, testid } = props
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="number"
          min={0}
          step="any"
          value={round4(gToWeight(canonical, unit))}
          data-testid={testid}
          {...selectAllOnFocus}
          onChange={(e) => {
            const d = parseFloat(e.target.value)
            if (Number.isNaN(d)) return
            onCommit(weightToG(d, unit))
          }}
        />
        <WeightUnitSelect
          unit={unit}
          onChange={onUnitChange}
          ariaLabel={`Unit for ${label.toLowerCase()} weight`}
          testid={testid ? `${testid}-unit` : undefined}
        />
      </span>
    </label>
  )
}

export default function InputsPanel() {
  const s = useAppStore((st) => st.settings)
  const update = useAppStore((st) => st.updateSettings)

  const setDim = (i: number, mm: number): void => {
    const dims: Vec3 = [
      i === 0 ? mm : s.boxDimsMm[0],
      i === 1 ? mm : s.boxDimsMm[1],
      i === 2 ? mm : s.boxDimsMm[2]
    ]
    update({ boxDimsMm: dims })
  }

  const dimLabels = s.enterOuter ? ['Outer L', 'Outer W', 'Outer H'] : ['Inner L', 'Inner W', 'Inner H']

  return (
    <div className="inputs" data-testid="inputs-panel">
      <div className="inputs-header">
        <h2>Carton</h2>
        <button
          type="button"
          className="unit-toggle"
          data-testid="unit-toggle"
          onClick={() => update({ unitSystem: s.unitSystem === 'imperial' ? 'metric' : 'imperial' })}
        >
          {lengthUnitLabel(s.unitSystem)}
        </button>
      </div>

      {[0, 1, 2].map((i) => (
        <NumberField
          key={i}
          label={dimLabels[i]}
          canonical={s.boxDimsMm[i]}
          unitSystem={s.unitSystem}
          onCommit={(mm) => setDim(i, mm)}
          testid={`dim-${i}`}
        />
      ))}

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={s.enterOuter}
          data-testid="enter-outer"
          onChange={(e) => update({ enterOuter: e.target.checked })}
        />
        <span>Enter outer dims + wall thickness</span>
      </label>
      {s.enterOuter && (
        <NumberField
          label="Wall"
          canonical={s.wallMm}
          unitSystem={s.unitSystem}
          onCommit={(mm) => update({ wallMm: mm })}
          testid="wall"
        />
      )}

      <h2>Clearances</h2>
      <NumberField
        label="Between parts"
        canonical={s.clearancePartMm}
        unitSystem={s.unitSystem}
        onCommit={(mm) => update({ clearancePartMm: mm })}
        testid="clearance-part"
      />
      <NumberField
        label="To wall"
        canonical={s.clearanceWallMm}
        unitSystem={s.unitSystem}
        onCommit={(mm) => update({ clearanceWallMm: mm })}
        testid="clearance-wall"
      />

      <h2>Weight</h2>
      <WeightField
        label="Max package"
        canonical={s.maxWeightG}
        unit={s.maxWeightUnit}
        onCommit={(g) => update({ maxWeightG: g })}
        onUnitChange={(maxWeightUnit) => update({ maxWeightUnit })}
        testid="max-weight"
      />
      <div className="segmented small" role="radiogroup" aria-label="Part weight source">
        <button
          type="button"
          role="radio"
          aria-checked={s.weightMode === 'direct'}
          className={`segment${s.weightMode === 'direct' ? ' active' : ''}`}
          data-testid="weight-direct"
          onClick={() => update({ weightMode: 'direct' })}
        >
          Direct
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={s.weightMode === 'density'}
          className={`segment${s.weightMode === 'density' ? ' active' : ''}`}
          data-testid="weight-density"
          onClick={() => update({ weightMode: 'density' })}
        >
          Density × volume
        </button>
      </div>
      {s.weightMode === 'direct' ? (
        <WeightField
          label="Per part"
          canonical={s.partWeightG}
          unit={s.partWeightUnit}
          onCommit={(g) => update({ partWeightG: g })}
          onUnitChange={(partWeightUnit) => update({ partWeightUnit })}
          testid="part-weight"
        />
      ) : (
        <label className="field">
          <span className="field-label">Density</span>
          <span className="field-input">
            <input
              type="number"
              min={0}
              step="any"
              value={round4(s.densityGPerCm3)}
              data-testid="density"
              {...selectAllOnFocus}
              onChange={(e) => {
                const d = parseFloat(e.target.value)
                if (!Number.isNaN(d)) update({ densityGPerCm3: d })
              }}
            />
            <span className="field-unit">g/cm³</span>
          </span>
        </label>
      )}
    </div>
  )
}
