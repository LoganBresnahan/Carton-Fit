import { useEffect, useState } from 'react'
import type { ClientStatus } from '../../../shared/connect'
import { connectClient, connectStatus } from '../connect/service'

// "Connect to Claude" (ADR-0029, slice `connect-to-claude-button`) — the whole
// setup story for the MCP server, in one button.
//
// The ADR resolved this as "a button, not JSON": the audience is non-technical
// internal users, and a feature whose install step is hand-editing another
// program's config file is one most of them will never turn on. What the button
// writes is exactly the `--mcp` shim invocation the e2e specs drive.
//
// ADR-0030 put this panel behind a client registry: it now asks for a LIST of
// client states and picks its one row out of it. The panel of rows the ADR
// describes is `connect-panel-rows`; until then this stays a Claude-shaped
// panel over a client-agnostic service, which is what keeps the phase-6 e2e
// asserting the same thing through the rename.
//
// STATE IS LOCAL, not in the store (ADR-0006). Nothing else in the app reads
// this — it is not part of the estimate's data spine, it is the state of
// another application's config file — so putting it in the store would buy
// re-renders for every subscriber and nothing else.
//
// THE RESTART LINE IS THE FEATURE, NOT A FOOTNOTE. Claude Desktop reads its
// config at startup, so a correct write still connects nothing until it is
// restarted. Without that sentence the successful case looks exactly like the
// broken one, and the user's next move is to doubt the button.

export default function ClaudeConnectPanel(): React.JSX.Element {
  const [status, setStatus] = useState<ClientStatus | null>(null)
  const [busy, setBusy] = useState(false)
  /** Set only by a click that wrote the file — so the restart line appears for
   *  someone who just connected, and not for someone who was already connected
   *  when the panel mounted and has nothing to restart. */
  const [justWrote, setJustWrote] = useState(false)

  useEffect(() => {
    let live = true
    void connectStatus().then((all) => {
      const claude = all.find((one) => one.id === 'claude-desktop')
      if (live && claude !== undefined) setStatus(claude)
    })
    return () => {
      live = false
    }
  }, [])

  if (status === null) {
    return (
      <section className="panel-section" data-testid="claude-connect-panel">
        <h2>Claude</h2>
        <p className="muted">Checking Claude Desktop…</p>
      </section>
    )
  }

  const onClick = (): void => {
    setBusy(true)
    void connectClient('claude-desktop')
      .then((next) => {
        setStatus(next)
        setJustWrote(next.state === 'connected')
      })
      .finally(() => setBusy(false))
  }

  return (
    <section className="panel-section" data-testid="claude-connect-panel">
      <h2>Claude</h2>
      <p className="panel-hint">
        Let Claude Desktop measure parts and run estimates in this app.
      </p>

      {status.state === 'not-detected' ? (
        // No button at all rather than a disabled one: there is nothing to
        // enable it, and writing a config for a program that is not installed
        // would be litter under a name its owner never chose.
        <p className="muted" data-testid="claude-not-found">
          Claude Desktop isn’t installed on this computer. Install it, then come back.
        </p>
      ) : (
        <>
          <button
            type="button"
            className="save-estimate"
            data-testid="claude-connect"
            disabled={busy}
            title={`Adds Carton Fit to ${status.location}`}
            onClick={onClick}
          >
            {status.state === 'connected' ? 'Reconnect' : 'Connect to Claude'}
          </button>

          {status.state === 'connected' && (
            <p className="muted" data-testid="claude-connected">
              {justWrote
                ? 'Connected. Restart Claude Desktop to finish.'
                : 'Connected. Restart Claude Desktop if it was open when this was set up.'}
            </p>
          )}
          {status.state === 'outdated' && (
            <p className="muted" data-testid="claude-outdated">
              Claude Desktop points at a different copy of Carton Fit. Reconnect to point it here.
            </p>
          )}
          {status.state === 'not-connected' && (
            <p className="muted" data-testid="claude-not-connected">
              Not connected yet.
            </p>
          )}
          {status.state === 'error' && (
            // Loud, and it names the file (build-plan sequencing risk 5): the
            // failure mode this replaces is a button that looks like it worked
            // and a Claude Desktop that never connects.
            <p className="error" data-testid="claude-error">
              {status.problem} {status.location !== '' && `(${status.location})`}
            </p>
          )}
        </>
      )}
    </section>
  )
}
