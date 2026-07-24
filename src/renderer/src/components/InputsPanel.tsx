import { useAppStore } from '../store'
import {
  gToWeight,
  lengthToMm,
  lengthUnitLabel,
  mmToLength,
  weightToG,
  weightUnitLabel,
  type UnitSystem
} from '../core/units'
import type { Vec3 } from '../core/packing/types'

// The inputs panel (roadmap item 3 / ADR-0004). Storage is canonical mm/g; this
// component is the ONLY place that converts — display via mmToLength/gToWeight,
// commit via lengthToMm/weightToG. A mm⇄in toggle flips the display unit only.

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4

function NumberField(props: {
  label: string
  canonical: number
  unitSystem: UnitSystem
  kind: 'length' | 'weight'
  onCommit: (canonical: number) => void
  testid?: string
}) {
  const { label, canonical, unitSystem, kind, onCommit, testid } = props
  const display = kind === 'length' ? mmToLength(canonical, unitSystem) : gToWeight(canonical, unitSystem)
  const unit = kind === 'length' ? lengthUnitLabel(unitSystem) : weightUnitLabel(unitSystem)
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="number"
          min={0}
          step="any"
          value={round4(display)}
          data-testid={testid}
          onChange={(e) => {
            const d = parseFloat(e.target.value)
            if (Number.isNaN(d)) return
            onCommit(kind === 'length' ? lengthToMm(d, unitSystem) : weightToG(d, unitSystem))
          }}
        />
        <span className="field-unit">{unit}</span>
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
          {lengthUnitLabel(s.unitSystem)} / {weightUnitLabel(s.unitSystem)}
        </button>
      </div>

      {[0, 1, 2].map((i) => (
        <NumberField
          key={i}
          label={dimLabels[i]}
          canonical={s.boxDimsMm[i]}
          unitSystem={s.unitSystem}
          kind="length"
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
          kind="length"
          onCommit={(mm) => update({ wallMm: mm })}
          testid="wall"
        />
      )}

      <h2>Clearances</h2>
      <NumberField
        label="Between parts"
        canonical={s.clearancePartMm}
        unitSystem={s.unitSystem}
        kind="length"
        onCommit={(mm) => update({ clearancePartMm: mm })}
        testid="clearance-part"
      />
      <NumberField
        label="To wall"
        canonical={s.clearanceWallMm}
        unitSystem={s.unitSystem}
        kind="length"
        onCommit={(mm) => update({ clearanceWallMm: mm })}
        testid="clearance-wall"
      />

      <h2>Weight</h2>
      <NumberField
        label="Max package"
        canonical={s.maxWeightG}
        unitSystem={s.unitSystem}
        kind="weight"
        onCommit={(g) => update({ maxWeightG: g })}
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
        <NumberField
          label="Per part"
          canonical={s.partWeightG}
          unitSystem={s.unitSystem}
          kind="weight"
          onCommit={(g) => update({ partWeightG: g })}
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
