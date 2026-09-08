import { useEffect, useRef, useState } from 'react'
import ConnectPanel from './ConnectPanel'

// The connect surface's home in the header (ADR-0034 §5). Setup, done once,
// two verbs: it was the hardest thing in the app to find at the bottom of the
// scrolling column, beneath every preset and receipt. A control beside the
// theme picker opens it as a native `<dialog>` — modal, so Escape and a Close
// button both dismiss it, and the by-hand fields (blocks of JSON) get the
// width a popover in a 360px column could not give them.
//
// The panel MOUNTS ON OPEN, not at launch: its status check spawns another
// program's CLI (ADR-0030), and the app should not run one to draw a header.
// Nothing about the panel's contracts changes here — only where its trigger
// sits.

export default function ConnectButton(): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const el = dialog.current
    if (el === null) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <>
      <button
        type="button"
        className="connect-open"
        data-testid="connect-open"
        title="Let an AI assistant measure parts and run estimates in this app"
        onClick={() => setOpen(true)}
      >
        AI assistants
      </button>
      <dialog
        ref={dialog}
        className="connect-dialog"
        data-testid="connect-dialog"
        aria-label="AI assistants"
        onClose={() => setOpen(false)}
      >
        {open && (
          <>
            <ConnectPanel />
            <div className="connect-dialog-actions">
              <button type="button" data-testid="connect-close" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  )
}
