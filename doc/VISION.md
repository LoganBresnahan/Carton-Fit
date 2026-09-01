# Carton Fit — Vision

## Problem

Given a 3D model of a part (or an assembly of parts) and a shipping carton, answer the
questions packaging engineers actually ask: **does it fit, in what orientation, and how
many can I ship per box** — without doing the math by hand or mocking it up physically.

## What it is

A cross-platform desktop application (Windows-first; macOS and Linux supported) with a
normal download-and-install experience. The user drags a CAD file onto the app, enters
the carton's dimensions and constraints, and gets an answer plus a 3D visualization of
the packed carton.

### Target platform vs. development platform

**The shipping target is Windows, running natively** — a downloaded `Setup.exe`, a
Start-menu entry, a normal desktop app. That is the end goal and the definition of
done; every other platform is secondary.

Development happens in **WSL/Linux**, which is a *convenience of the workshop, not a
property of the product*. Consequences that follow, so they are never mistaken for
product decisions:

- The Windows installer is **built on Windows**, by CI (ADR-0010, ADR-0012). This
  paragraph used to say installers were cross-built from WSL; measuring that killed
  it — NSIS needs wine on Linux, and native modules cannot be cross-compiled for
  Windows at all. The prediction that `better-sqlite3` would force the move was
  right; it simply arrived early. wine was rejected rather than adopted, because it
  would have bought one build step with a known expiry date.
- The Windows app **is machine-verified**: the release workflow runs the full
  packaged e2e suite on `windows-latest` against the bytes it just built. What stays
  human-verified is the *install experience* — SmartScreen on an unsigned exe, the
  Start-menu entry, uninstall (ADR-0005). A green machine check is now evidence about
  the app on Windows, but still not about the installer's UX.
- Anything WSL-specific — display servers, GPU fallbacks, build toolchains — belongs to
  the harness, never to shipped code.

## Inputs

| Input | Details |
|---|---|
| 3D model | Drag-and-drop `.stp`/`.step` (required; may contain multiple parts). `.stl` supported as a bonus. More formats later. |
| Box dimensions | **Inside** dimensions by default; optional **wall thickness** field so outside dimensions can be entered instead. |
| Units | mm ⇄ inches toggle (weights in kg ⇄ lb correspondingly). |
| Clearances | Part-to-part and part-to-wall padding (dunnage/foam allowance). |
| Max package weight | User-settable, **default 35 lb**. |
| Part weight | Entered directly per part, **or** derived from a material/density selection using the mesh volume computed from the model. Volume is only meaningful on a **closed** mesh, so a density weight over an open one is flagged in the results rather than reported as fact. Either source is a *default*: any **kind** of part (an instanced product — `bolt` covering `bolt (2)`…) can have its weight overridden individually for mixed assemblies (ADR-0018). |

## Modes (user-selectable)

1. **Fit check** *(default)* — "Do all the parts in this file fit in this box?"
   Verdict, arrangement, total weight vs. the limit.
2. **Max quantity** — "How many copies of this part (or of the whole file treated as one
   unit) fit in this box?" Count is capped by both geometry and the weight limit,
   and the result says which constraint bound it.

## Packing quality tiers (selectable in the UI from day one)

1. **Fast** — axis-aligned bounding box, 6 orientations, grid/greedy placement plus
   extreme-point placement, whichever packs more (ADR-0022). Instant.
2. **Thorough** — minimal oriented bounding box + rotation search. Seconds.
3. **True nesting** — pack real geometry so concave parts interlock. Visible in the UI
   but disabled and marked *experimental / coming later*; not part of v1.

## Output

- Fit verdict or max count, and whether geometry or weight was the limiting factor.
- Best orientation per part, volume utilization %, total package weight.
- **Why a non-fit stopped where it did** (ADR-0022): the largest usable gap left in
  the carton, against what the smallest leftover part needs — both already
  accounting for the requested clearances, so the two figures compare directly and
  usually answer "would the next carton size up do it?". Stated as two
  measurements, never as a conclusion: a verdict of "doesn't fit" remains a best
  effort, not a proof.
