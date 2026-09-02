import { useEffect, useState } from 'react'
import type { ClientStatus, ConnectClientId } from '../../../shared/connect'
import { connectClient, connectStatus } from '../connect/service'
import ConnectClientRow from './ConnectClientRow'

// "Connect" (ADR-0029's button, ADR-0030's panel) — the whole setup story for
// the MCP server, in one section.
//
// ADR-0029 resolved this as "a button, not JSON": the audience is non-technical
// internal users, and a feature whose install step is hand-editing another
// program's config file is one most of them will never turn on. What the button
// writes is exactly the `--mcp` shim invocation the e2e specs drive.
//
// ADR-0030 made it a LIST, and the list is main's answer, not ours. This panel
// renders one row per status `connect:status` returned, in the order it
// returned them — it does not know which clients exist, does not filter out the
// ones that are not installed (an undetected client says so in its own row,
// Consequence 5), and does not invent a row for a client this build may not
// carry. That is the same discipline as the id lookup in main: the registry is
// the authority on the set of clients, in both directions.
//
// STATE IS LOCAL, not in the store (ADR-0006). Nothing else in the app reads
// this — it is not part of the estimate's data spine, it is the state of other
// applications' configuration — so putting it in the store would buy re-renders
// for every subscriber and nothing else.

export default function ConnectPanel(): React.JSX.Element {
  const [clients, setClients] = useState<ClientStatus[] | null>(null)
  /** The one id currently being written, or null. Per-id rather than a single
   *  boolean: two clients are two unrelated programs, and a slow Codex spawn
   *  must not disable the Claude Desktop button beside it. */
  const [busy, setBusy] = useState<ConnectClientId | null>(null)
  /** Keyed by client id, so the restart line belongs to the row that just
   *  wrote — connecting Codex must not put "restart" under Claude Desktop. */
  const [justWrote, setJustWrote] = useState<Partial<Record<ConnectClientId, boolean>>>({})

  useEffect(() => {
    let live = true
    void connectStatus().then((all) => {
      if (live) setClients(all)
    })
    return () => {
      live = false
    }
  }, [])

  if (clients === null) {
    return (
      <section className="panel-section" data-testid="connect-panel">
        <h2>AI assistants</h2>
        <p className="muted" data-testid="connect-checking">
          Checking…
        </p>
      </section>
    )
  }

  const onConnect = (id: ConnectClientId): void => {
    setBusy(id)
    void connectClient(id)
      .then((next) => {
        // Replace one row by id rather than re-reading every client: the other
        // rows describe programs this click did not touch, and re-running their
        // status would spawn another CLI to learn nothing.
        setClients((all) => (all ?? []).map((one) => (one.id === id ? next : one)))
        setJustWrote((all) => ({ ...all, [id]: next.state === 'connected' }))
      })
      .finally(() => setBusy(null))
  }

  return (
    <section className="panel-section" data-testid="connect-panel">
      <h2>AI assistants</h2>
      <p className="panel-hint">Let an AI assistant measure parts and run estimates in this app.</p>
      <ul className="connect-list">
        {clients.map((client) => (
          <ConnectClientRow
            key={client.id}
            status={client}
            justWrote={justWrote[client.id] === true}
            busy={busy === client.id}
            onConnect={() => onConnect(client.id)}
          />
        ))}
      </ul>
    </section>
  )
}
