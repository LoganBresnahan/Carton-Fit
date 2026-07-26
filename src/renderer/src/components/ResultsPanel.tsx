import { useAppStore } from '../store'
import {
  bindingLabel,
  openMeshWarning,
  packedWeightG,
  truncatedLayoutNote,
  utilizationPercent,
  verdictCaption,
  verdictHeadline
} from '../packing/verdict'
import { openMeshParts } from '../packing/request'
import SaveEstimateButton from './SaveEstimateButton'
import CopySummaryButton from './CopySummaryButton'
import ExportFileButtons from './ExportFileButtons'
import { gToWeight, weightUnitLabel } from '../core/units'

// Thin declarative island (ADR-0006): reads the pack slice and renders the
// estimate. No logic beyond formatting — the engine produced every number, and
// packing/verdict.ts owns the wording.

const round2 = (x: number): number => Math.round(x * 100) / 100

export default function ResultsPanel() {
  const status = useAppStore((s) => s.packStatus)
  const result = useAppStore((s) => s.packResult)
  const request = useAppStore((s) => s.packRequest)
  const error = useAppStore((s) => s.packError)
  const elapsedMs = useAppStore((s) => s.packElapsedMs)
  const unitSystem = useAppStore((s) => s.settings.unitSystem)
  const parts = useAppStore((s) => s.parts)
  const settings = useAppStore((s) => s.settings)
  const unitPartName = useAppStore((s) => s.unitPartName)
  const partWeightsG = useAppStore((s) => s.partWeightsG)

  // Cheap after the first call per part (memoized in packing/request.ts), and
  // skipped entirely outside density mode. Overrides are passed because a kind
  // with an entered weight no longer depends on its volume (ADR-0018 §4).
  const openMesh = openMeshWarning(
    openMeshParts(parts, settings, unitPartName, partWeightsG)
  )

  if (status === 'idle' && !result) return null

  if (status === 'failed') {
    return (
      <section className="results" data-testid="results-panel" data-status="failed">
        <h2>Estimate</h2>
        <p className="results-error" data-testid="results-error">
          {error}
        </p>
      </section>
    )
  }

  if (!result) {
    return (
      <section className="results" data-testid="results-panel" data-status={status}>
        <h2>Estimate</h2>
        <p className="results-pending">Packing…</p>
      </section>
    )
  }

  // While a new pack is in flight the previous result stays on screen, dimmed —
  // steadier than blanking the panel on every keystroke.
  const stale = status === 'packing'
  const truncated = truncatedLayoutNote(result)

  return (
    <section
      className={`results${stale ? ' stale' : ''}`}
      data-testid="results-panel"
      data-status={status}
      data-mode={result.mode}
    >
      <div className="results-head">
        <h2>Estimate</h2>
        {/* Keeping it and taking it away sit together: both act on the estimate
            currently on screen, and both are disabled while one is in flight. */}
        <div className="results-actions">
          <SaveEstimateButton />
          <CopySummaryButton />
          <ExportFileButtons />
        </div>
      </div>

      <p className="results-headline" data-testid="results-headline">
        {verdictHeadline(result)}
        {result.mode === 'max-quantity' && <span className="results-unit"> fit</span>}
      </p>

      <p className="results-caption" data-testid="results-caption">
        {verdictCaption(result)}
      </p>

      {/* Qualifies the whole answer, not just the weight line: a wrong weight
          produces a wrong count and can mis-attribute the binding constraint.
          So it sits above the facts, where the reader cannot take the number
          and leave. */}
      {openMesh && (
        <p className="results-warning" data-testid="results-open-mesh" role="alert">
          {openMesh}
        </p>
      )}

      <dl className="results-facts">
        <div>
          <dt>Limited by</dt>
          <dd data-testid="results-binding">{bindingLabel(result.binding)}</dd>
        </div>
        <div>
          <dt title="Share of the carton filled by part bounding boxes">Fill</dt>
          <dd data-testid="results-utilization">{utilizationPercent(result.utilization)}</dd>
        </div>
        <div>
          <dt>Quality</dt>
          <dd data-testid="results-tier">{result.tier}</dd>
        </div>
      </dl>

      {/* Weight is a hard cap (ADR-0004), so show what the packing spends
          against it — a limit with no running total can't be steered by. */}
      {request && (
        <p className="results-weight" data-testid="results-weight">
          <span className="results-weight-value">
            {round2(gToWeight(packedWeightG(result, request), unitSystem)).toLocaleString()}
          </span>
          {' of '}
          {Number.isFinite(request.maxWeightG)
            ? round2(gToWeight(request.maxWeightG, unitSystem)).toLocaleString()
            : '∞'}{' '}
          {weightUnitLabel(unitSystem)}
        </p>
      )}

      {truncated && (
        <p className="results-note" data-testid="results-truncated">
          {truncated}
        </p>
      )}

      {result.mode === 'fit-check' && result.unplaced.length > 0 && (
        <>
          <h3 className="results-subhead">Did not fit</h3>
          <ul className="results-unplaced" data-testid="results-unplaced">
            {result.unplaced.map((name, i) => (
              <li key={`${name}-${i}`}>{name}</li>
            ))}
          </ul>
        </>
      )}

      {elapsedMs !== null && (
        <p className="results-meta">{Math.round(elapsedMs)} ms</p>
      )}
    </section>
  )
}
