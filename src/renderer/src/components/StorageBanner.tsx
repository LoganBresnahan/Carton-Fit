import { useAppStore } from '../store'

/**
 * The one always-visible place storage trouble is reported.
 *
 * Storage is optional by design — main opens the database lazily and tolerates
 * failure (ADR-0007) — which is exactly why a failure has to be *said*. The
 * original report lived inside the configurations panel, at the bottom of a
 * scrolling column, so a user who never scrolled there was never told that
 * their saves were not saving and their history was not being kept. Silence
 * read as success.
 *
 * It now lives in the header (ADR-0021 §5). That started as a place to put the
 * update banner and turned into a fix for this one: the control column is the
 * narrowest region in the window, so a sentence wrapped to three lines, every
 * line was taken from the drop zone directly beneath it, and a condition that
 * degrades presets, saved estimates and the Save button was scoped to the
 * inputs. The header cannot scroll, so item 9's requirement stops being an
 * arrangement of flex siblings a refactor could undo and becomes structural.
 *
 * Dismissal is per OCCURRENCE, not per banner — see `storageErrorSeq` in the
 * store for why the counter, and not the message, is what it keys on.
 */
export default function StorageBanner(): React.JSX.Element | null {
  const storageError = useAppStore((s) => s.storageError)
  const seq = useAppStore((s) => s.storageErrorSeq)
  const dismissedSeq = useAppStore((s) => s.dismissedStorageSeq)
  const dismiss = useAppStore((s) => s.dismissStorageError)

  if (storageError === null || seq <= dismissedSeq) return null

  return (
    <div className="status-chip status-chip-warn" data-testid="storage-error" role="alert">
      {/* The label and the amber survive truncation, so at any window width the
          user still sees that something is wrong even when the sentence is cut. */}
      <span className="status-chip-label">Storage</span>
      <span className="status-chip-message" title={storageError}>
        {storageError}
      </span>
      <button
        type="button"
        className="status-chip-dismiss"
        data-testid="storage-error-dismiss"
        aria-label="Dismiss storage message"
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  )
}
