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

### Phase-4 addendum (2026-09-01) — the lifecycle, the data tier, and one honest version

Four slices, all layering on phase 3's host and bridge. Each settled a question
the earlier phases could name but not yet answer.

**stdout is TAKEN, not asked for.** In server mode this process's stdout is the
MCP wire, and one stray byte on it corrupts a JSON-RPC frame — the handshake if
it happens early, one answer inside a working session if it happens late.
Redirecting `console.log` would cover today's ways of printing and none of
tomorrow's, so `mcp/stdout.ts` captures the real `process.stdout.write` and
hands it to the transport alone; everything else written to that stream is
diverted to stderr, where Claude Desktop shows it in the server's log. Nothing
is lost, only moved off the wire. Claimed at MODULE LOAD by both entries,
because the client's transport is reading our stdout from the moment it spawned
us — a boot message precedes the server's own construction. The one subtlety is
that the transport waits on the real stream's `drain` when a write returns
false, so the protocol writer is a proxy over the claimed stream rather than a
wrapping `Writable` with a buffer of its own: `capture_view`'s base64 PNG is
exactly the payload that makes an unbounded buffer matter.

**The window is hidden until it is driven, and closing it no longer ends the
process.** Claude Desktop starts its servers when *it* starts, so a window
appearing on launch is an app taking over the screen because a chat client
booted. `--mcp-server` therefore defers the show until the first drive call
(`ensureWindow`, which the bridge now routes every call through). Three
lifecycle interactions came with that, and all three are decided rather than
inherited:

- **The update check follows the window, not the app.** ADR-0021 §2 gated it on
  a visible window for latency; hidden launch makes that gate stronger — an app
  serving MCP with nothing on screen has nobody to read a banner, so it makes no
  network request at all until it has one. A headless-forever session is
  therefore also a session that never phones GitHub.
- **`window-all-closed` does not quit in server mode.** The process belongs to
  the MCP client as much as to the person, and quitting would kill a server
  Claude Desktop is still holding — the next tool call would fail as a transport
  error rather than an answer. `ensureWindow` builds a new window when one is
  next needed, which is exactly how macOS has always treated a closed window,
  now for the same reason everywhere. A rebuilt window starts empty and the
  reply says so (`state.file.loaded` is false) rather than leaving the client to
  wonder where its model went. The bridge's readiness therefore had to become a
  property of a PAGE rather than of the app: keyed on webContents id and cleared
  when that page starts loading again, which also discharges the reload race
  phase 3 documented as "times out and reports".
- **`backgroundThrottling: false`, in server mode only.** A window created with
  `show: false` is a hidden page to Chromium, which throttles its timers and
  stops its animation frames. This mode's whole shape is a window sitting hidden
  for as long as Claude Desktop is open — and auto-run is debounced on a timer
  while the viewport renders on rAF, so a throttled hidden page turns the first
  drive call into a minutes-long wait for milliseconds of work. The ordinary app
  keeps throttling: there, a hidden window is a minimized one nobody is waiting
  on.

**The v3 data tier is seven tools, and deliberately not eight.** Reads
(`list_presets`, `list_saved_estimates`) answer from main's own database
connection — a round trip through the renderer would add nothing but a way for
the tool's list and the panel's list to disagree. Writes and restores
(`save_preset`, `apply_preset`, `save_estimate`, `restore_estimate`,
`export_estimate`) go through the renderer's own functions over the bridge,
because "save" means *save what is on screen* and "apply" means *through the
store's own actions*, where ADR-0016's one-restore-one-undo-step and ADR-0018's
pruning of overrides to the loaded file's kinds already live. The eighth tool —
delete — is absent on purpose and pinned by a test that says so: everything else
here is recoverable, a wrong preset is re-applied and a wrong restore is one
Ctrl+Z, but a deleted preset is gone and the person whose data it is may not be
at the screen. The app's own buttons remain the way to delete. Two smaller
consequences: `export_estimate` returns the text rather than writing a file (the
save dialog is for a human choosing a location; a client gets the bytes, plus
the name the app would have offered), and `save_estimate` refuses loudly where
the button quietly does nothing — a disabled button's silence is right on screen
and wrong on a wire, where "no error" reads as "saved".

