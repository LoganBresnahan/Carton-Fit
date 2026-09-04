# ADR-0016: History records on explicit save; undo/redo is in-memory input history

Date: 2026-07-25
Status: Accepted
Relates to: ADR-0007 (storage), ADR-0009 (auto-run estimates)
Amends: `doc/VISION.md` "Saved configurations & history"

## Context

VISION's original line — "every estimate is recorded (file, settings, result) as
a queryable history" — was written when producing an estimate meant pressing a
compute button. ADR-0009 removed the button: the estimate follows the inputs,
debounced. "Every estimate" therefore silently became "every keystroke that
survived a 180 ms debounce," and item 7's literal implementation records dozens
of near-identical rows per session into an append-only table with no thinning
mechanism. The roadmap flagged this at ship time and pinned a placeholder
answer: collapse consecutive rows sharing content hash + settings.

Displaying history (item 11) forces the real decision. Collapsing turns out to
answer the wrong question. Even deduplicated, auto-recording keeps every
intermediate state the user passed through while converging on the carton they
meant — and nothing in the data marks which row was *the answer* and which were
"12×12×11.5, no wait." The rows are not noise around a signal; without the
user's intent, they are all noise.

A second, superficially related need surfaced in the same discussion: walking
inputs back. Under auto-run, mistyping a dimension replaces the estimate
instantly, and recovering the previous state means remembering and retyping it.

## Decision

Four decisions sharing one rationale — the auto-run model made "every change"
too fine a grain both for persistence and for regret:

### 1. History records on explicit save

The automatic recording subscription (`renderer/storage/history.ts`) is
removed. In its place, a **Save estimate** action captures the moment the user
declares an answer worth keeping: file name, content hash, settings, result —
the same row shape, through the same `recordEstimate` IPC, into the same
schema. No migration.

A row becomes what it could not be under auto-recording: a receipt for a
decision. Table growth becomes proportional to decisions, not keystrokes.

### 2. Undo/redo is in-memory input history, and never touches the database

Ctrl+Z / Ctrl+Shift+Z walk a bounded, session-scoped stack of settings
snapshots. Because every settings change already funnels through
`updateSettings` (ADR-0006) and estimates re-run automatically (ADR-0009),
undoing an input *is* undoing the estimate — no result state is stored or
restored.

- **Coalescing:** successive edits to the same field within a short window are
  one undo step. Typing `1`, `12`, `125` must not cost three Ctrl+Zs.
- **Preset and history restores are one undo step each.**
- **File loads are outside undo.** Re-importing on Ctrl+Z would be heavyweight
  and surprising; undo is for inputs, not for documents.
- **Keystroke routing** (amended 2026-07-25 after dogfooding): Ctrl+Z inside a
  *text* field is left to the browser — it means "undo my typing" everywhere,
  and native undo re-fires `onChange`, so the mechanisms compose. **Number
  inputs are the exception**: spinner clicks and arrow-key steps are not text
  edits, so they never enter the browser's undo buffer, and deferring left
  Ctrl+Z dead whenever focus sat in the field it had just changed. Number
  fields keep app undo — nothing is lost, because every keystroke there
  commits to the store and coalesces, so app undo subsumes the native buffer.
- The stack does not survive a restart, and none of this persists anywhere.

### 3. Restoring a history row loads its settings, never its result

The estimate on screen is always one the engine just computed from the current
inputs. That invariant is load-bearing across the app (auto-run, staleness
dimming, verdict wording), and history restore does not get to break it. With
the same file loaded, restored settings re-run the pack and reproduce the
answer honestly; with a different file, the user gets *that* file's answer
under those settings, produced and labeled by the normal flow. The row is a
receipt, not a cache.

This also fixes the vocabulary: **presets** (saved configurations, item 7) are
reusable carton setups; **saved estimates** are receipts about a specific part.
The UI copy keeps them visibly distinct.

### 4. Export is deferred, and is not smuggled in through this ADR

Export is a product capability VISION does not list; it enters through its own
decision or not at all. Ranked sketch, recorded so the next discussion starts
where this one ended: a **Copy summary** button (the answer as one sentence of
text) and a **packed-view PNG** are cheap, schema-free conveniences that read
the live result, not the database — reasonable near-term additions outside
this ADR. CSV-of-history and PDF reports are speculative until dogfooding
produces a real request; PDF in particular means a new dependency, which is an
ADR plus a THIRD-PARTY-NOTICES entry by house rule (ADR-0011).

## Consequences

