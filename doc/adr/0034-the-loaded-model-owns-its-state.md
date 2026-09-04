# ADR-0034: The loaded model owns its state

**Status:** Proposed, 2026-09-04. Accepted on feel — the user will decide once
it is built and dogfooded, which is the right bar for a change whose whole
point is what the sidebar is like to use.

## Context

Two screenshots from the sixth dogfood pass, taken from the app as it actually
stands, say more than the finding that prompted them:

- **Presets:** twelve rows, every one named `dogfood-*`.
- **Saved estimates:** thirteen rows, every one `as1-oc-214.stp`, twelve shown
  and a line saying so.
- **AI assistants:** two rows — the one section a first-time user needs and
  touches once — at the very bottom, below twenty-five rows of residue, off
  the screen.

Three things are stacked in one always-open column, and they are not the same
kind of thing. The connect panel is *setup*: two verbs, done once. Presets are a
*library*: a handful of reusable carton setups, picked from. Saved estimates
are a *record*: a growing list of receipts, browsed. One of these should be a
button, one should be a picker, and one should be a list that knows what you
are looking at. The column treats all three as lists that scroll.

The user's second instinct is the sharper one: **a model is its own session.**
Open a file, and the things that belong to it — which part you are counting,
what you told the app a bolt weighs, the estimates you kept for it — should be
*its*, not the app's. Three facts say this is less a new idea than an existing
one waiting to be named:

1. **The store already scopes two things to the file.** `unitPartName` and
   `partWeightsG` are "deliberately NOT in the persisted settings: a part name
   belongs to the loaded file, so it is cleared on every import rather than
   carried across sessions" (`store.ts`; ADR-0018 §3 for the overrides, whose
   revisit trigger reads *"a fifth piece of file-scoped state → consolidate the
   slices"*). `load_model` already reports what it cleared (ADR-0029 amendment
   6's `cleared` block). That is a document model in miniature, with no name.
2. **The schema already keys estimates by the part.** `estimates` carries
   `file_name` *and* `content_hash`, with an index on the hash whose comment,
   written in ADR-0007, reads: *"have I estimated this part before?" is the
   other question the UI will ask.* `EstimateStore.forContent()` exists,
   `estimatesForContent` runs end to end through IPC and the preload, and
   **nothing in the renderer calls it.** The question was anticipated, plumbed,
   and never asked.
3. **The provenance finding dissolves under it.** Roadmap item 25's open
   follow-up — "no field says whether an input was set this session or
   inherited," the second dogfood run tripped by the same thing — is a question
   about *ownership*. Bolt a `setThisSession` flag onto `get_app_state` and the
   flag is right but the model is still wrong: the app would still be a single
   global workspace that happens to remember who typed what. Under a document
   model, file-scoped state either came with the document you opened or you
   just set it, and there is nothing left to flag.

What is *not* file-scoped, and must not become so, is the thing the user's
instinct would sweep up with the rest: **presets.** The panel's own hint —
"Reusable carton setups — no part attached" (ADR-0016 §3 fixed that
vocabulary) — is the argument. A preset is carton + clearances + cap: a property
of how you *ship*, not of what you are shipping. A shop has five carton sizes
and hundreds of parts. Scope presets per file and the same five cartons get
re-entered for every model, and the library is empty exactly when a new part
lands, which is when it is worth the most. The twelve `dogfood-*` rows are not
presets being unscoped; they are a library nobody has tidied, and presets
already have a Delete button. **Saved estimates have none — not in the panel,
not on the wire** — which is the actual gap behind the reader's "no way to tidy
up," and the residue in the second screenshot is thirteen rows that could not
be removed by anyone.

## Decision

### 1. The loaded model is the document, and three things belong to it

A **document** is the loaded file, identified by its `content_hash`. It owns:

- the **unit part** (`unitPartName`) — already file-scoped;
- the **per-kind weight overrides** (`partWeightsG`) — already file-scoped;
- its **saved estimates** — the rows whose `content_hash` matches.

