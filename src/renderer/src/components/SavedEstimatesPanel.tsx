import { useEffect, useState } from 'react'
import { documentHash, useAppStore } from '../store'
import {
  acceptLinkOffer,
  declineLinkOffer,
  deleteEstimate,
  refreshLinkOffer,
  refreshSavedEstimates,
  restoreEstimateSettings
} from '../storage/estimates'
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

// No cap on rows. There was one (12, "the rest stay queryable") from when the
// list sat open in the column; inside a fold the column scrolls and a cap
// only hid receipts the person went looking for (first sidebar dogfood,
// 2026-09-08). The query's own limit still applies.

/** How long a deleted row takes to fade before it leaves the list. Long
 *  enough to be seen going, short enough not to feel like a confirm step. */
const REMOVE_MS = 220

// The section is a native `<details>` (ADR-0034 §5) — the pattern
// ConnectClientRow's "Set it up by hand" already uses — with the document's
// count in the summary line, so a closed section still says what it holds.
// Whether it is open is remembered in its own localStorage key (ADR-0026 §6's
// rule: one key per concern, never inside the settings blob), because a
// person who opens it wants it open next time too. Closed by default: the
// count is the glance, the list is the visit.
const OPEN_KEY = 'carton-fit:saved-estimates-open'

function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === 'true'
  } catch {
    return false
  }
}

function storeOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, String(open))
  } catch {
    /* a remembered fold is a convenience, not data */
  }
}

/** The summary line's count: how many receipts, and whose. */
function countLabel(count: number, scoped: boolean, hash: string | null): string {
  if (count === 0) return 'none yet'
  if (scoped) return `${count} for this model`
  if (hash !== null) return `${count} across all models`
  return String(count)
}

