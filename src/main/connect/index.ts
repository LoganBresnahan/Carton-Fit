import { ipcMain } from 'electron'
import { CONNECT_CHANNELS, type ClientStatus } from '../../shared/connect'
import { claudeDesktopClient } from './claude'
import { codexClient } from './codex'
import { pickClient, type ConnectClient } from './registry'

export type { ConnectClient } from './registry'

// The connect registry (ADR-0030 Decision 1) — the trunk every client adapter
// hangs on, and the one place an id becomes code.
//
// ADR-0029 shipped one client by writing its config file directly. ADR-0030's
// lesson from the MSIX finding is that the FILE is the wrong seam: where a
// client keeps its config, how it formats it and what else lives in it are all
// the client's to change. So the seam is the CLIENT, and how it is reached —
// its own tooling, its file, or copyable text — is that adapter's business.
//
// THE SECURITY LINE IS `pickClient` in `registry.ts` — Electron-free so its
// refusal of an unregistered id is pinned by a unit test rather than trusted.
//
// ADDING A THIRD CLIENT — the recipe, in the order the work goes. Decision 2's
// fixed order is step 2; none of the five steps is optional.
//
//   1. NAME IT ONCE. Add the id to `ConnectClientId` and its label to
//      `CONNECT_CLIENT_LABELS` in `shared/connect.ts`, then register the
//      adapter in `CLIENTS` below. Registration order is display order.
//
//   2. REACH IT THROUGH THE MECHANISM ITS OWNER SUPPORTS, preferred in this
//      order and no other:
//        a. the client's own tooling, when it exists and can be found —
//           `codex.ts` shells out to `codex mcp add/get`, which moves the
//           entire class of "where is the config, what format, what else is in
//           it" to the party that can keep it correct;
//        b. its config file, read-merge-write, when there is no tooling —
//           `claudeConfig.ts`: candidate list, has-a-config wins, refuse when
//           unparseable, temp-and-rename;
//        c. the entry as copyable text — ALWAYS, beside a or b, never only as
//           what you fall back to when they fail. It is what the user still
//           has on the machine we did not anticipate, and it touches no files.
//           Fields, not a command line (addendum 2): a `ManualEntry` the panel
//           renders per client.
//      Never invent a fourth mechanism, and never parse a format the client
//      owns to answer a question its tooling already answers (Decision 3 —
//      Codex's TOML is read by `codex mcp get --json`, never by us).
//
//   3. DO NOT COMPOSE THE LAUNCH. `shimEntry()` in `entry.ts` is the single
//      source of the command, its arguments and its environment; an adapter
//      only SERIALISES it (`codexAddArgv`, `codexManualFields`, Claude's JSON
//      block) and compares with `sameEntry()`. Two adapters composing the same
//      launch is how two clients drift apart while both look correct.
//      The env is not decoration. A client may hand the child NOTHING but what
//      the entry names — Codex does — so the keys `sessionEnvKeys()` returns
//      travel with the entry or the app never starts, the shim times out, and
//      the client shows the server connected with no tools (ADR-0030 addendum
//      3: found by dogfooding, catchable by no test we had).
//
//   4. ANSWER IN THE PANEL'S VOCABULARY. `status()` is total — every failure
//      arrives as `error`, never as a throw — and `outdated` is judged
//      asymmetrically, so an entry written by ANY older build reads as
//      outdated and one Reconnect repairs it. Keep the per-client restart line
//      (Decision 6): a client already listing the entry but not yet restarted
//      is exactly the confusing case that sentence exists for.
//
//   5. EXPOSE ONE ENV SEAM FOR E2E, then use it twice. Discovery must be
//      redirectable by a single variable that WINS OUTRIGHT and is not
//      existence-checked — `CODEX_CLI`, `CLAUDE_DESKTOP_CONFIG_DIR`, the shape
//      `UPDATE_CHECK_URL` gave its feature — so CI can drive the adapter
//      against a stand-in (`e2e/fake-codex/`) on a runner where the real
//      client does not exist. Then write the spec against the REAL client that
//      skips when it is absent (`e2e/codex-real-cli.spec.ts`), and say plainly
//      in it that the fake's green covers our half only (Decision 7). No CI
//      runner has ever had one of these clients on it; dogfooding is the other
//      half, and ADR-0032 is where it reports.

/**
 * One client, behind one interface.
 *
 * Note what is NOT a member: `detect()`. ADR-0030's sketch shows one, because
 * the Claude adapter has a directory probe by that name — but detection is not
 * a thing the seam ever needs to call separately. Every adapter already has to
 * answer "is it here?" as part of `status()`, and it answers in the vocabulary
 * the panel speaks (`not-detected`). Codex detects by finding a CLI and Claude
 * by finding a directory; making that a second public member would put the
 * *mechanism* back in the interface, which is the thing this ADR moved out.
 */
/** Registration order is display order — the confirmed client first
 *  (ADR-0030: Claude Desktop is proven by dogfooding, Codex is not yet). */
const CLIENTS: readonly ConnectClient[] = [claudeDesktopClient, codexClient]

/**
 * Every registered client's state, in registration order.
 *
 * CONCURRENTLY, and the order is restored by `Promise.all` rather than by
 * asking one client to wait for another: a Codex install that takes a second to
 * answer must not delay the Claude row, and the panel renders both together.
 */
export function connectStatus(): Promise<ClientStatus[]> {
  return Promise.all(CLIENTS.map((client) => client.status()))
}

export function registerConnectIpc(): void {
  ipcMain.handle(CONNECT_CHANNELS.status, (): Promise<ClientStatus[]> => connectStatus())
  ipcMain.handle(CONNECT_CHANNELS.connect, (_event, id: unknown): Promise<ClientStatus> =>
    pickClient(CLIENTS, id).connect()
  )
}