Nothing about *how* these are stored changes. The two store slices stay where
ADR-0018 put them; the rows stay in the one `estimates` table ADR-0007 made.
What changes is that the app gets a word for the boundary the store already
draws, and the saved-estimates list starts respecting it.

### 2. Carton inputs and presets stay global

The carton, clearances, weight mode and cap — `PackingSettings`, persisted to
`localStorage` — remain the app's, not the document's. The common workflow is
*"new part, same box: does it fit?"*, and that workflow needs the carton to
survive a file load. A per-document carton would answer "what did I last use
for this part?", and that question already has an answer: a saved estimate.

Presets stay global for the reason in Context. They are the carton library.

### 3. The saved-estimates list is scoped to the document by default

`SavedEstimatesPanel` shows the rows for the loaded model, via the
`estimatesForContent` path that already exists, with an **All** control that
widens it to today's newest-first list. With no model loaded there is nothing
to scope to, so the list is the full one and says so.

Three rules make the scope honest rather than a filter that loses things:

- **Scope the view, never the data.** No row is hidden from *All*, none is
  deleted by a load, and ADR-0016 §1's rule that a row is a receipt for a
  decision is untouched. A receipt you cannot find is not one.
- **Identity is the hash; the name is a label.** A row belongs to the document
  when its `content_hash` matches. The name is shown, and grouped on, but never
  matched on: two different parts that share a filename must not merge, which
  they would under name matching. The known cost is the inverse — re-export the
  same part from CAD with a trivial change and the hash moves, orphaning that
  part's history into *All*. That is a revisit trigger below, not a reason to
  match on names now.
- **An empty hash matches nothing.** `saveEstimate` writes `contentHash: ''`
  when hashing failed, so the row still saves. Such rows are never anyone's
  document; they live in *All* only.

### 4. Saved estimates can be deleted — from the panel, not from the wire

A **Delete** on each estimate row, alongside *Restore inputs*, matching the
affordance presets already have. The wire stays append-only for estimates:
ADR-0029's rule that everything the drive tools do is undoable holds, a delete
is not, and the description on `list_saved_estimates` already says so in as
many words. The person at the keyboard can discard a receipt; the assistant
cannot discard one for them.

No thinning, no auto-expiry, no "keep the last N". ADR-0016 considered and
rejected mechanisms that decide for the user which rows matter, and the sixth
dogfood's residue does not change that: the rows are there because thirteen
saves were pressed, and the fix for thirteen unwanted receipts is a bin, not a
rule.

### 5. Three homes, not one container

The sidebar stops stacking three different natures as three lists. Each goes
where its nature says:

- **AI assistants leave the sidebar.** Setup, done once, two verbs: it belongs
  in the header, beside the theme picker, as a control that opens the connect
  UI (a popover or a small dialog — the build decides which). It is the one
  surface no machine check covers (ADR-0030), and it is currently the hardest
  thing in the app to find.
- **Presets become a picker beside the carton inputs.** A preset *is* carton
  inputs, so a compact select-plus-save-plus-delete next to the fields it fills
  is where a person looks for it. It stops being a scrolling list of names.
- **Saved estimates become a collapsible section** — native `<details>`, the
  pattern `ConnectClientRow`'s "Set it up by hand" already uses — with the
  document's count in its summary line, scoped per §3, with *All* inside.

This was proposed as a menu bar — File / Edit / View — and the instinct behind
that is right: get the three things out of the working column. The mechanism is
wrong for two of them. A menu is for verbs, and a dropdown that has to render
thirteen rows with two buttons each is a bad dropdown. The connect surface *is*
verbs, and gets menu-like treatment; the other two are nouns and get a picker
and a list.

**The exact presentation is a build-time decision, judged by feel.** This ADR
fixes the structure — what leaves the sidebar, what collapses, what scopes —
and says nothing about pixels, because the user will decide those with the
thing in front of them.

### 6. The wire follows, additively

- `list_saved_estimates` gains `scope: 'model' | 'all'`, default `'model'` when
  a file is loaded and `'all'` otherwise — the same rule as the panel. Optional
  input on an existing tool: a minor under ADR-0020 §3.
