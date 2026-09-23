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

## Addendum 4, 2026-09-04 (sixth dogfood): a percentage that does not say what it is a share of

`Fill: 23%`. Of what? The MCP reply answers — `utilization.basis:
"bounding-boxes"` — and the panel answers on hover. Both exports dropped it.

That is §2 ("warnings travel with the export") failing in the same shape as
addendum 1, one qualification later: the app disclosed something on the surface
that can afford a tooltip, and withheld it from the two artifacts that get
pasted into a quote, where nobody can hover and the wire is not present.

The basis is a real qualification, not pedantry. Bounding-box fill counts the
air trapped inside a part's box as consumed, because it is — no other part can
use it — but it is not volumetric fill, and on the reference plate the box is
32.95 in³ against 32.38 in³ of enclosed mesh. **The CSV prints both of those
volumes in its own rows** while its `Fill` cell silently uses one of them, which
is the version of this defect that can actually mislead someone doing arithmetic
from the file.

**Decision.** One `UTILIZATION_BASIS` in `packing/verdict.ts` carries the basis
in the three spellings its four surfaces need — a wire token (kebab, pinned by
the zod literal), a human label, and the sentence behind the panel's tooltip.
The CSV gains a `Fill basis` row *beside* `Fill`, which keeps its name (renaming
a cell a script reads is a major under ADR-0020 §3, the same rule addendum 3
followed for `Upper bound`). The summary, being prose, takes a parenthetical:
`Fill: 23% (bounding boxes)`.

The panel is unchanged apart from sourcing its tooltip from the shared
definition. A screen can qualify on hover; a quote cannot, and that asymmetry is
the reason the two exports say it in text and the panel does not need to.

Nothing but a test can catch this drifting again: both spellings are string
literals, so a hand-written `'bounding-boxes'` on the wire typechecks perfectly
while meaning something the exports no longer say. `tests/export-builders.test.ts`
asserts the row, the parenthetical, and that the token and the label remain two
spellings of one basis.

## Addendum 5, 2026-09-05 (eighth dogfood): the fill percentage names both ends now

Addendum 4 gave `Fill` a basis four hours after a reader asked "of what?". The
next reader answered the same question one level deeper: `bounding boxes` names
the **numerator**. The denominator was never stated, and it is the carton
INTERIOR — `clampUtilization(occupied, boxVolume(request.carton))` — not the
clearance-reduced space a part can actually reach. On the reference plate that is
288 in³ against 223.125 in³ usable, so "34.3% full" invited "65.7% still usable"
when the honest figure was 43%.

**The label was wrong, not the number.** The interior is the right denominator
for "how full is the box": deducting clearances would make an empty carton's fill
depend on a setting, and a fill that moves when you change a gap is worse than
one that needs a label. So `UTILIZATION_BASIS` keeps its wire `token` — a client
matches on it, and changing a matched value is a break under ADR-0020 §3 — while
its human halves name both ends: `part bounding boxes ÷ carton interior`, with
the note adding that clearances are not deducted.

The token/label invariant from addendum 4 relaxed from equality to
**containment**: the label must still contain the numerator the enum names, but
it is now deliberately more honest than the enum, and an equality check would
have forbidden exactly that.

Two runs, two layers of the same label. Worth naming the pattern: a number that
needs a qualifier usually needs the *whole* qualifier, and shipping half of one
buys a single release of quiet.

## Addendum 6, 2026-09-09 (fifteenth dogfood): a weight nobody gave is not a zero

§2 says a qualification on screen survives the export. A pack run with no
weight at all — the app's own documented route to a space-only answer — was
qualified on the wire (`weightInput.supplied: false`) and nowhere else: the
summary printed *Packed weight: 0 of 35 lb · Part weight: 0 lb per part,
entered directly* and the CSV a bare `0`, which is not a lost hedge but its
opposite, in the document built to be pasted into a quote. The plate's real
weight is 9.18 lb.

The summary now says *Packed weight: none — no part weight was given (cap
35 lb)* and *Part weight: none given*; the CSV leaves the packed-weight cell
blank, as it already leaves the max-weight cell when the cap is infinite
(blank rather than guessed); and both carry the same warning line the panel
shows, from the one function in `verdict.ts` the wire's note reads too
(ADR-0029 amendment 19). Pinned in the export builders and the collector.

## Addendum 7, 2026-09-10 (nineteenth dogfood): the filename rounded the carton

`suggestedFileName` rounded each inner dimension to an integer, so a
9 × 5.5 × 8 in carton was offered as `-9x6x8in.csv` while the body two
lines in printed 9 × 5.5 × 8 — content right, label wrong, which is the
worst way round for the artifact that outlives the session. Every carton
in the goldens and the brief is integer, which is why fourteen runs never
saw it; the reader who widened station 4's carton to 5.5 in to probe the
band test found it on the way past. The name now uses the body's own
`decimal` formatter (rule 5 of `doc/wire-rules.md`, one formatter for one
number): `9x5.5x8in`, trailing zeros trimmed so integer cartons read as
before. Which dimensions the name carries — inner or as entered — is
roadmap item 41's open call and untouched here; whichever it is, it is
unrounded.

