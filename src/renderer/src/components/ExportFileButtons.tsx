import { useEffect, useRef, useState } from 'react'
import { resolvedView, useAppStore } from '../store'
import { saveCsv, savePng, type SaveOutcome } from '../export/save'

// Save CSV / Save PNG (ADR-0017 §1).
//
// One component for both because they share every piece of state — readiness,
// the in-flight guard, and the one line of feedback beneath them. Splitting
// them would mean two copies of that and two places for the feedback to appear.
//
// Export failures surface HERE, next to the button that was pressed, not in the
// storage banner: that banner means "the app cannot remember things", and
// borrowing it for "this folder is read-only" would make both messages vaguer.

const CONFIRM_MS = 2400

export default function ExportFileButtons(): React.JSX.Element {
  const status = useAppStore((s) => s.packStatus)
  const hasResult = useAppStore((s) => s.packResult !== null)
  const viewMode = useAppStore((s) => s.viewMode)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const ready = status === 'done' && hasResult && !busy
  // The PNG is a picture of the PACKED view; offering it while the model view
  // is pinned would save a file that does not show what the estimate says.
  const packedShowing = resolvedView(viewMode, hasResult) === 'packed'

  function announce(outcome: SaveOutcome): void {
    // Cancelling is a decision, not a result — say nothing at all.
    if (!outcome.saved && !outcome.error) return
    setMessage(
      outcome.error ? { text: outcome.error, failed: true } : { text: 'Saved ✓', failed: false }
    )
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(null), CONFIRM_MS)
  }

  function run(action: () => Promise<SaveOutcome>): void {
    setBusy(true)
    void action()
      .then(announce)
      .finally(() => setBusy(false))
  }

  return (
    <>
      {/* The two file exports wrap as a UNIT. Left as four loose buttons the
          row breaks 3 + 1 and strands PNG on a line of its own; as a group it
          breaks 2 + 2, which also reads as what it is — keep, copy, then the
          two things that write a file. */}
      <div className="export-group">
        <button
          type="button"
          className="save-estimate"
          data-testid="export-csv"
          disabled={!ready}
          title="Save the per-part measurements as a CSV spreadsheet"
          onClick={() => run(saveCsv)}
        >
          CSV
        </button>
        <button
          type="button"
          className="save-estimate"
          data-testid="export-png"
          disabled={!ready || !packedShowing}
          title={
            packedShowing
              ? 'Save the packed view as a PNG image'
              : 'Switch to the packed view to save it as an image'
          }
          onClick={() => run(savePng)}
        >
          PNG
        </button>
      </div>
      {message && (
        <p
          className={`export-message${message.failed ? ' failed' : ''}`}
          data-testid="export-message"
          role={message.failed ? 'alert' : undefined}
        >
          {message.text}
        </p>
      )}
    </>
  )
}
