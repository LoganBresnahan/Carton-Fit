# ADR-0030: A client-agnostic connect surface — each client's config through the mechanism its owner supports

Date: 2026-09-02
Status: Accepted 2026-09-02 (Proposed the same day; every open detail below
has a named resolution path, and the facts in Context were established on the
requesting machine, not assumed). Sequenced ahead of ADR-0031: smaller,
touches none of the same code, and has a waiting dogfooder.

Extends ADR-0029 (phase-6 addendum: the Connect to Claude button). Supersedes
nothing — it generalises a surface that was built for one client into one that
carries two, and records the rule that decides how a third would be added.

## Context

ADR-0029 phase 6 shipped "Connect to Claude": the app writes its own
`mcpServers` entry into `claude_desktop_config.json`, because the audience is
non-technical and a feature whose install step is hand-editing another
program's config is a feature most of them will never turn on. Within an hour
of the first Windows dogfood it produced its first finding — the Microsoft
Store build of Claude Desktop is MSIX-packaged and MSIX virtualises `%APPDATA%`,
so an installed Claude Desktop looked absent (ADR-0029 phase-6 addendum,
part 2). The fix was right; the lesson underneath it is what this ADR is about:
**writing a file that belongs to another application means inheriting every
assumption that application makes about its own filesystem**, and those
assumptions are neither documented nor stable.

Then the second client arrived. The request is "the same for ChatGPT, also
from the Microsoft Store", and establishing what that actually means on the
requesting machine (2026-09-02) changed the shape of the work:

- **What is installed is OpenAI Codex**, package `OpenAI.Codex_2p2nqsd0c76g0`,
  whose binary is literally `…\app\ChatGPT.exe`. The distinction is
  load-bearing: ChatGPT *web* accepts only remote MCP servers over HTTPS, which
  Carton Fit does not serve (ADR-0029 demoted the HTTP shape). Codex clients
  accept local stdio servers — and this machine already runs two of them
  (`node_repl`, `cua_repl`) from its config, so stdio MCP is proven for this
  client by the user's own file, not by documentation.
- **Codex's config is `~/.codex/config.toml`** (or `$CODEX_HOME/config.toml`)
  in the *real* home directory — not virtualised, despite the MSIX packaging.
  The MSIX problem does not recur; a different one does: **TOML, not JSON**,
  under `[mcp_servers.<name>]` tables. There is no TOML parser in the
  dependency tree and Node has none built in.
- **Codex ships its own CLI inside the desktop install** —
  `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`, `codex-cli 0.152.1` on
  the requesting machine, not on `PATH` — with a complete `mcp` subcommand:
  `add <name> [--env K=V]… -- <command>…`, `get <name> [--json]`,
  `list [--json]`, `remove <name>`. Probed against a throwaway `CODEX_HOME`
  seeded with a comment, an unrelated key and another server:
  - `add` appended `[mcp_servers.carton-fit]` plus a
    `[mcp_servers.carton-fit.env]` table and **preserved the comment, the key
    and the other server byte-for-byte**;
  - `add` again with the same name and a different command **replaced the
    entry in place** — idempotent, no duplicate table, which matters because
    TOML forbids defining a table twice and a naïve append would have produced
    an invalid file;
  - `get <name> --json` returns `{transport:{command,args,env}, enabled, …}`;
    `get` on an unknown name exits 1 with `No MCP server named '…' found.`;
  - `remove` works; nothing else was created in the config directory.

So for the second client the file need never be parsed or written by us at
all. That is not a convenience; it is the general rule this ADR adopts.

The user also asked the right question — *is the app writing the client's
config the best mechanism, or merely the one available from inside Carton
Fit?* Claude Desktop does have a first-class in-app install path: MCP Bundles
(`.mcpb`, formerly `.dxt`), dragged into Settings → Extensions, and the
requesting machine's Claude Desktop has that machinery enabled. It is the
better mechanism for an ordinary MCP server. Carton Fit's is not ordinary: the
server lives inside an installed desktop app and must reach that running app,
so a bundle would have to *find* the installed Carton Fit — a discovery
problem the button does not have, because the app writes its own
`process.execPath` and can re-point it (the `outdated` state). See
Alternatives.

