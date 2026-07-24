import { useAppStore } from '../store'
import { MODES, TIERS } from '../core/packing/types'

// mode-tier-selectors-ui + nesting-tier-disabled-stub (ADR-0003). Both selectors
// are driven by the contract's MODES/TIERS, so "nesting is disabled" is a single
// domain fact (TIERS[].enabled), not a UI hardcode.
export default function ModeTierSelectors() {
  const mode = useAppStore((s) => s.settings.mode)
  const tier = useAppStore((s) => s.settings.tier)
  const update = useAppStore((s) => s.updateSettings)

  return (
    <div className="controls" data-testid="mode-tier">
      <fieldset className="control-group">
        <legend>Mode</legend>
        <div className="segmented" role="radiogroup" aria-label="Packing mode">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              role="radio"
              aria-checked={mode === m.mode}
              className={`segment${mode === m.mode ? ' active' : ''}`}
              data-testid={`mode-${m.mode}`}
              onClick={() => update({ mode: m.mode })}
            >
              {m.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="control-group">
        <legend>Quality</legend>
        <div className="segmented" role="radiogroup" aria-label="Quality tier">
          {TIERS.map((t) => (
            <button
              key={t.tier}
              type="button"
              role="radio"
              aria-checked={tier === t.tier}
              disabled={!t.enabled}
              title={t.note ?? ''}
              className={`segment${tier === t.tier ? ' active' : ''}`}
              data-testid={`tier-${t.tier}`}
              onClick={() => t.enabled && update({ tier: t.tier })}
            >
              {t.label}
              {!t.enabled && <span className="segment-note"> — soon</span>}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  )
}
