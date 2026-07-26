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

## Revisit triggers

- Dogfooding produces a real "I wish it had recorded that" — reopen the
  ambient-trail loss, possibly as an opt-in session log distinct from saved
  estimates.
- A real export request (CSV or PDF) arrives → its own ADR, with the ranked
  sketch above as the starting point.
- Undo wants to cover file loads → revisit the scope boundary in decision 2
  rather than quietly widening it.
