import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import { collectExport } from '../export/collect'
import { buildSummary } from '../export/summary'

// Copy the estimate as text (ADR-0017 §1) — the paste-into-a-quote action.
//
// Sits beside Save estimate and shares its readiness rule: an estimate that is
// mid-repack is not the one on screen, and a clipboard write is silent, so
// there would be nothing to notice the mistake by.

/** How long the confirmation stays up — matched to Save estimate's, since the
 *  two buttons sit together and a different dwell reads as a different kind of
 *  event. */
const CONFIRM_MS = 1800

export default function CopySummaryButton(): React.JSX.Element {
  const status = useAppStore((s) => s.packStatus)
  const hasResult = useAppStore((s) => s.packResult !== null)
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const ready = status === 'done' && hasResult

  function flash(ok: boolean): void {
    setCopied(ok)
    setFailed(!ok)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setCopied(false)
      setFailed(false)
    }, CONFIRM_MS)
  }

  return (
    <button
      type="button"
      className="save-estimate"
      data-testid="copy-summary"
      disabled={!ready}
      title="Copy this estimate as text — carton, constraints, answer and any warnings"
      onClick={() => {
        const input = collectExport()
        // Null means the estimate moved under us between render and click; the
        // honest response is to do nothing rather than copy a superseded answer.
        if (!input) return
        void navigator.clipboard
          .writeText(buildSummary(input))
          .then(() => flash(true))
          // Clipboard access can be refused by the platform. Saying so beats a
          // button that appears to work and silently copies nothing.
          .catch(() => flash(false))
      }}
    >
      {copied ? 'Copied ✓' : failed ? 'Copy failed' : 'Copy summary'}
    </button>
  )
}
