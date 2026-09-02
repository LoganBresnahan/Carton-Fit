# ADR-0029: Expose the packing engine to AI clients — Carton Fit as the tool, not the chatbot

Date: 2026-09-01
Status: Accepted (2026-09-01 — proposed and accepted the same day; every open
detail was resolved in design discussion, each resolution recorded inline)

## Context

User requests (2026-09-01) about "connecting to Claude AI" arrived with a shared
claude.ai transcript: a packaging engineer took Carton Fit's core question — how many
of this STEP part fit in this box — to a Claude conversation instead of the app. The
transcript splits cleanly along a line this product was built on:

- **What Claude was good at**: context and judgment. Material densities from alloy
  names, container-rating sanity checks against supplier listings, damage and
  handling risk, trailer math, and knowing when to say "run a physical trial."
- **What Claude was bad at**: the arithmetic Carton Fit exists for. Its bulk estimate
  changed three times under "double verify / triple verify" prodding (ADR-0028
  records that half), and even its *ordered* pack count moved between passes — the
  180°-interlock pattern that raised a layer from 80 to 120 parts appeared only on
  the third look.

Two integration shapes were considered. **Claude inside Carton Fit** (an assistant
panel calling the API) imports the unreliable half into an app whose whole identity
is numbers it can stand behind — plus an API key, a network dependency in an
otherwise-offline app (sole current contact: ADR-0021's update check), per-use cost,
and a runtime dependency under ADR-0011. **Carton Fit exposed to Claude** points the
same integration the other way: the engineer keeps the conversation, and every count,
weight, orientation, and bound in it comes from the deterministic engine. The user
chose the second shape (2026-09-01).

The codebase is already built for it: packing and geometry are pure TypeScript with
no DOM and no three.js imports (a rule maintained since ADR-0003 for workers and
tests), and the result schema already carries the machine-readable honesty an AI
client needs — binding constraint, the rigorous upper bound (ADR-0022), and warnings
that qualify the whole answer (ADR-0015).

## Decision

Expose the packing core as a machine-callable surface for AI clients, with an **MCP
server** as the leading candidate shape (stdio transport; the standard Claude clients
— claude.ai, Claude Code, Claude Desktop — all speak it).

Principles fixed now, whatever the final shape:

- **The app is the server; the core does the math.** (Amended 2026-09-01 — this
  bullet first read "the surface is the pure core, not the app," and the design
  discussion below outgrew it.) The MCP server lives in the installed app's main
  process. Phase-1 tools are stateless consumers of `core/` plus Node-side occt
  (no window involved); the drive tiers read and write the one Zustand store
  through the same actions the UI uses (ADR-0006), which is what makes the app
  driveable at all — auto-run (ADR-0009) means "set inputs" *is* "run an
  estimate," and everything Claude does lands in the same undo stack as a human's
  edits (ADR-0016), so Ctrl+Z can step back the AI's changes.
- **ADR-0015/0017 extend past this boundary too.** Every response carries its
  qualifications — binding constraint, upper bound vs. placed count, open-mesh and
  truncation warnings — structured, not prose. An AI client that drops them is out of
  our hands; one that never received them is our bug.
- **Bulk questions get the ADR-0028 answer**: ceiling, hull figures, fill-trial
  guidance — never a computed count.
- **The lean-dependency rule applies** (ADR-0011): an MCP SDK dependency needs its
  notice line, and where the server ships decides which notices ship with it.

## Tool surface — three tiers (resolved 2026-09-01)

The inventory came from walking the motivating transcript and asking what the
engineer needed at each moment. Every tool is a thin adapter over a seam that
already exists; none contains new packing or geometry logic.

**Inspect (read-only):**

| Tool | Returns | Seam |
|---|---|---|
| `get_app_state` | loaded file, current inputs, mode/tier, units, app version | store snapshot |
| `inspect_model` | per-kind geometry: bbox, volume, closed-mesh flag, counts | import pipeline |
| `get_estimate` | verdict/count, binding constraint, upper bound, utilization, gap analysis, warnings | result slice |
| `capture_view` | a PNG of the packed or model view, returned as an MCP image — the AI client can *see* the arrangement | ADR-0017 capture seam |
| `list_presets`, `list_saved_estimates` | stored cartons and kept estimates | existing IPC |
| `export_summary`, `export_csv` | the ADR-0017 artifacts as content, no file dialog | export builders |

**Drive (mutating — all through the store actions the UI uses, never a side door):**

| Tool | Does |
|---|---|
| `load_model` | as if the file were dropped on the app |
| `set_inputs` | carton dims, clearances, weight cap, units, mode, tier — partial updates; auto-run recomputes |
| `set_part_weight` | ADR-0018 per-kind overrides |
| `apply_preset`, `restore_estimate` | settings-only load, result recomputed (ADR-0016 semantics inherited) |
| `save_estimate` | explicit save — history still records only what someone chose to keep |

**Phases** (one server, tools arriving in tiers, monotone):

1. **v1 — inspect the engine**: `inspect_model` + `estimate` (a stateless
   mode/quality/constraints call mirroring the app's contract). Window never
   shows. Provable against `samples/` goldens exactly like the unit layer.
2. **v2 — drive the live app**: `load_model`, `set_inputs`, `get_estimate`,
   `capture_view`, `get_app_state`. The window appears beside the Claude Desktop
   chat and the engineer watches the drive — the app's UI is the trust surface
   for the conversation.
3. **v3 — the user's data**: presets, saved estimates, exports.

**Deliberately not tools**: compare/summarize/recommend (that is the AI client's
half of the work); any bulk-dump count (ADR-0028 — but `estimate`'s description
carries the ceiling-plus-fill-trial language, because tool descriptions are the
mechanism that stops a client improvising a packing fraction); stack-pitch and
nesting checks (tier-3 territory — a tool that shrugs is worse than absence, and
demand for it is exactly the ADR-0023 evidence this surface exists to collect).

**Operational details that fall out of the app-as-server shape:**

- Claude Desktop launches stdio servers at its own startup and keeps them
  alive, so the process must start with the window hidden and show it on the
  first drive-tier call — otherwise Carton Fit opens whenever Claude Desktop
  does.
- In server mode stdout is protocol-only; all logging goes to stderr. A stray
  `console.log` in main corrupts the MCP stream.
- **Whose Carton Fit is connected — launch order must not matter** (raised
  2026-09-01). Claude Desktop only knows how to spawn its own configured
  process; it will never attach to an app the user already opened. The naive
  design therefore forks reality: the user opens Carton Fit, then Claude, and
  Claude drives a second, hidden instance while the user stares at the first,
  wondering why nothing moves. The fix is a **shim plus a single-instance
  socket**: the config entry launches a thin `--mcp` shim; every running app
  instance listens on a local named pipe (scoped to the userData path); the
  shim proxies stdio to the running instance when one exists, and only when
  none does takes Electron's single-instance lock, boots the app hidden, and
  serves directly. The reverse order composes for free: a manual launch while
  the hidden server instance exists hits the same single-instance lock, which
  routes to the hidden instance and shows *its* window — the app that appears
  IS the connected one. Either order converges on one instance, connected,
  visible exactly when wanted. (App quitting while Claude Desktop still holds
  the shim: the next tool call reports the disconnect or relaunches — a build-
  plan detail, not a design one.)

**Scope discipline**: every tool is contract surface under ADR-0020's version
promise. The inventory above is the ceiling for this ADR, not a floor — tools
ship when their phase does, and additions beyond it need their own decision.

## Open details (all resolved before the flip to Accepted; resolutions inline)

- **Distribution shape**: bundled inside the installed app (the app spawns/hosts the
  server) vs. a separate npm package/CLI vs. both. Decides the ADR-0011 blast radius
  and whether a non-app-user can install just the engine.
  **Resolved 2026-09-01: bundled in the app.** The audience is non-technical
  internal users on **Claude Desktop** (confirmed), which speaks to local stdio
  servers — so the server rides in the existing installer, launched from the
  packaged app via `ELECTRON_RUN_AS_NODE` (the dev footgun CLAUDE.md warns about
  is precisely the mechanism for running a headless script under the shipped
  binary — no second runtime). LGPL story: zero new work — the server is another
  consumer of the same `asarUnpack`ed wasm under the same notices, verified by the
  same compliance suite. Setup should be a button, not JSON: the app writes the
  `mcpServers` entry into Claude Desktop's config itself ("Connect to Claude").
  A standalone npm package stays possible later but is not v1; a standalone
  packaged binary is rejected outright (embedding the wasm would break the
  ADR-0011 relink right and duplicate the installer).
- **STEP ingestion outside the renderer**: occt-import-js currently runs in a web
  worker; verify it under plain Node, and decide whether files arrive as paths or
  bytes (MCP clients differ in what they can hand over).
  **Resolved 2026-09-01**: occt runs under plain Node — the spike (no Vite, no
  `locateFile` override) parsed the AS1 golden: 18 meshes, 5,040 triangles,
  correct part names. Files arrive as **paths**: the server is local and the
  STEP files live on the engineer's disk; base64-ing megabytes through a JSON
  tool call serves nobody. A bytes variant can be added later if
  attachment-based workflows demand it. Units are explicit in both directions
  on every tool — required in the schema, echoed in results — because an
  implicit-unit call is the likeliest wrong-answer path in the design
  (ADR-0004's boundary, now a wire contract).
- **Tool inventory and grain** — **resolved 2026-09-01**: the three-tier surface
  above.
- **Parity with the app** — **resolved 2026-09-01** by the same design: overrides
  and units in v1/v2 parameters, presets and saved estimates deferred to v3.
- **Testing tier** — **resolved 2026-09-01**: the server is the goldens' third
  consumer (ADR-0005) — v1 tools proven against `samples/` hand-computed
  results the way the unit layer is, and the compliance suite already covers
  the wasm the server shares with the app.
- **Contract and versioning** — **resolved 2026-09-01, closing the list**: one
  version number. The tool list and result schemas join the app's public
  surface under ADR-0020 — adding a tool or field is a minor bump, breaking a
  tool's schema is a major one, and a staged build's server identifies itself
  with the `+sha` form per ADR-0027, surfaced through the MCP server-info
  handshake and `get_app_state`, so a conversation can always say which build
  produced a number. No separate server version, no new machinery.

## Consequences

- On acceptance: VISION gains the AI-client surface (inputs/outputs and a non-goal —
  no chat UI in the app), the roadmap gets a build item, and `adr-plan` decomposes
  it.
- The pure-core rule stops being an internal convention and becomes a product
  contract — a three.js import into `core/` would now break a shipped surface, not
  just a test.
- An engine reachable from conversations becomes an evidence channel: the gap
  between the engine's tier-2 answer and what engineers report from the floor is
  exactly the dogfood signal ADR-0023's tier-3 gate is waiting on.

### Phase-1 addendum (2026-09-01) — the wasm the main process reads

Building the Node-side STEP path turned up a compliance consequence the design
did not anticipate, recorded here because it constrains every later slice.

The main process needs OpenCascade, and the obvious way to give it some is to
`require('occt-import-js')` — its own module, its own wasm, resolved out of
node_modules. That build does not survive packaging (the exclusions in
`electron-builder.yml` delete that copy, and those exclusions are ADR-0011
compliance), and more importantly it *should* not: the app would then contain two
OCCT libraries, while ADR-0011 tells a recipient that replacing one file replaces
the library. They could substitute their build, watch the viewport honour it, and
never learn the MCP surface was still answering from the original.

So: the main build alone un-externalizes `occt-import-js` and bundles its glue
into `out/main` — mirroring what vite already does for the renderer worker — and
`src/main/occt/wasmPath.ts` resolves the single `asarUnpack`'ed `.wasm` that the
renderer loads. When packaged it resolves that file *or fails*; the node_modules
fallback is reachable only in a source tree, because a fallback in an installed
app is precisely how the guarantee would go quietly false. Proven end to end on
the packaged Linux build: the AS1 golden yields its 18 solids through the main
process, and corrupting that one file breaks that path too.

**The rule this sets for later slices**: anything the MCP surface needs from the
renderer's bundled libraries has the same shape of problem. Known next instance —
STL, which the renderer parses with three's `STLLoader` while packaging prunes
`node_modules/three`; `readModel` turns STL away with a reason rather than
pretending, and phase 2 decides whether `inspect_model` accepts it.

### Phase-2 addendum (2026-09-01) — three decisions the v1 surface forced

**1. STL is readable from the main process, at the cost of ~330 KB.** The
phase-1 carry-in said `inspect_model` would have to decide what it accepts; the
goldens decided it. Five of the six `GOLDEN_PACKS` scenarios are STL, so a
STEP-only surface could not be proven against the fixtures ADR-0005 makes the
shared oracle — and an AI surface that reads half the formats the app reads is
a seam a user would find in their first session. Main now reaches three's
`STLLoader` through the same one-line adapter the import worker uses, which
un-externalizes `three` for the main build and bundles ~330 KB of it into
out/main (measured). The alternative — a second STL reader written for the main
process — is the duplicate implementation this ADR forbids: it would eventually
disagree with the renderer's, and the disagreement would surface as an AI client
quoting a volume the app's own screen contradicts. No packaging change; no
notices change (three is already cited, its `LICENSE` already ships, and its
code was already bundled rather than loaded from node_modules).

**2. The packing inputs moved out of the store.** `PackingSettings`,
`DEFAULT_SETTINGS`, `settingsFromStored` and `innerCartonMm` now live in
`src/renderer/src/packing/settings.ts`; `store.ts` re-exports them, so no
existing importer changed. The forcing reason is that `estimate` builds the same
settings object the inputs panel builds and hands it to the same
`buildPackRequest`, but `store.ts` cannot be imported from the main process at
all — it pulls zustand and reads `localStorage`. Keeping one definition of what
a carton input *is* was worth the move: an AI client setting a carton and a user
typing one must be able to disagree about nothing.

**3. Absence is never how a qualification is expressed.** Core reports several
figures as optional on purpose — `upperBound` is absent when no finite bound
exists, free space when it cannot be described honestly (absence over
misinformation). Passed straight to the wire that becomes indistinguishable from
a build that forgot to send them, and this ADR says the second one is our bug.
So every such value crosses as `{known: false, reason}` or `{known: true, …}`,
and every qualification is REQUIRED in the published output schema — the SDK
validates structured results against it, so a dropped hedge is a failed call
rather than a confident answer. Both properties are mutation-tested: making a
qualification optional, or skipping the open-mesh check, turns
`tests/mcp-qualifications.test.ts` red.

### Phase-3 addendum, part 1 (2026-09-01) — the host, and what pruning the SDK took

The server now has somewhere to live — two somewheres, one seam.
`src/main/mcp/host.ts` chooses the transport (`serveStdio`); the tools never
learn which. The headless entry (`out/main/mcp.js`, executed via
`ELECTRON_RUN_AS_NODE` from the shipped binary) serves the stateless v1 tools
with Electron APIs absent, and is the file the phase-5 `--mcp` shim grows out
of. The app launched with `--mcp-server` hosts the same server from the main
process beside a live window — the arrangement the v2 drive tier requires.
Electron's asar-aware fs patches hold in run-as-node mode, so the entry runs
from *inside* `app.asar`; the e2e proves that against the packaged bytes,
because it is exactly the dev-green/packaged-broken class ADR-0005 names.

One rule the build forced: **neither mode asks Electron for its identity.**
`app.getVersion()` under an e2e launch of `out/main/index.js` reports `"0.0"`
(the ADR-0021 trap, third appearance), and `app.getAppPath()` in that launch
points at `out/main` — so both modes derive app root and version from the
entry file's own location, one derivation, and cannot disagree by construction.

The phase-1 pruning carry-in is discharged, and the shape it took matters for
future dependencies: the SDK moved to `devDependencies` and rollup bundles the
stdio subset into `out/main` — the SDK plus six small schema/validation
packages — so electron-builder ships none of its 61-package tree (app.asar
17 → 9.5 MB). Bundled code carries no `LICENSE` file beside it, so those seven
licence texts now ride verbatim in THIRD-PARTY-NOTICES.md, which itself ships
in the app root. The part that keeps this true rather than merely true today:
the build emits `out/main/bundled-modules.json` naming every node_modules
package bundled into main, and a spec fails if that list ever names a package
the notices file does not cover — an SDK upgrade that starts reaching one more
package becomes a red spec naming it, not a silent licence violation.

### Phase-3 addendum, part 2 (2026-09-01) — the drive tier, and the settle protocol

The v2 tools exist: `load_model`, `set_inputs`, `set_part_weight`,
`get_estimate`, `get_app_state`, `capture_view` — registered only when the
server hosts inside the app, because the drive tier without an app would be
tools that shrug, and §"Deliberately not tools" already priced that. Everything
goes through the store's own actions over a new main→renderer bridge
(`shared/mcpDrive.ts`, one channel each way, calls serialized), so an AI edit
re-packs through the same auto-run subscription and lands on the same undo
stack as a human's — one call, one Ctrl+Z step.

**The settle protocol is event-ordered, not timed.** Auto-run means "set
inputs" is "run an estimate", but the run is debounced and worker-computed, so
between a drive write and its pack finishing, the store still says `done` for
the PREVIOUS inputs — and a pack already in flight when the write lands
completes and says `done` again, still for the old inputs. The fix
(`renderer/mcp/settle.ts`): a dirty flag any input write raises and only a pack
*beginning* lowers — a dispatch cannot predate the write it consumed (autoPack
builds its request when the timer fires, from the newest inputs), while a
completion can. Settled = clean + terminal status. Mutating tools hold their
reply until then and carry the fresh estimate in it, so the racy set-then-get
pattern is unnecessary by design. Pinned at the unit layer (a stale `done`
landing while dirty must not settle) and end to end (the `set_inputs` reply
must say 343 immediately after saying 27,000), and mutation-tested: disabling
the dirty check flipped exactly the two count assertions.

**The verify pass caught a v1 qualification lying.** An estimate driven by
ADR-0018 overrides alone — no file-wide weight, no density — reaches the
engine weighted and can be weight-BOUND, yet `weightInput` said "no part
weight was given, so the cap could not bind." Overrides now count as a
supplied weight in the shared report assembly. That assembly
(`buildEstimateReport`) was extracted from `estimateParts` so the live app's
result and the stateless call produce identical wording from identical facts —
the drive tier's answer can never disagree with the v1 tool's for the same
question.

## Alternatives considered

- **Claude assistant inside the app** — rejected for now, reasons in Context. The
  judgment layer lives better in the chat client, next to the user's other context.
- **Plain HTTP API** — not rejected, demoted: an HTTP server is a possible transport
  under the same core seam, but MCP is what the requesting users' tooling actually
  speaks. Folded into the distribution-shape open detail.
- **Do nothing** — rejected: engineers are already running this workflow, with
  numbers that moved three times in one conversation.

## Revisit triggers

- If the requesters' clarified ask turns out to be in-app assistance after all, this
  ADR is superseded rather than stretched.
- If MCP client support in the users' environment stalls, promote the HTTP/CLI shape
  from the open details.