## Addendum, 2026-09-02 (during phase 2)

Two Context facts above were established by probing the CLI. Probing the
*machine* while implementing `codex-cli-discovery` corrected one of them and
strengthened another.

**1. `bin` holds one directory per bundled TOOL, not per shipped version — so
"newest by mtime" is the wrong rule, not merely a heuristic.** On the
requesting machine the two directories are:

| directory | written | contents |
| --- | --- | --- |
| `87e5fb3433dabab1` | 12:15:34 | `codex.exe`, `codex-command-runner.exe`, `codex-code-mode-host.exe`, `codex-windows-sandbox-setup.exe` |
| `fce30c272acde6f9` | 12:15:37 | `rg.exe`, and nothing else |

The NEWEST directory is ripgrep. Decision 4's rule as written selects it, finds
no `codex.exe`, and reports Codex absent on the machine that asked for this
feature. **The rule is therefore "the directory that holds a `codex.exe`", with
mtime only ordering the candidates among several that do.** Implemented that
way in `connect/codexCli.ts` and pinned with the real hashes.

This also dissolves open detail 3 ("which `codex.exe` is the desktop app's"):
there is exactly one, so no disagreement is possible. It returns only if a
future install ships two.

**2. The "ChatGPT desktop app" and this Codex package are one program, and its
config is NOT virtualised.** Confirmed by the maintainer: the app offered at
`chatgpt.com/download` is installed here as the Store MSIX
`OpenAI.Codex_2p2nqsd0c76g0`, and no other OpenAI desktop install exists on the
machine. Its Settings → Plugins → MCPs lists `node_repl` — the server present
in the *real* `~/.codex/config.toml`. So the packaged app reads the same file an
unpackaged process sees, and the ADR-0029 MSIX trap (a virtualised `%APPDATA%`
splitting one path into two filesystems) **does not recur for this client**,
because its config was never under `%APPDATA%` to begin with. That is what makes
`codex mcp add`'s write visible to the app rather than a hopeful guess.

**3. The app has an in-app "Add" MCP server UI**, alongside a plugin
marketplace — the Codex analogue of Claude's `.mcpb` route, and subject to the
same objection in Alternatives: it is a GUI a person drives by hand, and the
audience for this feature is precisely the person who will not. Recorded so a
later reader knows it was seen and not overlooked.

## Addendum 2, 2026-09-02 (during phase 3): the fallback is fields, not a command line

Decision 2's third mechanism says "show the entry as copyable text… the
`codex mcp add …` command line for Codex". **That is revised: the fallback is
the values the client's own form asks for, in that form's own words.**

The maintainer's constraint, stated plainly: *users will be using these GUI
desktop apps, not a CLI.* A command line to paste into a terminal is an
instruction most of this app's audience cannot act on — the same audience
ADR-0029 built a button for rather than asking them to edit JSON. A fallback
only reachable by people who would not have needed it is not a fallback.

Codex's form settles the shape. Settings → Plugins → MCPs → Add → "Connect to
a custom MCP" takes **Name**, a **Type** toggle (STDIO / Streamable HTTP),
**Command to launch** in one box, then **Arguments one box per argument**
added a row at a time, **Environment variables** as separate Key and Value
inputs, plus an unused Working directory. A single quoted line is the wrong
artifact for that form twice over: the user would have to split it by hand at
the moment they are already stuck, and the paths in it contain the spaces that
make splitting by hand go wrong.

So `ClientStatus.manual` is a `ManualEntry` — an intro naming the client's own
menu path, and labelled fields — not a `string`. Claude Desktop, which has no
custom-server form, gets one `block` field carrying the JSON entry for its
Settings → Developer → Edit Config route. The seam is unchanged; only the
payload is richer.

