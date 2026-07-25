import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import { saveEstimate } from '../storage/estimates'

// "Keep this one" (ADR-0016). The moment the user declares an estimate is an
// answer rather than a step on the way to one — which is the single bit of
// information auto-recording could never supply.

/** How long the confirmation stays up. Long enough to read, short enough that
 *  it cannot be mistaken for the button's resting state. */
const CONFIRM_MS = 1800

export default function SaveEstimateButton(): React.JSX.Element {
  const status = useAppStore((s) => s.packStatus)
  const hasResult = useAppStore((s) => s.packResult !== null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The confirmation outlives the click, so it has to be cancelled if the panel
  // unmounts (a new import clears the result) or React StrictMode remounts us.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  // Saving a stale estimate would file a receipt for an answer no longer on
  // screen, so the button is only live when the displayed estimate is current.
  const ready = status === 'done' && hasResult && !busy

  return (
    <button
      type="button"
      className="save-estimate"
      data-testid="save-estimate"
      disabled={!ready}
      title="Keep this estimate in saved estimates"
      onClick={() => {
        setBusy(true)
        void saveEstimate()
          .then((ok) => {
            if (!ok) return
            setSaved(true)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => setSaved(false), CONFIRM_MS)
          })
          .finally(() => setBusy(false))
      }}
    >
      {saved ? 'Saved ✓' : 'Save estimate'}
    </button>
  )
}