- **How many could possibly fit**, beside how many were placed (ADR-0022): max
  quantity shows a rigorous upper bound — the one packing figure in the product
  that is not a heuristic, since no arrangement can exceed it. The gap between
  count and bound is the honest measure of what a better arrangement could still
  recover; equal numbers mean the answer is provably the most that fits.
- 3D view: the carton as a **wireframe** with parts placed in their computed
  positions and orientations; toggle between model view and packed view.
  (Translucent walls were specified here originally and tried in 2026-07;
  rejected. Depth already comes from the shaded parts occluding each other, and
  a wall can only tint toward the background it sits on — visible enough to help
  means opaque enough to haze the results it sits in front of. Twelve crisp
  lines mark the boundary better. The argument was first written against the
  dark theme, which was then the only one; the light theme added by ADR-0025
  weakens that half of it but does not reopen the decision, since the dense
  cartons that settled it were pixel-identical for a reason unrelated to
  colour.)
- **Presets & saved estimates**: box/constraint setups can be saved as named
  presets and reloaded; estimates the user **chooses to keep** are saved
  (file, settings, result) as a browsable history, and restoring one loads its
  settings — the result on screen is always freshly computed, never replayed.
  (Originally "every estimate is recorded" — written when estimating meant
  pressing a button. ADR-0009 removed the button, which made that literal rule
  record every debounced keystroke; ADR-0016 replaced it with explicit save.)
- **Undo/redo over the inputs** (Ctrl+Z / Ctrl+Shift+Z): session-scoped and
  in-memory; under auto-run, undoing an input is undoing the estimate
  (ADR-0016).
- **Export** (ADR-0017): the live estimate can leave the app as a
  clipboard-ready text summary, a measurements CSV (per-part dims, quantities,
  weights, in the on-screen units), and a PNG of the packed view. Warnings —
  open-mesh, truncated layout — travel with every export: an answer that is
  qualified on screen stays qualified in a quote. PDF reports are deliberately
  later; the text summary is their prototype.

## AI client surface (ADR-0029)

The app hosts an MCP stdio server so AI clients — Claude Desktop is the confirmed
one — can inspect and drive it: the AI keeps the judgment layer (materials,
handling risk, "should I"), Carton Fit supplies every number, qualified the same
way the screen qualifies it (binding constraint, upper bound, warnings). Three
tiers: inspect the engine (geometry report + stateless estimate), drive the live
app (inputs under auto-run, the packed view returned as an image, undo covering
the AI's edits like anyone's), then presets/history/export. Setup is a button in
the app that writes Claude Desktop's config — the audience is non-technical.
There is deliberately **no chat UI inside Carton Fit**: the conversation lives in
the AI client, next to the user's other context.

## Non-goals for v1

- True shape nesting (tier 3) — designed for, not implemented.
- Mixing *different* parts to optimize a single carton's contents (fit check handles the
  parts a file contains; it does not search combinations).
- Pallet/stack planning, box selection/recommendation, cost estimation — all future.
- Bulk/random-dump quantity estimation — "how many fit if I pour them in loose."
  There is no deterministic answer, only heuristics that a physical fill trial beats
  in twenty minutes (ADR-0028). If it ever ships, it is a labeled estimate range plus
  fill-trial guidance — never a computed fact.

## Technical direction

Electron + TypeScript + React with one Zustand store (lean-dependency rule: adding a
runtime dep requires an ADR), three.js viewport, `occt-import-js` (OpenCascade WASM)
for STEP parsing in a web worker, packing math in a worker, `better-sqlite3` in the
main process for configurations/history, `electron-builder` for installers (Windows
NSIS primary). Renderer code is plain web tech so the shell could move to Tauri later
without rewriting the app.
