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
- The PNG button only makes sense when the packed view has something to show —
  it shares the results panel's notion of a current, non-stale result.
- A new preload surface means the e2e can drive export end-to-end, but the save
  dialog is native — specs exercise the IPC with a stubbed path rather than
  driving the dialog itself.
- The suggested-filename rule puts part and carton in the name, so a folder of
  exports from one dogfooding session stays legible.

## Alternatives considered

- **Export saved rows directly** — rejected above; it would create a second
  source of truth for "the answer" and break the screen-is-computed invariant.
- **`preserveDrawingBuffer: true`** — the usual canvas-capture answer, but it
  costs every frame to serve a rare action; render-then-read-back costs only
  the capture.
- **Clipboard for the image too** — considered as a fourth affordance;
  deferred until someone misses it. The file is the durable artifact.

## Revisit triggers

- A real request to hand a formatted document to a customer → PDF, seeded from
  whatever the copy-summary text has evolved into by then.
- Someone asks for per-placement coordinates (packing plan, not measurements)
  → a second CSV shape, decided then, not smuggled into this one.
- A third binary export appears → generalize the save IPC only if it actually
  fails to fit.