- VISION's history line is amended from "every estimate is recorded" to
  estimates the user chooses to keep. The ambient audit trail is **given up
  knowingly**: "what did I quote for this part last month?" has an answer only
  if the user saved that day. For this product a quote never saved is a quote
  never given — but this is the one real loss, so it is stated here rather
  than discovered later.
- `history.ts` and its exactly-once machinery are deleted — that machinery
  existed to tame precisely the flood this ADR turns off. The e2e spec
  asserting estimates auto-record is rewritten to assert explicit save.
- Rows recorded by the auto-recording era remain valid (same shape); they are
  simply denser than rows recorded after. No cleanup pass: the table is small,
  and deleting user data to tidy a transition is a worse trade than ignoring
  it.
- `estimatesForContent(hash)` and the newest-first ordering ship unchanged;
  item 11's UI reads what item 7 already stores.
- Item 11's implementation becomes: save-estimate action, history browser with
  settings-restore, undo/redo stack with coalescing. No schema change, no
  migration, no new dependencies.

## Addendum, 2026-09-04 (third two-client dogfood): a receipt that does not say what it counted is not a receipt

§3 says a saved row is a receipt, not a cache — restoring its settings re-runs
the pack and "reproduces the answer honestly". It did not, and the reason was
one missing key. `saveEstimate` wrote `settings` and, since ADR-0018 §3, the
per-kind overrides beside them; it never wrote the **unit part**. So a row saved
as "3 fit" with the plate selected, restored into a session on the whole file,
recomputed 1 — and a row saved as "1 fit" on the whole file, restored into a
plate session, recomputed 3. Nothing in either reply said what had changed. The
reader that found it isolated the cause cleanly: the overrides restored
correctly beside the wrong count, so the unit part was the single input the
receipt had never carried.

The fix is the shape ADR-0018 already chose: `unitPartName` rides in the same
opaque blob beside `partWeightsG` (no schema change, no migration), and restore
prunes it the way overrides are pruned — a name the loaded file does not have
becomes the whole file rather than invisible state. Rows written before this
date have no key and restore the whole file, which is what they were saved
against in fact: the picker's choice was never written down, so "3 fit" coming
back as 1 is such a row telling the truth about what it recorded, for the first
time. The one-line receipt now names the unit ("3 fit · of plate · …"), because
three rows that read alike were saved under three different setups and could
not be picked apart.

Two things this changes about §2's undo rule, stated rather than left to be
discovered: a restore is still one store write and one undo step, but the unit
part is not on the undo stack (it never was — it is file-scoped state, not an
input), so undoing a restore reverts the settings and overrides and leaves the
unit part where the restore put it. That is a gap, and it is the pre-existing
one, not a new one; it is worth closing when the picker joins the stack.

## Alternatives considered

- **Collapse consecutive rows sharing content hash + settings** (the roadmap's
  placeholder). Rejected: deduplication removes *repetition*, not *noise* — it
  still records every intermediate carton, and still cannot say which row the
  user meant. Also adds a write-path subtlety (mutate-last vs insert) for a
  table whose problem is meaning, not volume.
- **Record on "settled" heuristics** (debounce quiescence, file close, app
  quit). Rejected: replaces the user's intent with a guess about it, and the
  guess fails exactly when it matters (the user pauses on a wrong carton, then
  fixes it).
- **Undo via history rows** (Ctrl+Z walks the database). Rejected outright:
  couples an in-session editing affordance to persistence, makes undo depth
  depend on what was saved, and under explicit save would mean undo mostly
  does not work.
- **Auto-record everything, thin later** (retention windows, compaction).
  Rejected: infrastructure to manage data nobody asked to keep.

## Addendum 2, 2026-09-04: the picker joins the stack

The first addendum made a saved estimate carry its unit part, so restoring "3
plates fit" stops recomputing against whatever unit happened to be current.
That fix created a second, quieter asymmetry, and it is the one this addendum
closes: **the undo stack never carried the unit part either.**

While a restore did not carry one, nothing was visibly wrong — the picker was
simply outside the history, the way the loaded file is. Once a restore *did*
carry one, a single Ctrl+Z put the settings and the overrides back and left the
restored unit part standing. One step, half reverted, and the half it left
behind is the one that decides what the count is a count OF. A step that
reverts the inputs to a question while leaving the question is worse than a
step that reverts neither, because the result it lands on is one nobody asked
for.

So `Snapshot` gains `unitPart`, `changeSignature` names it (picking a unit part
is its own step; two picks inside the coalescing window collapse the way two
edits to one number field do), and the subscription watches that slice.

