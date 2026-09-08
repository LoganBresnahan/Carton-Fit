import { useEffect } from 'react'
import { documentHash, useAppStore } from '../store'
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
//
// SCOPED TO THE LOADED MODEL (ADR-0034 §3). The list knows what you are
// looking at: with a file loaded it shows that document's receipts, found by
// content hash, and says whose they are; *All* widens it to every row. The
// scope is a view, never a filter that loses things — no row leaves *All*,
// and nothing is deleted by a load.

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
  const scope = useAppStore((s) => s.estimatesScope)
  const setScope = useAppStore((s) => s.setEstimatesScope)
  const hash = useAppStore(documentHash)
  const fileName = useAppStore((s) => s.file?.name ?? null)

  // Storage may be unavailable (it opens lazily in main and is allowed to
  // fail); refreshSavedEstimates records that in storageError rather than
  // throwing, and StorageBanner shows it.
  // Re-queried on every change of what the list is scoped to: the scope
  // control, and the document — which is the hash, not the file name, so a
  // rename re-lists nothing and a re-export re-lists everything.
  useEffect(() => {
    void refreshSavedEstimates()
  }, [scope, hash])

  // 'model' with nothing to scope to reads as 'all' (store's rule); the copy
  // has to say which of the two the reader is looking at.
  const scoped = scope === 'model' && hash !== null

  return (
    <section className="panel-section" data-testid="saved-estimates-panel">
      <h2>Saved estimates</h2>

      <div
        className="estimate-scope"
        data-testid="estimates-scope"
        data-scope={scoped ? 'model' : 'all'}
      >
        <span className="muted">
          {scoped ? (
            <>
              For{' '}
              <span className="estimate-file" title={fileName ?? undefined}>
                {fileName}
              </span>
            </>
          ) : hash === null ? (
            'All — load a model to see just its estimates'
          ) : (
            'All models'
          )}
        </span>
        {hash !== null && (
          <button
            type="button"
            data-testid="estimates-scope-toggle"
            onClick={() => setScope(scoped ? 'all' : 'model')}
          >
            {scoped ? 'All' : 'This model'}
          </button>
        )}
      </div>

      {savedEstimates.length === 0 ? (
        <p className="muted" data-testid="estimates-empty">
          {scoped ? (
            <>
              No saved estimates for this model yet — press <strong>Save estimate</strong> on an
              answer worth keeping.
            </>
          ) : (
            <>
              No saved estimates yet — press <strong>Save estimate</strong> on an answer worth
              keeping.
            </>
          )}
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
