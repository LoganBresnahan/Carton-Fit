import { useEffect } from 'react'
import { useAppStore } from '../store'
import { refreshSavedEstimates, restoreEstimateSettings } from '../storage/estimates'
import { estimateSummary, formatSavedAt } from '../packing/summary'
import type { EstimateRow } from '../../../shared/storage'

// Saved estimates — the receipts (ADR-0016), distinct from presets.
//
// VOCABULARY IS THE DESIGN HERE. Two lists of saved things now sit in the same
// column and users will conflate them unless the copy refuses to let them: a
// PRESET is a reusable carton setup with no part attached; a SAVED ESTIMATE is
// an answer about a specific part, with the settings that produced it. Hence
// "Restore inputs" rather than "Load" — the word has to say that what comes
// back is the inputs, not the answer.

/** More than this and the panel becomes a scrolling wall; the rest stay queryable. */
const SHOWN = 12

function EstimateItem({ row }: { row: EstimateRow }): React.JSX.Element {
  return (
    <li data-testid="estimate-item">
      <div className="estimate-line">
        <span className="estimate-file" title={row.fileName}>
          {row.fileName}
        </span>
        <span className="estimate-when">{formatSavedAt(row.createdAt)}</span>
      </div>
      <div className="estimate-line">
        <span className="estimate-summary" data-testid="estimate-summary">
          {estimateSummary(row)}
        </span>
        <button
          type="button"
          data-testid={`estimate-restore-${row.id}`}
          title="Put this estimate's inputs back — the result is recomputed, not replayed"
          onClick={() => restoreEstimateSettings(row)}
        >
          Restore inputs
        </button>
      </div>
    </li>
  )
}

export default function SavedEstimatesPanel(): React.JSX.Element {
  const savedEstimates = useAppStore((s) => s.savedEstimates)

  // Storage may be unavailable (it opens lazily in main and is allowed to
  // fail); refreshSavedEstimates records that in storageError rather than
  // throwing, and StorageBanner shows it.
  useEffect(() => {
    void refreshSavedEstimates()
  }, [])

  return (
    <section className="panel-section" data-testid="saved-estimates-panel">
      <h2>Saved estimates</h2>

      {savedEstimates.length === 0 ? (
        <p className="muted" data-testid="estimates-empty">
          No saved estimates yet — press <strong>Save estimate</strong> on an answer
          worth keeping.
        </p>
      ) : (
        <ul className="estimate-list" data-testid="estimate-list">
          {savedEstimates.slice(0, SHOWN).map((row) => (
            <EstimateItem key={row.id} row={row} />
          ))}
        </ul>
      )}

      {savedEstimates.length > SHOWN && (
        <p className="muted estimate-more" data-testid="estimates-more">
          Showing the {SHOWN} most recent of {savedEstimates.length}.
        </p>
      )}
    </section>
  )
}