**`quotedCommandLine` and its `CommandLineToArgvW` tokenizer, written in phase
1 for the old shape, are deleted rather than left unused.** Their Windows
quoting problem does not arise for a text input: a form field is not a shell,
and a stray quote there becomes part of the path.

The client's own tooling remains mechanism 1 and is unaffected — the CLI is
plumbing the user never sees, spawned with no window, and Codex ships it
inside the desktop app.

## Addendum 3, 2026-09-03 (first ChatGPT dogfood): the entry must launch from an empty environment

The first real ChatGPT dogfood produced a state no test had a name for:
**Carton Fit appeared in ChatGPT's MCP list, enabled, and advertised no
tools.** The settings screen showed exactly what we had written — the command,
both arguments, `ELECTRON_RUN_AS_NODE = 1` — so every part of this ADR's write
path was correct. What was missing was not in our entry; it was everything
*around* it.

OpenAI documents the mechanism: **Codex hands a stdio MCP child only the
variables its entry declares** (`env`), or names for forwarding (`env_vars` —
the "Environment variable passthrough" box in its own form). It does not pass
the user's environment. Its settings form has a `cwd` box for the same reason.
Claude Desktop, by contrast, inherits its own environment and passes it along,
so for the first client an entry naming one variable was sufficient — and the
requirement stayed invisible until a client that does not inherit met it.

Reproduced on Linux before anything was changed, by launching the shim with
nothing but `ELECTRON_RUN_AS_NODE=1`: the app it spawns cannot start, the shim
reaches its 20-second deadline, exits 1, and writes **nothing at all to
stdout**. From the client's side that is indistinguishable from a server that
started and had no tools to offer — which is exactly what the dogfooder saw.
The minimum this machine needs proved to be `HOME` and `DISPLAY`; `PATH` was
not required.

**Decision: `shimEntry` captures the session variables the launch needs, at
write time, and declares them in the entry.** The invariant is stated as a
sentence because it is testable as one: *the entry must launch from an empty
environment.* `sessionEnvKeys(platform)` is the per-platform list, and a
variable earns its place for one of two reasons — the app cannot start without
it (`HOME`, `DISPLAY`; `SystemRoot` and the profile paths on Windows), or the
shim and the app must agree on the pipe (`XDG_RUNTIME_DIR` and `TMPDIR` locate
the socket, `APPDATA` locates the userData directory that names it). The second
is the subtler failure: a shim lacking what a desktop-launched app has computes
a different rendezvous, spawns a second instance, loses the single-instance
race, and then waits out its deadline against a socket nobody will ever open.

Consequences worth stating:

- **Values, not names.** `env` is the one mechanism both clients speak.
  Codex's `env_vars` would age better — a captured value goes stale if the
  user's profile moves — but Claude Desktop has no equivalent and the recorded
  `codex mcp add` grammar has `--env` and no flag for it. A revisit trigger
  below covers the day it grows one. The *by-hand* fallback does use the
  passthrough box, because nobody should retype eleven paths into a form.
- **`sameEntry` becomes asymmetric.** It asks whether the entry a client holds
  carries everything *we* would write: keys must be present, values must agree,
  and extra variables somebody added by hand are left alone. `PATH` is required
  to be present but not to match — it grows whenever anything is installed, and
  an `outdated` badge that appears for that reason teaches a user to ignore the
  one state that means something. The presence check is also the upgrade path:
  every entry written before today reads as `outdated`, and one Reconnect
  writes the entry that works.
- **The shim now says what it was given.** Its timeout message lists the
  variable *names* in its environment and points at the panel. The old message
  ended at "is the installation broken?", which sent an hour of screenshots
  after the wrong question.
- **Pinned by `e2e/mcp-shim.spec.ts`**, which launches the shim with what the
  entry declares and nothing we add, and fails at the deadline when the entry
  is reverted to one variable. The MCP SDK's stdio transport folds a small
  inherited set in beneath what it is given, so that test is slightly more
  generous than Codex — weaker than the real client, never stronger.