## Addendum 8, 2026-09-14 (twenty-first dogfood): one kind, one shape in the parts table

The CSV's Length/Width/Height columns are the part's own bounding box as
modelled, which `MeasurementRow` has always said. What it did not say is
that STEP instances of one product arrive modelled at their placements
(ADR-0002 addendum), so eight nuts printed as 0.118 × 0.591 × 0.787 for two
and 0.787 × 0.591 × 0.118 for six under one header, and a reader took the
table for two nut variants. `inspect_model` learned to sort a permuted
kind's extents largest-first on the eleventh and fifteenth runs (ADR-0029
amendments 14b and 19); the parts table never did. It reads the same
`instanceAgreement` now, from the same function, so a kind whose instances
are one box turned prints one shape, and a kind whose instances genuinely
differ keeps each instance's own extents — the difference the wire's
`instancesAlike` already draws. The fill percentage on the same rows moved
to one decimal in the same commit (ADR-0029 amendment 24), the formatter
being shared.

## Addendum 9, 2026-09-14: the filename carries the carton as entered

Three surfaces named one carton three ways (readers on the 17th and 19th
runs, roadmap item 41): the summary body printed both — *Carton (inner):
9 × 4 × 8 in, entered as outer 11 × 6 × 10 in with 1 in walls* — the
receipt row the entered dimensions, and the suggested filename the inner
ones. ADR-0004 makes inner the physical truth, and the engine packs
against it; but a file name is a label for a person, and the person's
purchase order says 11 × 6 × 10. The filename now reads
`settings.boxDimsMm` — outer when outer was typed, otherwise the inner
dimensions as typed — so it agrees with the receipt row, and the body goes
on printing both with the wall thickness that relates them. Decided by the
user on 2026-09-14 with the other three wording calls (ADR-0029 amendment
25); addendum 7's rule that the dimensions are unrounded holds whichever
set the name carries.

## Addendum 10, 2026-09-23 (twenty-third dogfood): the receipt row carries the cap and the hedge, and the label names a tie

Two findings from one reader, both the §2 rule — an answer qualified on
screen stays qualified once it leaves the app — reaching a surface it had
not.

**The receipt row.** Two saved estimates over the same plate, one at a 35 lb
cap and one at 36.5 lb, read identically — *3 fit · of plate · 11×6×10 in ·
both limits* — and the second had carried *weigh one and enter it directly
to settle it* on screen. The reader told them apart only by restoring one.
The row now reads the cap from the receipt's own settings, in the unit it
was typed in (*· 36.5 lb cap*), and carries *· weigh one to settle it* when
the band reached the count or the attribution. The band flags are not in a
receipt's settings and cannot be recomputed from one — the bound needs the
parts — so `saveEstimate` writes the estimate's mesh-volume report beside
the result, an additive key in the opaque blob like the overrides
(ADR-0018 §3): no migration, and rows from before the key carry no mark,
which reads as no claim rather than as settled. A save never fails over the
mark; if the report cannot be built the key is null. One predicate for the
warning, the CSV row and the receipt row (`weighOneToSettle`, rule 5).

**The label.** At 36.5 lb both exports printed *Limited by: weight* one
line above *Both limits land on 3*. The tie predicate (`bothLimitsProven`,
addendum 7's run) reached the caption, the note and the receipt row and
not the label between them. The panel and the summary now read
`limitLabel`, which says *weight and space* on a proven tie and the one
limit otherwise. The CSV's *Limited by* cell keeps its value — a script
reads it — and the tie is its own row, *Both limits* yes/no, beside *Limit
bound*; a *Weigh one to settle* yes/no row sits beside it for the band, so
the hedge is a cell a script can test and not only the Warning prose at
the foot. Two smaller rows from the same reader: *Carton outer* and *Wall*
when the carton was entered as outer with a wall, which the summary body
has printed since §1 and the CSV never had. Not changed: the CSV's *Limited
by, space* over *Limit bound, no* on a fit where nothing bound — addendum 2
kept the cell's name for scripts and put the qualification in the row
beside it, and the summary's *Only limit* is prose the CSV cannot carry.

## Revisit triggers

- A real request to hand a formatted document to a customer → PDF, seeded from
  whatever the copy-summary text has evolved into by then.
- Someone asks for per-placement coordinates (packing plan, not measurements)
  → a second CSV shape, decided then, not smuggled into this one.
- A third binary export appears → generalize the save IPC only if it actually
  fails to fit.