**One version, stamped on the wire and nowhere else.** ADR-0020 makes the
version a promise about behaviour, and between releases `package.json` still
carries the last release's number — so the handshake would let a dogfooding
build introduce itself as the release it is not. That is ADR-0027's confusion
arriving on a second surface: there it was an installer's filename, here it is
what Claude quotes back to someone asking which version answered. The same rule
and the same `+sha` form now apply to `serverInfo` and to `get_app_state`'s
version field. **Composed at build time and only for this wire**, because
`src/main/version.ts` REJECTS a build suffix by design: the update check
compares `app.getVersion()` against a release tag and its documented response to
anything unparseable is silence (ADR-0021 §3), so stamping the version at its
source would buy a truthful handshake by making the update check permanently
mute. An electron-vite `define` injects the suffix, `package.json` and
`app.getVersion()` are untouched, and the build writes the same id to
`out/main/build-id.json` so a test can read what was built rather than
re-deriving it from a repo that may have moved on.

**Verification.** 748 vitest, 97 packaged e2e. The three lifecycle specs are
mutation-tested — inverting the hidden/visible decision fails exactly the two
launch specs, and deleting the `window-all-closed` carve-out fails exactly the
quit spec (its first shape did NOT: polling the window count answered before
the process had finished exiting, so the assertion passed against the mutant,
and it had to become "wait for the quit that must not come"). The v3 tier is
proven twice: against fakes over the in-memory transport for the tier's own
choice of who answers what, and against the PACKAGED bytes for the half only a
real app has — a preset written by better-sqlite3, read back by main, applied,
and re-packed through the debounce and the worker to a golden count. The one
claim no spec reaches is the reveal itself: it fires from the drive bridge,
which needs an MCP client on stdin, and Playwright's Electron launch gives the
child no writable stdin. Every drive call routing through `ensureWindow` is
covered (the drive specs fail outright otherwise) and the hidden start is
covered; the show in between is a dogfooding check.

### Windows finding (2026-09-02) — the app-hosted server cannot own stdio there

