# ADR-0017: Export is presentation of the live estimate — summary, CSV, PNG

Date: 2026-07-25
Status: Accepted
Relates to: ADR-0016 (explicit save; §4 deferred export), ADR-0015 (flag, don't
refuse), ADR-0008 (imperative three viewport), ADR-0009 (auto-run)

## Context

ADR-0016 §4 deferred export "until dogfooding produces a real request." The
request arrived while dogfooding the first deployed build: what's wanted is the
estimate in a form that leaves the app — pasted into an email or a quote,
attached as the picture that makes the count believable, and the measurements
as a table a spreadsheet can ingest.

Three facts shape the design:

- **Everything worth exporting already exists in one place.** `PackSink.succeed`
  pairs the result with the exact request that produced it, and the store holds
  the parts and display settings. No new state, no schema, nothing persisted.
- **The estimate on screen is the only honest thing to export** (the ADR-0016 §3
  invariant). Exporting a *saved* row would export an answer the engine has not
  computed against anything currently loaded; restoring it first recomputes and
  then the live export applies.
- **The renderer cannot write files.** Copy-to-clipboard works in the renderer,
  but "save as…" needs a native dialog and a filesystem write, which live in
  main — a small new IPC surface alongside storage's.

## Decision

### 1. Three exports, all derived from the live request + result pair

- **Copy summary** — one clipboard-ready text block: part name(s), carton as
  typed (with wall/clearances/weight settings in the units on screen), mode and
  quality tier, the answer, the binding constraint, fill, and packed weight.
  This is the paste-into-a-quote artifact, and the prototype of any future PDF.
- **Save CSV** — the measurements as a table: one row per part with name,
  quantity placed, part dims (L/W/H), part volume, per-part weight, and total
  weight, in the display units with units named in the header. Cheap because it
  reuses the same derivation and the same save IPC as the PNG.
- **Save PNG** — the packed 3D view as rendered. Captured from the viewport
  canvas (render, then read back in the same frame — no `preserveDrawingBuffer`
  held open for the life of the app), written through the save dialog.

### 2. Warnings travel with the export

ADR-0015 made the app qualify an answer rather than refuse it. An export that
drops the qualifier un-does that decision at the moment it matters most — when
the number leaves the app and can no longer defend itself. The summary and CSV
therefore carry the open-mesh warning and the truncated-layout note whenever
the results panel shows them. Non-negotiable; a test pins it.

### 3. One small export IPC in main: save dialog + write bytes

A single `export:save` channel — main shows `dialog.showSaveDialog` (filtered
by extension, with a suggested filename derived from part + carton) and writes
the bytes; returns the path, or null on cancel. The renderer decides *what* the
bytes are; main decides *where* and performs the write. Channel names follow
storage's pattern: shared constants, exposed as methods via preload, never
string channels in components. Export failures surface next to the button that
was pressed — they are action failures, not storage trouble, so the amber
storage banner is not reused.

### 4. What stays out

- **PDF / branded report** — still deferred (ADR-0016 §4 reasoning stands).
  The copy-summary text is its prototype; iterate on that in real quotes first.
- **Bulk export of saved estimates** — export follows the screen, not the
  database. Restore a row first; that recomputes, then export.
- **Whole-window screenshot** (`webContents.capturePage`) — rejected; the
  artifact wanted is the packed view, not the app's chrome.

## Consequences

- Export lives in the renderer as pure derivation (`export/` module) plus one
  dumb IPC; the pure text/CSV builders unit-test in Node like everything else.
- **Exported numbers are never locale-grouped** (learned while implementing).
  `27,000` is two cells in a CSV and `NaN` back through `Number()`, even
  quoted. The results panel groups digits because a human reads it; a file is
  read by a spreadsheet first. The two vocabularies genuinely differ here, so
  the CSV formats the count itself rather than reusing `verdictHeadline` — the
  one place the export deliberately does NOT reuse the panel's wording.
- **The PNG needed a registration seam, not an exported renderer.** The
  viewport's three.js lifecycle lives in a closure (ADR-0008); rather than
  hoisting it, the island registers a capture function while mounted
  (`viewport/capture.ts`). Export imports that file and never three.
- CSV shape: the per-part table, a blank line, then a `Field,Value` tail
  carrying the estimate and the warnings. Parsers read a ragged tail as extra
  two-column rows, so the table stays machine-clean and nothing is dropped for
  tidiness. A per-row warning column was the alternative and is worse — a
  caveat about the whole estimate, repeated on every line, reads as a property
  of the part.
- The PNG button only makes sense when the packed view has something to show —
  it shares the results panel's notion of a current, non-stale result.
- A new preload surface means the e2e can drive export end-to-end, but the save
  dialog is native — specs exercise the IPC with a stubbed path rather than
  driving the dialog itself.