What this does NOT establish is that the Windows list is right. `SystemRoot`,
the profile paths and `TEMP` are there on reasoning, not measurement, because
the only machine that can measure them is a dogfooder's. The shim's new
message is what makes the next attempt one glance instead of an hour.

**Follow-on the same day, found by CI: `DISPLAY` alone is not the display.**
The spec above went green on this dev box and on `windows-latest`, and red on
Linux CI — the app the shim spawned never listened, and the 20-second deadline
was all the runner could say. The missing variable was `XAUTHORITY`: an X
server that requires MIT-MAGIC-COOKIE authentication — which most session
managers set up, and which `xvfb-run` does unconditionally — refuses a client
whose environment names no cookie file. Reproduced by pointing a declared-env
launch at an unreachable `DISPLAY` locally: no window, no socket, same silent
timeout.

Two things this says beyond the one-line fix. First, **the list is a claim
about a machine, and the machines we develop on are the ones least able to
check it** — WSLg and this box leave `XAUTHORITY` unset, so Xlib's fallback to
`~/.Xauthority` hides the gap; only an environment that puts the cookie
somewhere else can fail. That is the same shape as the Windows caveat in the
paragraph above, arriving from the other direction, and it is why the key is
pinned by a unit assertion on the *list* rather than by an e2e that cannot
notice its absence. Second, **it is not a CI-only fix**: a Linux dogfooder
whose session sets `XAUTHORITY` — the common case on X11 — would have hit
exactly this, with a ChatGPT that lists the server and offers no tools.

## Decision

**1. One surface, many clients, one seam.** The main process owns a registry
of *connect clients*. Each is an object behind one interface:

```ts
interface ConnectClient {
  readonly id: 'claude-desktop' | 'codex'          // the wire identity
  readonly displayName: string                     // "Claude Desktop", "ChatGPT (Codex)"
  detect(): Detection                              // installed here? where?
  status(): ClientStatus                           // connected | outdated | not-connected | error
  connect(): ClientStatus                          // write, then read back
}
```

The shared contract (`shared/connect.ts`, replacing `shared/claudeConnect.ts`)
becomes client-keyed: `status(): ClientStatus[]` (one per *detected* client;
undetected clients are reported so the panel can say so, never silently
dropped) and `connect(id)`. The argument is a client **id chosen from the set
main registered**, validated there — it nominates no path, no command and no
content, so ADR-0029's security property (page content cannot make the app
write a file or make a client run a program) is preserved with one extra line,
not lost. The panel renders one row per client with the same five states and
the same restart line; the copy is per client, the machinery is not.

**2. Each client's config goes through the mechanism its owner supports, and
the order of preference is fixed:**

1. **the client's own tooling**, when it exists and can be found — Codex:
   `codex mcp add/get/remove`;
2. **the client's file, read-merge-write**, when no tooling exists — Claude
   Desktop, exactly as ADR-0029 phase 6 built it (candidate list, has-a-config
   wins, refuse-when-unparseable, temp-and-rename);
3. **show the entry as copyable text** — the client-agnostic fallback, offered
   whenever a write fails or a client is not detected: the JSON block for
   Claude Desktop, the `codex mcp add …` command line for Codex. It touches
   nobody's files and works on the machine we did not anticipate.

The rule exists because the MSIX finding was a *file* finding: every
assumption about where a client keeps its config, how it formats it and what
else lives in it is the client's to change, and delegating to the client's own
tool moves that entire class of failure to the party that can actually keep it
correct. We write a file only where nobody offers anything better.

**3. No TOML parser.** Codex owns its TOML; Carton Fit never reads or writes
`config.toml`. Status comes from `codex mcp get carton-fit --json` (exit 1 →
`not-connected`; otherwise `transport.command/args/env` compared to this
build's entry → `connected` or `outdated`, the same comparison the Claude path
makes). Detection is finding the CLI, not finding the file — the file can be
absent on a fresh install and the CLI creates it.