The first CI run ever to exercise the MCP specs on Windows found that
`--mcp-server` does not work on the primary target. Four runs narrowed it
(33582003764 → 33584136244 → 33585707659 → the probe branch's 33644585849),
and the last one **corrected the diagnosis the first three suggested**: it is
not the writing side. A raw probe with markers showed the GUI process's stdout
carrying both a `process.stdout.write` frame and an `fs.writeSync(1)` frame to
the parent perfectly — but the `initialize` written to its stdin was never
delivered (the probe's stdin listener never fired), so the server never had
anything to answer. **A GUI-subsystem Electron main process on Windows can
speak but never hears: stdin does not deliver.** The stray `"\r\n"` the
earlier runs fixated on is boot noise — real, but a bystander. The headless
entry works because `ELECTRON_RUN_AS_NODE` is a plain Node process with
ordinary stdio.

This does not change the ADR's decision, but it does change which half of it
carries the weight. §"Launch-order independence" specified a `--mcp` shim plus
a single-instance pipe so a client could connect whether or not the app was
already running. That shim runs HEADLESS — where stdin works — and proxies to
the app over a pipe, meaning the GUI process never owns a protocol stream in
either direction. Designed for launch order, it turns out to be the only
arrangement in which the drive tier works on Windows at all. Phase 5 is
therefore not polish; it is the mechanism.

Three consequences worth stating plainly. The v1 tier was never affected — the
headless entry works on Windows. The property `stdout-protocol-discipline`
claims is guarded by a spec that reads the pipe raw and prints what it found
(`e2e/mcp-stdout-discipline.spec.ts`), because a timeout says only "no answer"
while three CI cycles were spent asking "answer to what?". And the app-hosted
STDIO specs are `test.skip`ped on win32 with this finding as the stated reason
— not because the behaviour is unproven there but because the transport they
exercise cannot exist there; the same behaviours run on Windows through the
shim, which is the transport users actually get.

### Phase-5 addendum (2026-09-02) — the shim, the pipe, and one instance per profile

The plan's highest-risk slice, and after the Windows finding its most
load-bearing one. Three pieces, each with the decision that shaped it:

**The pipe is per-profile, listening on every launch.** `mcp/pipePath.ts`
derives the endpoint from the userData path — a named pipe on Windows (kernel
cleans up), a socket under `XDG_RUNTIME_DIR`-else-tmpdir elsewhere (never
inside userData: profile paths have no length budget and socket paths cap near
104 bytes) — hashed, normalized, case-folded on win32, so the app (asking
Electron) and the shim (resolving an argument or restating Electron's default
rule) cannot derive two names for one profile. EVERY launch serves it, not
just server mode: the launch-order promise runs both directions, and a person
who opened the app first then asked Claude must reach the window they are
looking at. Stale socket files — the crash leftover that would hold
EADDRINUSE forever — are probed before they are unlinked: a REFUSED probe is a
corpse, an ACCEPTED one is a live instance whose socket must not be stolen.

**The shim is a dumb byte proxy, and its races are settled by not entering
them.** `--mcp` on the headless entry: try the pipe; nothing there means no
app, so spawn one (`--mcp-server --mcp-spawned`, detached, stdio ignored,
argv passed through — the harness's GL flags ride the same mechanism a power
user's config would) and retry until it listens. Two shims racing both spawn;
the two apps race the single-instance lock; the loser exits; both retry loops
land on whichever instance holds the pipe. Mutation-testing found this
redundancy is REAL: a mutant shim that always spawns still converges to the
person's running instance through the lock — connect-first is the polite fast
path, not the correctness mechanism. Framing, backpressure and EOF are
preserved by `pipe()` end to end: bytes are never inspected, a slow reader
pauses the writer, and a hangup travels as end() in both directions.

**Quit policy — the question the ADR punted, answered.** The shim's life is
the client's (stdin EOF → exit); the app's life is its own. Quit the app
mid-session and the shim sees EOF and exits: quit means quit, and the next
question boots a fresh hidden app. The spawned app's converse: a server-mode
process stays alive for exactly three reasons — a stdio client, pipe
sessions, a visible window — and when the last goes, it quits itself
(event-driven, no polling; before quitting it closes its pipe listener so a
shim dialing mid-teardown gets REFUSED and correctly spawns fresh, rather
than a session into a corpse). A window a drive call revealed keeps the app
alive deliberately: a person may be reading what Claude did, and the app is
theirs until they close it. A spawned app whose shim died before ever
connecting quits on a 60-second backstop. Manual second launch routes through
Electron's single-instance lock: the second process delivers "show me the
app" — the hidden window reveals, focused — and exits.

**Verification.** 763 vitest, 103 packaged e2e — the drive and data specs now
ride the SHIM, the transport users actually get, which is also what lets them
run on Windows CI at all; one stdio-hosted spec stays as the Linux-only proof
of the direct mode. Mutation-tested: deleting the second-instance reveal fails
exactly the second-launch spec; deleting the idle self-quit fails exactly the
never-revealed assertion; the always-spawn mutant survives by architecture
(documented above). Server-mode processes write `<userData>/mcp-server.pid`
so the harness can stop a detached app it owns neither end of. Multiple
simultaneous pipe sessions share the drive bridge's global serialization —
two clients cannot interleave a settle window, though they can of course
observe each other's edits, the same as two people at one machine would.

**Windows verdict (2026-09-02): green.** The release workflow for `f4985dc`
passed on `windows-latest` — packaged e2e plus both ADR-0011 compliance
checks — which is what closes the Windows finding above rather than merely
routing around it. The drive and data tiers now have a working transport on
the primary target, and the three CI runs that blamed a stray CRLF stand as
the record of a diagnosis that was wrong for a defensible reason: the noise
was real, it just was not the fault.

### Phase-6 addendum (2026-09-02) — the button, and a file that is not ours

Setup was resolved at acceptance as "a button, not JSON" (see **Distribution
shape** above). This is that button, and the whole slice is governed by one
fact the ADR had not had to face until now: **this is the first time Carton
Fit writes a file belonging to another application.** Every decision below
falls out of it.

**Merge, never clobber — and refuse when we cannot see.** The write is a
read-merge-write of `claude_desktop_config.json` that preserves every other
`mcpServers` entry and every unrelated top-level key, in their original
order, in the 2-space-plus-newline shape Claude Desktop itself writes (so
connecting does not surface as a whole-file reformat in a dotfile repo). The
harder half is the malformed case, and "tolerate" there means something
specific: a **missing or empty** file is a fresh start, because Claude Desktop
ships without one; a file that does not parse is **refused**, untouched, with
a sentence naming it. The tempting reading — treat unparseable as blank — is
data loss wearing a tolerance label: a file we cannot read is not a file with
nothing in it, and it may hold exactly the servers the merge rule exists to
protect. Same reasoning extends to an `mcpServers` that is not an object. The
write itself lands through a temp file and a rename, because a truncated write
over that config is the same loss by a different route.

**The entry is the shim invocation the specs already drive**, not a fresh
guess: `process.execPath` (the Electron binary in both layouts — the installed
app when packaged, `node_modules/electron` in a checkout) running
`<appPath>/out/main/mcp.js --mcp` with `ELECTRON_RUN_AS_NODE=1`. That variable
is the Windows finding made operational: without it Claude Desktop launches a
GUI-subsystem process whose stdin never arrives, and the session hangs with
nothing in any log. `appPath` comes from the same `resolveAppRoot` derivation
both server modes use, so a config cannot name a build the handshake would
not. The `--user-data-dir=` flag appears **only** on a non-default profile —
the pipe is named per-profile, so omitting it on a throwaway profile would
send Claude to a universe with no app in it, while emitting it always would
put a machine-specific path in an ordinary install's config for no reason.

**Four states, because three would lie.** `connected` / `outdated` /
`not-connected` / `claude-not-found`, plus a loud `error`. `outdated` earns
its place: an entry under our key naming a different binary is an app that
MOVED, which re-connecting fixes — reporting it as connected would leave a
user staring at a working button and a broken Claude. The key
(`carton-fit`) is stable across versions and profiles for the same reason, so
a re-connect replaces one entry instead of accumulating one per install.
`claude-not-found` (no config directory) shows a sentence and **no button**:
writing a config for an absent program is litter under a name its owner never
chose. *(ADR-0030 renamed this state `not-detected` and made Claude Desktop one
client of two behind a registry; `shared/claudeConnect.ts` became
`shared/connect.ts`. The four-states reasoning is unchanged.)*

**Failure is loud, which inverts ADR-0021 deliberately.** The update check
answers every failure with silence because the app started it; this the user
just asked for, so its failures are theirs to see. The panel names the config
path in the error, because their next move is to go and look at it.

**The restart line is part of the feature.** Claude Desktop reads its config
at startup, so a correct write connects nothing until it is restarted —
without that sentence, success and failure look identical and the user's next
move is to doubt the button.

**Verification.** The e2e does not compare the written entry to a constant: it
**runs** it — spawning exactly the command the button wrote, speaking MCP down
it, and asking the app which file is open, with the answer being the part
imported through the UI moments earlier. Mutation-tested, and the mutation
testing corrected a claim: dropping the profile flag fails the round-trip as
expected, but dropping `ELECTRON_RUN_AS_NODE` **survives on Linux**, where an
Electron process's stdio works either way. The variable is a Windows
requirement, so it is carried by explicit assertions at the unit and e2e
layers rather than left to a round-trip that cannot see it on the machine most
runs happen on. Linux has no first-party Claude Desktop; the community
packages use the ordinary XDG config root, which is what makes any of this
testable on our CI at all.

### Phase-6 addendum, part 2 (2026-09-02) — Windows has two config locations

**Found by dogfooding, on the first real machine, within minutes.** A
Microsoft Store Claude Desktop was plainly installed and the panel said
*"Claude Desktop isn't installed on this computer."*

The panel was telling the truth about the path it checked. **Claude Desktop
ships two ways on Windows, and the Store build is MSIX-packaged, which
VIRTUALIZES `%APPDATA%`.** The packaged app writes what it sees as
`%APPDATA%\Claude\claude_desktop_config.json`; Windows silently redirects
that to
`%LOCALAPPDATA%\Packages\Claude_<publisher hash>\LocalCache\Roaming\Claude\`.
Carton Fit is not packaged, so it sees the *real* `%APPDATA%\Claude` — which
on a Store-only machine does not exist at all. Both processes were right about
`%APPDATA%`; they were simply not looking at the same filesystem. The
dogfooder's config was found at the redirected path, holding a full set of
preferences and no `mcpServers` key — precisely the file the merge rule exists
to protect.

So path resolution becomes a **candidate list plus a selection rule**, and the
rule is the interesting half. A candidate that already HOLDS a
`claude_desktop_config.json` wins outright over one that merely exists: on a
machine carrying both builds the file is the evidence of which Claude Desktop
is actually in use, while an empty directory is evidence of nothing. Only if
no candidate has a config does mere existence decide, in candidate order
(Store first on win32). When nothing is found, the message names the CLASSIC
path — the one a person can go and look at. The package folder is matched by
the `Claude_` prefix rather than hardcoded, because the suffix is a publisher
hash and a publisher hash is not ours to pin.

The list is built by a pure function that takes the enumerated package folder
names as an argument, and the selection rule takes its two filesystem
questions as injected predicates — so every Windows shape and every branch of
the rule unit-tests on Linux, which is the only way this specific bug could
have had a test before a Windows machine saw it.

**What this says about the original design.** The defect was not a wrong
constant, it was an unexamined assumption that a program has *one* config
location — and no test could have caught it, because every test agreed with
the assumption. Dogfooding on a real machine is what ADR-0005 puts at the top
of the pyramid for exactly this class of finding, and it earned its place here
inside an hour of the build being staged.

### Phase-6 addendum, part 3 (2026-09-02) — the dialect on the wire

**The second dogfood finding, an hour after the first, and it answers the
question the first left open:** the Store Claude Desktop DOES spawn the shim.
The handshake succeeded, all fifteen tools listed (proxied as
`mcp__remote-devices__carton-fit__*`) — and every call was rejected before it
reached the app:

> Tool 'get_app_state' has an invalid outputSchema: JSON Schema declares an
> unsupported dialect ("$schema": "http://json-schema.org/draft-07/schema#").
> The default validator supports JSON Schema 2020-12 only.

**The cause is the SDK, and the SDK offers no switch.** `registerTool`
converts our zod shapes with zod's `toJSONSchema` at a target the SDK
hardcodes to draft-7 (`mapMiniTarget(undefined)`), and 1.30.0 — the latest
1.x, byte-identical in that file — exposes no option to change it. Current
clients validate 2020-12 only. This is the ecosystem's known break
(typescript-sdk#2532 and #745; claude-code#86142; SEP-1613 makes 2020-12 the
protocol's default dialect), not a property of our schemas.

**Why 763 green tests shipped it:** every MCP test here talks through the
SDK's own client, and that client tolerates draft-07. A suite cannot catch a
disagreement between two parties when it only ever plays one of them.
`tests/mcp-schema-dialect.test.ts` reads the label instead of tolerating it.

**The fix is one label, and that it is ONLY a label was measured.** The SDK
accepts either a raw shape or an object instance; a raw shape it rebuilds into
a fresh `z.object` (discarding metadata), an instance it passes through
untouched — and zod lets root metadata override the `$schema` it would stamp.
So `wire(shape)` returns `z.object(shape).meta({ $schema: <2020-12> })`, and
every registration goes through it. Same shape, same validation (the SDK now
parses through this very instance), one label. Before/after `tools/list` was
diffed with the `$schema` lines removed: identical. And for every shape on the
surface, zod's draft-07 and 2020-12 bodies are byte-identical — pinned per
shape, so a future construct where the dialects genuinely differ fails the
test rather than shipping mislabelled.

**Rejected on the way:** dropping `outputSchema` (the thirty-second unblock the
client itself suggested) — it is what enforces requiredness on the wire, the
mechanical half of "an unqualified answer is our bug" (phase-2 addendum);
hand-converting to JSON Schema and passing that — SDK 1.30 treats a plain
JSON object as "no schema" and validates only zod; `patch-package` on the
SDK's default — correct but a new build dependency and a postinstall hook to
fix what one line of our own code fixes; upgrading — nothing to upgrade to.

### Phase-2 contract amendment (2026-09-02) — `binding.bound`, and a role the ADR did not name

**The third dogfood finding of the day, and the first made by the client
itself.** On its first working session Claude loaded a real assembly, ran
three passes, and flagged this from the middle one — a fit at 13.23 lb of a
35 lb cap, all 18 parts placed, 26% fill:

> `"binding": {"constraint": "weight", "note": "The weight cap stopped this,
> not the carton — there is room left."}` — Nothing stopped it. … that note
> is exactly the kind of thing someone would repeat in a packaging decision.

Its diagnosis was close and not exact, and the difference is the fix. The
core's attribution is deliberate and documented (`extremePointFit.ts`): with
everything placed, `binding` names the constraint with the **least headroom**
— 38% of the cap against 26% of the carton is "weight", and that is useful
information (what would bind first if more were added). What was wrong was
the sentence this layer wrapped around it: the core said *closest*, the
report said *stopped*. The panel makes the same stretch ("Limited by:
weight") but sits beside "13 of 35 lb", so a person can see nothing was hit.
An AI client reads the note, not the panel.

**Amendment.** `binding` gains a required `bound: boolean` — true only when a
constraint actually rejected or truncated something (any max-quantity count;
a non-fit) — and the note on an all-placed fit now says what the number
means: *"Nothing bound — all 18 parts placed at 38% of the weight cap and
26% of the carton. Weight is the closer limit."* The enum stays
`geometry | weight`: a `none` value would be a breaking change under
ADR-0020 and would discard the headroom answer; a required boolean is
additive (minor), and structural rather than prose per this addendum's own
rule 3. The panel heading becomes **"Closest limit"** on a fit, "Limited by"
otherwise. Exports (`summary.ts`, `csv.ts`) still say "Limited by" on a fit
— carried on roadmap item 21; a quote is the worst place for the
overstatement, and it deserves its own look rather than a silent widening.

**The role the ADR did not name.** The premise was two roles: the AI keeps
judgment, the engine supplies numbers. Today produced a third — **the AI as
an adversarial reader of the engine's prose.** 805 tests and two months of
dogfooding passed that note, because nothing asserted what it *meant*; the
client caught it on first contact because it had to decide whether to repeat
it. The consequence is a rule going forward: every sentence the engine
emits on the wire is a claim, and a claim gets a test that pins the claim,
not the wording (the same discipline `tests/pack-verdict.test.ts` already
applies to the panel's verdict captions).

### Phase-2 contract amendment 2 (2026-09-03) — the other constraint needs a witness

**Same reader, same file, one level down.** The amendment above fixed the note
for a pack where nothing bound. The client came back to the *bound* case — a
max-quantity run capped at 3 plates — and found the surviving sentence saying:

> `"The weight cap stopped this, not the carton — there is room left."` … Check
> the geometry: the plate only lies flat, `0.79·4 + 0.25·3 = 3.91 > 3.5`. Both
> constraints bind at exactly 3, and there is not room for a 4th.

It is right, and its arithmetic checks out. The first clause of that note was
computed; the second and third never were. `binding` is a **single winner**
by construction — `quantityGrid.ts` resolves a tie to `'weight'` deliberately,
as "the user-facing limit" — and this layer had been reading a label that
means *which limit is nearer* as a statement that the other one was idle.

Its proposed evidence, though, was wrong, and adopting it would have shipped a
new false claim in place of the old one: `upperBound === count` does not show
the carton is full, because the rigorous bound is
`min(volumetric, per-axis, weight)` (ADR-0022 §7) — the cap is *inside* it, so
that equality holds on every weight-capped run, roomy carton or not. Recording
this because the near-miss is the lesson: **an adversarial reader can be right
about the defect and wrong about the fix, and the second half still has to be
checked.**

**Amendment.** `binding` gains a required `otherConstraint: Known<{atLimit}>`,
and no note may assert anything about the unnamed constraint without it. The
engine gains the witness it needs: `MaxQuantityResult.geometryBound`, the same
bound with the weight component left out, which is the only number that can
tell "the cap stopped a roomy carton" from "both landed on the same figure".

What can be proven is asymmetric, and the notes now follow that shape exactly:

- **Weight is arithmetic** — a cap and a set of masses settle it in both
  directions, so "the cap has room to spare" and "the cap would have stopped
  this too" are both stated outright.
- **Space is not.** Counts are heuristic arrangements and bounds may be loose,
  so a geometry bound *above* the count proves nothing: an arrangement holding
  one more may exist or may not, and only attempting it would tell. Equality
  is the single exception — a rigorous geometry-only bound equal to the count
  means no arrangement anywhere fits another copy, which is the plate case.
- So **"the carton is full too" is provable and gets said; "the carton has
  room" is not, and is now simply absent.** The note says what stopped the
  pack and stops there, with `otherConstraint.known: false` carrying the reason.

Rule 3 of the addendum above (structural, never prose-only) is what made this
an additive field rather than a rewording; ADR-0020 keeps it a minor change.
The panel and the exports are untouched: "Limited by weight" is incomplete on
a tie but not false, and it sits beside the numbers a person can read.

**The standing rule this earns.** Three findings from this reader, and all
three were *sentences*, never numbers — the engine has been right every time.
So: any wire sentence that asserts what did **not** happen requires a field
that establishes it, and if no such field can exist, the sentence does not
either.

### Phase-2 contract amendment 3 (2026-09-03) — the first session run from the brief, in two clients

ADR-0032 turned this reader into a tier with a written itinerary, and the first
outing ran it in Claude Desktop and in ChatGPT (Codex) against the same build.
Both reports are in the same afternoon's history; what follows is what survived
independent verification.

**The convergence is the useful part.** Two clients, two products, two framings
— and they landed on the same two defects without seeing each other's work: the
CSV dropping a qualification the summary keeps (ADR-0017's addendum), and
`upperBound` being read as evidence about the carton. On the second, one called
it "unstable" (wrong — it is `min(volumetric, per-axis, weight)` exactly as
ADR-0022 §7 documents) and the other called it "documented as geometric, and
actually joint" (right). **Two readers guessing at the same field is not two
mistakes; it is a missing field.**

**Amendments:**

1. **`geometryBound` goes on the wire**, beside `upperBound`, as
   `Known<{count}>`. It existed internally from amendment 2 and was doing the
   work behind the prose — but a client asked to reason about space had nothing
   to reason with, so it invented a mechanism. Additive, so minor under
   ADR-0020.

2. **The count's caption stops contradicting the bound in its own payload.**
   `verdictCaption` appended "Heuristic — a mixed arrangement may fit more" to
   every count, including the ones carrying `upperBound === count`. A reader was
   being sent after a fourth unit the same reply had ruled out. The hedge is now
   dropped at the bound, replaced by "no arrangement beats this under these
   limits". `upperBoundLabel`'s own comment had described this case since it was
   written ("when they meet, the answer is optimal"); the caption four lines
   above it did not. This is the shared verdict module, so the fix lands on the
   panel, both exports and the wire at once — which is exactly why the module
   exists.

3. **Two tool descriptions stop promising more than their fields deliver.**
   `estimate` said the reply names "which hard constraint was binding", which is
   false whenever `bound: false` — the field names the CLOSEST limit, and
   amendment 1 deliberately kept it that way rather than nulling it (a `none`
   would be breaking under ADR-0020 and would discard the headroom answer). It
   also called the bound "rigorous" without saying the weight cap is inside it.
   Both now say what is true. Note the shape of this one: the defect was in the
   DESCRIPTION, and the reader's proposed fix — null the field — had already
   been considered and rejected here for reasons it could not see.

4. **Three silent behaviours are now announced** where the client meets them:
   `load_model` clears the unit part and the per-kind overrides (both clients
   tripped on this, and in max-quantity it silently changes the question from
   "how many plates" to "how many assemblies"); `save_preset` does not store
   overrides or the unit part; the preset and estimate lists are append-only.
   None of these is a behaviour change — each is documented in the code and was
   invisible on the wire, which is the definition of a surface gap.

5. **`weightInput` says where the counted grams came from.** `source` reported
   the MODE that was set, which is honest about the input and was being read as
   a statement about the answer: a max-quantity count whose one unit part was
   priced by hand came back `source: "density"`, with the summary export's prose
   getting it right and the structured field — the one a script reads — not.
   `source` keeps its meaning and its enum (changing a wire value's semantics is
   not additive under ADR-0020) and gains a label saying it is an input;
   `countedWeightFrom` is new and scoped to the parts the pack actually weighed,
   via the same `partsForRequest` selection the engine and the open-mesh warning
   use. It reports `override`, `mixed`, or the mode that derived them — and
   `mixed` is a real state, not a rounding: a fit-check weighing five kinds with
   one priced by hand is neither.

**Deferred, deliberately: the space-only rerun.** Amendment 2 can prove the
carton is FULL (a rigorous geometry bound meeting the count) but never that it
has ROOM, because a bound above the count proves nothing. Both sessions wanted
the positive claim, and the Claude session proposed the mechanism that would
earn it: rerun the pack at an unbounded cap and compare counts — a strictly
higher count is a constructive proof that room exists, which no bound can give.
It costs a second pack per max-quantity estimate, so it gets its own ADR rather
than a paragraph here.

**What this run says about the tier.** Every finding was a sentence or a field
description; not one was a wrong number, and the session that found the most
said so itself — "the engine is not the problem". Three sessions, three times
the same result. The suite proves the mechanism and has never once proven the
prose.

### Phase-2 contract amendment 4 (2026-09-03) — the second two-client run, and the wording leaves this file

Same brief, same afternoon, both clients again, on a build that carried
amendment 2 but not amendment 3. What survived verification:

1. **ADR-0033 is accepted and built** — see its addendum for the measurement
   and the "one call away" finding that made it urgent. `otherConstraint`
   gains `evidence`, the outcome gains `spaceOnlyCount`, and the `known: false`
   reason no longer asserts what its bound merely fails to exclude.
2. **`bindingReport` now lives in `packing/verdict.ts`**, not here. Both
   exports were writing "Limited by: weight" flat beside an answer this layer
   refused to make — the item-21 carry-in, with sharper evidence than when it
   was deferred. The summary uses the panel's heading ("Closest limit" on a
   fit) and carries the sentence; the CSV keeps `Limited by` for the scripts
   that read it and adds `Limit bound` and `Limit note` (ADR-0017, second
   addendum).
3. **"Space is the closer limit" stops ranking against a weight nobody gave.**
   Third session to flag it. With every part weightless the note says so
   instead of comparing a real percentage to a placeholder.
4. **`utilization` names its basis** — `bounding-boxes`. A reader could not
   act on 34.3% without asking whether it was material or boxes; now the field
   says. Additive.
5. **`set_inputs` documents how to run with no weight** (`partWeight: 0`),
   because `weight: {}` is "keep", and a reader found the live app and the
   stateless tool unequally capable at the one station that cross-checks them.
6. **The packed view rendered nothing for the fused whole-file unit.** Not
   prose — the first wrong *picture*. `composeUnit` names the unit "18 parts",
   and the scene builder's stale-data guard skipped the name. One client saw
   the empty carton at count 1; the other saw a correct three-plate render at
   count 3; both were right, and the pair of reports is what located it. The
   convention is now exported from `unit.ts` and the view renders every part
   at the unit's transform.

**What this run says about the tier**, in addition to what the last one did:
two independent readers on the same build disagreed about the viewport, and
the disagreement was the diagnosis. Where they agreed it was the app; where
they differed it was the input — and that is a property one reader cannot
have.

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
