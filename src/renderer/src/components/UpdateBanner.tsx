import { useAppStore } from '../store'
import { openReleasePage } from '../update/service'

/**
 * "Version 1.1.0 is available · Download" — the entire update UI (ADR-0021 §4).
 *
 * Nothing downloads here, nothing installs, and nothing blocks: Download opens
 * the release page in the system browser and the user decides from there. That
 * is the point of the decision rather than a first step toward auto-update —
 * installing stays a human act for the same reason publishing does (ADR-0012),
 * and while the installer is unsigned a silent install would only move the
 * SmartScreen warning to a moment the user did not initiate.
 *
 * Dismissal is session-scoped: the banner returns on the next launch, and
 * deliberately nothing is written to localStorage to prevent that.
 */
export default function UpdateBanner(): React.JSX.Element | null {
  const update = useAppStore((s) => s.updateAvailable)
  const dismissed = useAppStore((s) => s.updateDismissed)
  const dismiss = useAppStore((s) => s.dismissUpdate)

  if (update === null || dismissed) return null

  const message = `Version ${update.version} is available`

  return (
    <div className="status-chip status-chip-info" data-testid="update-available">
      <span className="status-chip-label">Update</span>
      <span className="status-chip-message" title={message}>
        {message}
      </span>
      <button
        type="button"
        className="status-chip-action"
        data-testid="update-download"
        onClick={() => void openReleasePage()}
      >
        Download
      </button>
      <button
        type="button"
        className="status-chip-dismiss"
        data-testid="update-dismiss"
        aria-label="Dismiss update message"
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  )
}