- The suggested-filename rule puts part and carton in the name, so a folder of
  exports from one dogfooding session stays legible.

## Addendum, 2026-09-03 (first two-client dogfood): §2 held for the summary and not for the CSV

§2 says a warning shown on screen travels with the export. The summary carried
`verdictCaption` from the day it was written; **the CSV never did** — its Result
cell was the bare count, and nothing else in the file hedged it. Both dogfood
clients found it independently, in different products, on the same afternoon.

The reasoning that let it happen is visible in the code and worth naming,
because it was not carelessness: the CSV deliberately restates things as field
names rather than sentences ("a CSV's wording is its field names"), and a
qualification is a sentence. That principle is right for the §7 non-fit rows,
where the facts decompose into cells. It is wrong for a hedge — a hedge split
across columns is a hedge a reader can drop one of.

So the CSV now carries `Result note`: the same sentence, in a cell, quoted by
`csvCell` like any other prose. The file-wide "no grouped digits" assertion that
had guarded the count was narrowed to the computed cell it was always about — a
spreadsheet parses a quoted sentence fine, and the broad reading of that rule
forbade the qualification from travelling at all.

One consequence worth stating plainly: **the CSV was the worst artifact to have
got this wrong in.** As the client that found it put it, a CSV is the thing most
likely to be pasted into a quote — the moment the answer can no longer defend
itself, which is the moment §2 exists for.

## Addendum 2, 2026-09-03 (same day): the binding line was the other half of the same defect

The first addendum fixed the CSV dropping the count's qualification. The same
afternoon's second run found the exports' binding line doing the same thing one
row up: "Limited by: weight" — flat, in both formats — beside an answer whose
wire form said *"whether the carton has room for one more is not established
here"*. The quote asserted what the app would not.

The cause was architectural, and it is why this addendum exists rather than a
one-line fix: the binding sentence lived in the MCP layer, so it had one
consumer, and the exports had nothing to read. `bindingReport` now lives in
`packing/verdict.ts` beside `verdictCaption` — the shared module §1 named as
the reason the exports read presentation rather than re-deriving it — and the
exports carry it: the summary with the panel's heading ("Closest limit" on a
comfortable fit, which closes roadmap item 21's carry-in) and the sentence
beneath; the CSV keeping `Limited by` for the scripts that already read it and
adding `Limit bound` (yes/no) and `Limit note`.

The rule §2 states was never wrong. It was applied to warnings and not to the
sentence that explains the answer, and the sentence is the more quotable of the
two.

## Alternatives considered

- **Export saved rows directly** — rejected above; it would create a second
  source of truth for "the answer" and break the screen-is-computed invariant.
- **`preserveDrawingBuffer: true`** — the usual canvas-capture answer, but it
  costs every frame to serve a rare action; render-then-read-back costs only
  the capture.
- **Clipboard for the image too** — considered as a fourth affordance;
  deferred until someone misses it. The file is the durable artifact.

## Addendum 3, 2026-09-04 (fourth dogfood): the CSV says which limit its bound folded in

`Upper bound` has the weight cap inside it. That is correct — it is the bound
on the answer as asked — but it means the same carton at a higher cap writes a
different number into that row, and the row's name says none of that. A reader
holding only the CSV could tell a full carton from a capped one *only* by
reading the prose sentence beside it, in the artifact this ADR exists because
people paste into quotes.

So the CSV now carries `Geometry bound` and `Space-only count` beside it, both
already on the wire since ADR-0033 and its addendum 2. Space-only equal to the
count means the carton is finished; below the geometry bound means that bound
is loose. Three numbers that disagree usefully, rather than one that cannot
say why it moved.

**Added, not renamed.** `Upper bound` keeps its name: renaming a field is a
major under ADR-0020 §3, the rows beside it make it legible, and a consumer
keying on that name keeps working. A test pins that exactly one row bears it.

**The summary is unchanged, deliberately.** It is prose, and its binding note
already says the same thing in words — "the carton itself would take 5", or
"lifting the cap does not change the count". The defect was a fields artifact
missing fields, not a document missing a sentence, and adding a line that
restates the note would make the summary longer without making it truer.

A row is omitted rather than written empty when its field is absent. The wire
answers absence with a reason; a CSV has no room for one, and an empty cell in
a quote reads as a measured zero.

## Revisit triggers

- A real request to hand a formatted document to a customer → PDF, seeded from
  whatever the copy-summary text has evolved into by then.
- Someone asks for per-placement coordinates (packing plan, not measurements)
  → a second CSV shape, decided then, not smuggled into this one.
- A third binary export appears → generalize the save IPC only if it actually
  fails to fit.