- `get_app_state.model` gains `savedEstimates: number` — how many receipts this
  document has. Additive.
- Nothing is removed and no reply changes shape. `cleared` on `load_model`
  already tells an assistant what a load threw away; with the document named,
  the dogfood brief's station 0 can say *"load the model first — the document
  starts clean"* instead of *"reset what you did not set,"* which is the
  workflow-level fix item 25's fourth follow-up was asking for.

## Consequences

- The thirteen-row list in the screenshot becomes the three that concern the
  part in front of you, without deleting anything, on the day §3 ships. Most of
  the mess was never data; it was a list that did not know what you were
  looking at.
- The connect panel goes from the hardest thing to find to a header control.
  That surface is verified by no runner (ADR-0030), so this ADR does not change
  its tests — it changes only where the trigger sits, and `e2e/connect*.spec.ts`
  will need to reach it through the header.
- `estimatesForContent` gets its first caller, four decisions after it was
  written. The prepared statement, the IPC channel and the preload binding are
  all already there; the renderer-side storage service gains one function.
- Deleting an estimate is a new IPC (`storage:estimates:remove`) and a new
  prepared statement, no schema change, no migration.
- ADR-0018's "consolidate the slices" trigger fires in a different form than it
  expected: the slices do not merge into one object, they gain a name for what
  they have in common. Whether they should physically consolidate is left to
  the build.
- The dogfood brief changes at station 0 and station 6 once this ships;
  ADR-0032's rule that the brief is the artifact applies — the change lands in
  `doc/dogfood/mcp-session.md`, not in a skill.
- VISION.md's "Presets & saved estimates" paragraph gains the document
  boundary when this is accepted, not before: VISION describes what the app
  does.

## Alternatives considered

- **Per-file presets** — the user's first framing. Rejected in Context: a
  preset is a shipping property, and per-file presets empty the library exactly
  when it is needed. If dogfooding says a *part* wants to remember its
  last-used carton, that is what a saved estimate is, and the answer is to make
  restoring one easier, not to fork the preset table.
- **A File / Edit / View menu bar for all three.** Right instinct, wrong
  mechanism for the two that are lists (§5). Kept in spirit for the connect
  surface.
- **Per-document carton inputs.** Rejected in §2: it breaks "new part, same
  box." Recorded as a revisit trigger in case the workflow turns out to be the
  other way round for real users.
- **Match estimates on file name.** Rejected in §3: merges different parts that
  share a name, which is a worse failure than orphaning a re-export. Hash
  first; name grouping is the revisit.
- **A `setThisSession` provenance flag on `get_app_state`** — the fix item 25
  first reached for. Rejected because it answers the symptom: the flag would be
  correct and the app would still be one global workspace. The document model
  removes the question.
- **Thinning saved estimates** (keep last N, collapse duplicates). Rejected
  again, for ADR-0016's reason: only the user knows which receipt was the
  answer. A Delete button is the whole mechanism.
- **A per-document `content_hash` column on `configurations`** to let a
  preset optionally attach to a part. Rejected as a half-measure that reopens
  the vocabulary ADR-0016 §3 fixed; if a part-attached carton setup is ever
  wanted, it is a saved estimate with a name, which is its own small ADR.

## Revisit triggers

- **A re-exported part orphans its history in dogfooding** — someone saves
  estimates, re-exports the STEP from CAD, and finds them under *All* only.
  Then §3's identity rule grows a second tier: group by name, match by hash,
  and show the name-matches as "earlier versions of this file."
- **A user wants the carton to follow the part** — reopens §2. The evidence
  would be someone restoring saved estimates purely to get the carton back.
- **The collapsed saved-estimates section hides the count people need** — the
  `<details>` summary line is carrying the number; if it is not read, the
  section is wrong, not the scope.
- **The header control for AI assistants is not found either** — then the
  problem was never position, and the connect flow needs a first-run prompt
  (ADR-0030's territory).
- **A fifth kind of thing wants a home in the sidebar** — §5's rule is that it
  goes where its nature says (verb, library, or record), not at the bottom of
  the column.