function EstimateItem({
  row,
  earlierVersion,
  customerName,
  removing,
  onDelete
}: {
  row: EstimateRow
  /** Saved against another hash in the loaded document (ADR-0034 §3). */
  earlierVersion: boolean
  /** Whose receipt (ADR-0035 §2). Null while no customers exist — then there
   *  is nothing to tell apart and no row is labelled; once one exists, house
   *  rows say "House", so a scoped list under Acme reads house from Acme's
   *  (first sidebar pass on item 27, 2026-09-08). */
  customerName: string | null
  /** Fading out: Delete was pressed and the row is on its way. */
  removing: boolean
  onDelete: () => void
}): React.JSX.Element {
  return (
    <li
      data-testid="estimate-item"
      data-earlier-version={earlierVersion || undefined}
      className={removing ? 'removing' : undefined}
      aria-busy={removing || undefined}
    >
      <div className="estimate-line">
        <span className="estimate-file" title={row.fileName}>
          {row.fileName}
          {customerName !== null && (
            <>
              {' · '}
              <span className="estimate-customer" data-testid="estimate-customer">
                {customerName}
              </span>
            </>
          )}
        </span>
        <span className="estimate-when">
          {earlierVersion && (
            <span
              className="estimate-version"
              data-testid="estimate-earlier-version"
              title="Saved against an earlier version of this model — restoring recomputes against the geometry loaded now"
            >
              earlier version ·{' '}
            </span>
          )}
          {formatSavedAt(row.createdAt)}
        </span>
      </div>
      <div className="estimate-line">
        <span className="estimate-summary" data-testid="estimate-summary">
          {estimateSummary(row)}
        </span>
        <span className="estimate-actions">
          <button
            type="button"
            data-testid={`estimate-restore-${row.id}`}
            title="Put this estimate's inputs back — the result is recomputed, not replayed"
            onClick={() => restoreEstimateSettings(row)}
          >
            Restore inputs
          </button>
          <button
            type="button"
            data-testid={`estimate-delete-${row.id}`}
            title="Discard this saved estimate — not undoable"
            disabled={removing}
            onClick={onDelete}
          >
            Delete
          </button>
        </span>
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
  const linkOffer = useAppStore((s) => s.linkOffer)
  const activeCustomerId = useAppStore((s) => s.activeCustomerId)
  const customers = useAppStore((s) => s.customers)
  const [open, setOpen] = useState(loadOpen)
  const customerName = (id: number | null): string | null => {
    if (customers.length === 0) return null
    if (id === null) return 'House'
    return customers.find((c) => c.id === id)?.name ?? `customer #${id}`
  }
  // Rows fading out. The delete itself waits for the fade, so the next row
  // does not snap into the gap before the eye has seen something leave
  // (first sidebar dogfood, 2026-09-08: "makes the user wonder if they
  // actually deleted something").
  const [removing, setRemoving] = useState<ReadonlySet<number>>(() => new Set())
  const remove = (id: number): void => {
    setRemoving((all) => new Set(all).add(id))
    window.setTimeout(() => {
      void deleteEstimate(id).finally(() =>
        setRemoving((all) => {
          const next = new Set(all)
          next.delete(id)
          return next
        })
      )
    }, REMOVE_MS)
  }

  // Storage may be unavailable (it opens lazily in main and is allowed to
  // fail); refreshSavedEstimates records that in storageError rather than
  // throwing, and StorageBanner shows it.
  // Re-queried on every change of what the list is scoped to: the scope
  // control, and the document — which is the hash, not the file name, so a
  // rename re-lists nothing and a re-export re-lists everything.
  // …and the customer (ADR-0035 §3), which the scoped list filters on.
  useEffect(() => {
    void refreshSavedEstimates()
  }, [scope, hash, activeCustomerId])
  // The link offer is a question about the LOAD, so it follows the hash only:
  // widening to All must not re-ask it, and the answer is per load.
  useEffect(() => {
    void refreshLinkOffer()
  }, [hash])

  // 'model' with nothing to scope to reads as 'all' (store's rule); the copy
  // has to say which of the two the reader is looking at.
  const scoped = scope === 'model' && hash !== null

  return (
    <section className="panel-section saved-estimates" data-testid="saved-estimates-panel">
      {/* The offer is a question about the load, so it sits above the fold
          and is visible whether or not the section is open. */}
      {linkOffer !== null && (
        <div className="estimate-link-offer" data-testid="estimate-link-offer" role="status">
          <span>
            {linkOffer.count === 1
              ? '1 saved estimate exists'
              : `${linkOffer.count} saved estimates exist`}{' '}
            for an earlier <span className="estimate-file">{linkOffer.fileName}</span> — treat
            this as a new version?
          </span>
          <span className="estimate-link-actions">
            <button
              type="button"
              data-testid="estimate-link-accept"
              title="Its saved estimates join this model's list; restoring one recomputes against the geometry loaded now"
              onClick={() => void acceptLinkOffer()}
            >
              Link
            </button>
            <button type="button" data-testid="estimate-link-decline" onClick={declineLinkOffer}>
              Keep separate
            </button>
          </span>
        </div>
      )}

      <details
        data-testid="saved-estimates-details"
        open={open}
        onToggle={(event) => {
          const next = event.currentTarget.open
          setOpen(next)
          storeOpen(next)
        }}
      >
        <summary>
          <h2>Saved estimates</h2>
          <span className="estimate-count" data-testid="estimates-count">
            {countLabel(savedEstimates.length, scoped, hash)}
          </span>
        </summary>

        <div className="estimate-body">
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
            {/* Both states visible, the active one lit — the same control
                Mode and Quality use. A single button that named the OTHER
                state read as naming the current one (first sidebar dogfood,
                2026-09-08): "This model" showed while the list was All. */}
            {hash !== null && (
              <div
                className="segmented small estimate-scope-switch"
                role="radiogroup"
                aria-label="Which saved estimates to list"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={scoped}
                  className={`segment${scoped ? ' active' : ''}`}
                  data-testid="estimates-scope-model"
                  onClick={() => setScope('model')}
                >
                  This model
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!scoped}
                  className={`segment${scoped ? '' : ' active'}`}
                  data-testid="estimates-scope-all"
                  onClick={() => setScope('all')}
                >
                  All
                </button>
              </div>
            )}
          </div>

          {savedEstimates.length === 0 ? (
            <p className="muted" data-testid="estimates-empty">
              {scoped ? (
                <>
                  No saved estimates for this model yet — press{' '}
                  <strong>Save estimate</strong> on an answer worth keeping.
                </>
              ) : (
                <>
                  No saved estimates yet — press <strong>Save estimate</strong> on an answer
                  worth keeping.
                </>
              )}
            </p>
          ) : (
            <ul className="estimate-list" data-testid="estimate-list">
              {savedEstimates.map((row) => (
                <EstimateItem
                  key={row.id}
                  row={row}
                  earlierVersion={scoped && row.contentHash !== hash}
                  customerName={customerName(row.customerId)}
                  removing={removing.has(row.id)}
                  onDelete={() => remove(row.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </details>
    </section>
  )
}