**4. Codex discovery.** Windows: `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe`
— the `bin` holds one directory per shipped version (two on the requesting
machine), so the newest by modification time wins. Elsewhere: `codex` on
`PATH` (the npm-installed CLI, the macOS app's bundled binary). The desktop
app's own config carries a `CODEX_CLI_PATH` breadcrumb inside another server's
`env` block; it is *not* used — an internal detail of a bundled plugin is not a
contract, and reading it would mean parsing the TOML the whole design avoids.
The Codex config home is `CODEX_HOME` else `~/.codex`, passed through to the
CLI as its environment so a non-default home behaves; it is otherwise never
opened.

**5. The entry is one entry.** Both clients receive the same launch —
`process.execPath`, `<appPath>/out/main/mcp.js`, `--mcp`, the profile flag on a
non-default profile, `ELECTRON_RUN_AS_NODE=1` — from the same `shimEntry`. A
client adapter serialises it; none composes it. `ELECTRON_RUN_AS_NODE` travels
as `--env` to Codex and as `env` to Claude Desktop for the same reason in both:
ADR-0029's Windows finding, a GUI-subsystem Electron process never receives
its stdin.

**6. Both clients read their config at startup.** The restart line stays, per
client, and it stays the feature rather than the footnote — for Codex the
desktop app must be restarted, and a `codex mcp list` that already shows the
entry is exactly the confusing case the sentence prevents.

**7. Testing.** The Claude path keeps its e2e. The Codex path is pinned two
ways, and the split is stated because it is a real limitation:

- a **fake `codex` CLI** in `e2e/` — a script implementing the `mcp
  add/get/list/remove` contract *as observed and recorded above*, including
  exit 1 on an unknown name and in-place replacement on re-add — placed where
  discovery finds it (a `CODEX_CLI` env seam, the same shape as
  `CLAUDE_DESKTOP_CONFIG_DIR` and `UPDATE_CHECK_URL`). This runs on Linux CI
  and pins *our* half: argument construction, `--json` parsing, the five
  states, the copyable fallback;
- **the real CLI is verified by dogfooding**, and by a spec that runs only
  where a real `codex` is found — which today is no CI runner. The fake pins a
  contract observed on one version (`0.152.1`); a CLI that changes its `--json`
  shape fails on the dogfood machine first, and that is written down here so
  nobody mistakes the fake's green for coverage of OpenAI's tool.

## Open details

- **Codex's startup timeout vs. cold boot.** Codex initialises a stdio server
  with a **10-second default** (`startup_timeout_sec`). The shim answers the
  MCP handshake only once the app's pipe answers, and when no app is running
  the shim spawns one — an Electron cold boot, with a 20-second connect
  deadline of its own (ADR-0029 phase 5). On a slow disk 10 seconds is
  plausible and tight. `codex mcp add` has no flag for the timeout and `-c`
  overrides are not persisted, so raising it would mean writing the one TOML
  key this design refuses to write. **Resolution path: measure first** — the
  shim spec already performs a cold spawn-and-connect; record its elapsed time
  on both CI platforms. If p95 sits comfortably under 10 s the detail closes.
  If not, the options in order are: a newer CLI that grows the flag (check on
  each Codex update), or a single documented exception to rule 3 for that one
  key, taken with a parser and an ADR-0011 notices row — never a hand-rolled
  splice.
  **Closed 2026-09-04 by the measurement, with room to spare.** The
  `shim-cold-boot-timing` stopwatch has printed `[mcp:server] cold connect:
  N ms` from every packaged e2e run since phase 1, and it times the cold path
  itself: no app running, so the shim spawns Electron and answers the handshake
  only once that app's pipe does. On `windows-latest` — the platform that
  decides this, since every Codex dogfooder is on Windows (ADR-0019) — five
  release runs measured **477, 498, 555, 573 and 636 ms**. Linux CI measures
  **737–757 ms**. The worst of those is 6% of Codex's 10-second budget. A
  user's disk is slower than a hosted runner's, but not sixteen times slower,
  so the detail closes WITHOUT the documented exception to rule 3: no TOML key
  is written, no parser arrives, ADR-0011 gains no row.
  The stopwatch stays, and stays unasserted on purpose — a threshold would fail
  on a loaded runner and say nothing about a user's machine — so the number
  that would reopen this is one `grep` away in any CI or release log. Reopen if
  a dogfooder sees Codex report no tools *slowly* where `codex mcp get` shows
  the entry present: that is this timeout, and it looks exactly like addendum
  3's environment bug from the outside.
- ~~**`codex mcp add` side effects in the real home.**~~ **Closed 2026-09-04,
  and the answer is one file.** A listing of the real `~/.codex` after
  connecting shows exactly one entry stamped from the connect: `config.toml`,
  5 KB, the desktop app's whole configuration with our four-line server entry
  inside it. The PATH aliases and helper binaries the CLI announced it was
  *declining* to create under `Temp` are not there — the candidates
  (`.sandbox-bin`, `vendor_imports`, `plugins`, `skills`) all predate the
  connect by a day or more, so the CLI creates those on install, not on add.
  Our footprint is one file edit, which is what the design assumed. It also
  vindicates rule 3 concretely: 5 KB of someone else's configuration, and we
  never open it. Method noted for honesty — inferred from timestamps, not
  watched; a Reconnect plus a re-listing would upgrade it to an observation.
- ~~**Which `codex.exe` is the desktop app's.**~~ **Closed 2026-09-04: no
  disagreement, and the reason it is unlikely.** Two hashed directories under
  `%LOCALAPPDATA%\OpenAI\Codex\bin`, and the entry written through the
  newest is visible in the desktop app's own settings screen — so the binary we
  pick and the app the user runs agree about where `config.toml` lives, which
  is the only thing this heuristic has to get right. Structurally they must:
  both resolve the same `CODEX_HOME`, so the pick decides which program writes,
  not which file is written.
  **What the observation corrects is the ADR's own guess about the margin.**
  This ADR said "installed minutes apart by the same update"; they are **four
  seconds** apart. So newest-by-mtime is not ranking versions, it is ranking
  two artifacts of a single install — and a directory's mtime moves for reasons
  unrelated to being newer (a repair, an antivirus quarantine-and-restore, a
  partial update). Today either choice behaves identically, which is why this
  closes rather than escalating; the margin is recorded because a tiebreak of
  seconds is not the tiebreak the design imagined it was.
- **macOS and Linux Codex are untested.** Discovery via `PATH` is designed,
  not proven; the requesting machine is Windows, and so is every dogfooder so
  far (ADR-0019).
- ~~**Whether the Store Claude Desktop launches the shim at all.**~~
  **Answered 2026-09-02, before this ADR was written down: it does.** The
  dogfood pass at `c81dd82` got a successful handshake and all fifteen tools
  listed from the MSIX client — ADR-0029's phase-6 addendum part 3 has the
  detail, along with the *second* thing that pass found, which was that every
  call was then rejected over a schema dialect. Recorded here as closed rather
  than deleted because this entry stayed open in this ADR for two days after
  the answer existed, purely because the answer arrived in a different ADR's
  dogfood pass. **When one ADR's open question is answered by another's
  session, the closing is a two-file edit** — the pass that finds it is not
  reading this list.

## Consequences

- **ADR-0029's phase-6 surface becomes one client of two**, behind a seam.
  `shared/claudeConnect.ts` → `shared/connect.ts`; `ClaudeConnectPanel` → a
  panel of client rows; the Claude adapter is the existing code moved, not
  rewritten. Test ids gain a client prefix.
- **No new runtime dependency.** The TOML question is dissolved rather than
  answered; ADR-0011 is untouched.
- **A third client has a recipe**, and the recipe is the order in Decision 2:
  find its tooling; if none, find its file and merge; always offer the text.
  The recipe is the deliverable as much as the second client is.
- **Codex support is Windows-verified only by dogfooding.** Stated in §7 and
  again here because a green CI can be read as more than it is.
- The panel grows a row it cannot fully populate on Linux CI (no Codex) — the
  `not detected` state is rendered and asserted there, which is the honest
  test of what a Linux user without Codex sees.
- `dist-live/` builds between this ADR and its implementation still carry the
  Claude-only panel; nothing regresses.

## Alternatives considered

- **An MCP Bundle (`.mcpb`) for Claude Desktop, installed from inside Claude.**
  The best mechanism for an ordinary server — Claude owns the config location
  (no MSIX exposure), bundles Node, manages enable/disable and secrets. Not
  adopted as *the* mechanism because Carton Fit's server is not ordinary: the
  bundle would ship a shim that has to locate the installed app (registry
  lookup or a guessed path, rotting on every update), where the button writes
  a path the app knows exactly and can repair. Also Claude-only. **Kept as a
  possible complement** — a bundle that delegates to the same discovery the
  Codex adapter uses — if a user population wants the Extensions UI. Not v1.
- **A TOML library (`smol-toml` or similar) and a Codex file adapter shaped
  like the Claude one.** Rejected: the CLI exists, so this is a runtime
  dependency (ADR-0011 notices row, licence text inline, bundle manifest) plus
  a comment-and-formatting fidelity problem — TOML round-trip libraries that
  preserve comments are rarer than JSON's `stringify` makes it look — all to
  do worse what the owner's tool does for free. Reconsidered only under the
  startup-timeout detail above, and then for one key.
- **A hand-rolled `[mcp_servers.carton-fit]` splice — find the table, replace
  it, or append.** Rejected outright. TOML forbids duplicate tables, so an
  append that misses an existing entry produces an *invalid* file, and finding
  the existing entry correctly is a parser. Partial parsers are how configs
  get corrupted, and this one is the user's.
- **Serving HTTP so ChatGPT web could connect.** Not needed — the installed
  client is Codex, which speaks stdio — and not free: a listening HTTP server
  in a desktop app is a security surface ADR-0029 chose not to open. Remains
  ADR-0029's revisit trigger ("if MCP client support stalls, promote the
  HTTP/CLI shape"), unchanged by this ADR.
- **One generic "write the client's config file" abstraction with a format
  plug-in per client.** Rejected as the *primary* shape: it enshrines the file
  as the mechanism, and the file is exactly where the MSIX assumption lived.
  The seam here is the *client*, and the file is one of three things a client
  might offer.
- **Detecting Codex by its config file rather than its CLI.** Rejected: a
  fresh Codex install may have no `config.toml` yet (the CLI creates it), and
  the file's location is the thing we least want to depend on.

## Revisit triggers

- The two `Codex\bin` directories ever hold DIFFERENT versions, rather than two
  artifacts of one install four seconds apart: newest-by-mtime then starts
  deciding something, and the four-second margin observed on 2026-09-04 says it
  was never designed to.
- Codex's `codex mcp add` gains a startup-timeout flag, or changes its
  `--json` shape: update the fake CLI and the adapter together, and re-run the
  dogfood pass.
- A user asks for Carton Fit in a client that offers neither tooling nor a
  writable file (a sandboxed or remote-only client): that is the HTTP trigger
  in ADR-0029, not a third adapter here.
- Claude Desktop gains a CLI for its `mcpServers` — then rule 2 says the file
  adapter is retired in its favour, and the MSIX candidate list becomes
  Claude's problem again, where it belongs.
- Anthropic's `.mcpb` gains a way to reference an already-installed host
  application rather than shipping the server: the discovery objection to the
  bundle route disappears, and it becomes the better Claude mechanism.
- `codex mcp add` grows a flag for `env_vars` (forward-by-name) or `cwd`:
  prefer forwarding to capturing for the session variables — a name cannot go
  stale — and set the working directory explicitly rather than inheriting
  whatever the client defaults to (addendum 3).
- A client appears that passes neither the environment nor the entry's `env`:
  the entry cannot fix that, and the answer is the client's own tooling or the
  by-hand fallback, not a third mechanism here.