**Applying prunes against the parts loaded now, not the ones loaded then.** The
stack outlives an import, so stepping back across one can carry a name the
current file does not have — and `partsForRequest` falls back to every part
when its filter matches nothing, so the store would claim a unit part the
answer was not counting. That is the same invisible-state rule the restore path
follows, and the two now share one function (`prunedUnitPart` in
`packing/kinds.ts`, beside `pruneOverrides`) rather than two copies that agree
today.

The general shape, for the next time a slice joins the inputs: **anything a
restore can set, undo must be able to unset.** The two features are one
timeline seen from opposite ends, and a field added to one is a bug in the
other until it is added there too.

## Addendum 3, 2026-09-04: the receipts get a scope and a bin (ADR-0034, Proposed)

Decisions 1 and 3 are untouched — a row is still written only on an explicit
save, and restoring one still re-applies inputs and never replays a result.
Two things around them change under ADR-0034:

- **The list is scoped to the loaded model by default.** The sixth dogfood
  screenshot showed thirteen `as1-oc-214.stp` rows, twelve shown; scoped, that
  is the three that concern the part on screen. The view is scoped, never the
  data: an *All* control shows today's list, no row is hidden from it, and a
  load deletes nothing. Identity is the `content_hash` ADR-0007 already keyed
  on — the name is a label. A receipt you cannot find is not one, and this is
  what keeps the rule true as the table grows.
- **Rows can be deleted, from the panel only.** This ADR's rejection of
  *thinning* stands — no keep-last-N, no collapsing, nothing that decides for
  the user which receipt was the answer. A Delete button is not thinning; it
  is the user deciding. The wire stays append-only (ADR-0029 amendment 8),
  since everything the drive tools do is undoable and a delete would not be.

The "I wish it had recorded that" trigger below has not fired in six dogfood
runs. The opposite did — "I wish I could remove that" — thirteen times over.

## Addendum 4, 2026-09-04 (seventh dogfood): the receipt named the wrong limit, or none

A receipt is one line, and decision 1 made it a receipt *for a decision* — so
the line has to be true on its own, because it is the part that gets skimmed and
pasted. It was not, in three different ways, all in one comparison:

```ts
if (binding === 'weight' || binding === 'space') parts.push(`${binding}-limited`)
```

1. **`'space'` is not a value.** `BindingConstraint` is `'geometry' | 'weight'`;
   `'space'` is the display word `bindingLabel` produces. The comparison was
   dead on one side, so **every geometry-bound receipt went out unlabelled** —
   visible in the app's own sidebar as bare `3 fit · 11×6×10 in` rows sitting
   beside `weight-limited` ones, with nothing saying the bare ones were the rows
   the carton stopped.
2. **The weight side named the winner and dropped the tie.** Where
   `geometryBound` meets the count, the carton is full over every arrangement,
   and `3 fit · weight-limited` invites "a lighter alloy buys more per carton" —
   which buys nothing. The reader who found this did the arithmetic: a fourth
   plate needs 3.90 in on an axis with 3.5 in usable.
3. **It appended a limit to a fit-check that FIT.** `binding` names the closest
   limit even when nothing bound (ADR-0029 amendment 1), so "everything fit" was
   written down as "weight-limited".

**Decision: `bindingPhrase`, three-way and defensive.** Nothing on a successful
fit-check; `both limits` where the row's own `geometryBound` proves the tie;
otherwise the correct display word for the constraint that bound. A row with no
`geometryBound` — saved before the field existed — keeps the single word rather
than gaining a claim its JSON cannot carry, which is this module's standing rule
about reading other builds' data.

**Why it survived a file that has tests**, which is the part worth keeping:
every fixture in `tests/estimate-summary.test.ts` used a weight-bound row, and
`tests/mcp-data-tools.test.ts` asserted `space-limited` from a fixture whose
`binding` was the literal string `'space'` — **a value no engine has ever
written**. So a dead branch had a passing test pointed straight at it. That is
the second time in one day that a fixture omitting or inventing an engine-set
field hid a defect here (the first was the loose-bound branch in
`otherConstraintOf`), and it is now the thing to check first when a branch looks
covered: *does the fixture describe a state the engine can produce?*

## Revisit triggers

- Dogfooding produces a real "I wish it had recorded that" — reopen the
  ambient-trail loss, possibly as an opt-in session log distinct from saved
  estimates.
- A real export request (CSV or PDF) arrives → its own ADR, with the ranked
  sketch above as the starting point.
- Undo wants to cover file loads → revisit the scope boundary in decision 2
  rather than quietly widening it.
