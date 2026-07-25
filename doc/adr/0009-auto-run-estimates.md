# ADR-0009: The estimate follows the inputs (no compute button)

Date: 2026-07-25
Status: Accepted

## Context

Roadmap item 4 wired the packing engines to the UI, which forced a question the earlier
ADRs left open: **when does a pack run?** Every input that defines an estimate — the
carton, clearances, weights, mode, quality tier, which part max-quantity replicates —
lives in the store and can change at any moment, and the engines run in a worker whose
latency ranges from ~1 ms (fast tier, one part) to hundreds of ms (thorough tier,
quickhull over a dense mesh).

Two shapes were available: an explicit **Compute** button, or a **live** estimate that
re-runs whenever an input changes.

The app's value is answering "does it fit / how many" while the user is still *deciding*
the carton. Trying 12×12×12 against 14×10×10 is the actual work, and a button puts a
click between every trial and its answer.

## Decision

- **Estimates run automatically** whenever the imported parts, the packing settings, or
  the max-quantity unit selection change. There is no compute button.
- The trigger is a **store subscription installed at the renderer entry**, not in a
  component — the estimate is a property of the data, not of anything being mounted.
- Changes are **debounced (180 ms)**: a number field emits a change per keystroke, so
  typing "120" would otherwise dispatch three packs whose first two results are
  discarded. The request is built when the timer fires, from the newest inputs, so
  superseded intermediates cost nothing — not even a mesh-volume pass.
- In-flight packs are **superseded, never cancelled**: the pipeline stamps each job with
  a monotonic id and ignores any response that is not the latest (the same guard the
  import pipeline uses for re-drops). A worker cannot be interrupted mid-solve, so the
  stale result is simply dropped on arrival.
- While a pack is in flight the **previous estimate stays on screen, dimmed**, rather
  than the panel blanking. A live-updating answer that flickers to empty on every
  keystroke is harder to read than a slightly stale one.
- The pipeline hands the **dispatched request back paired with its result**. The packed
  3D view needs the carton those placements sit in; reading it from live settings would
  draw a box that disagrees with the placements during the debounce window.

## Consequences

- The carton fields, unit toggle, mode/tier selectors and part picker all become live
  controls: the answer moves as you type, which is what makes the app feel like a
  calculator rather than a form.
- The results panel must render three states (idle, in-flight, settled) and the store
  must model them, which is why the pack slice carries `packStatus` alongside the result.
- Worker churn is bounded by the debounce plus the id guard, not by user discipline.
- Pairing the request with the result also gives estimate history (roadmap item 7) a
  self-contained record — file, inputs, and answer — without pushing presentation state
  onto the engine contract in `core/packing/types.ts`.
- A tier slow enough to lag behind typing would make this feel worse than a button. The
  thorough tier is currently tens of ms on real assemblies, so this is not yet a problem.

## Alternatives considered

- **Explicit Compute button** — trivially predictable and zero wasted work, but it puts a
  click between every carton trial and its answer, which is the app's core loop. Rejected
  for v1; it is the obvious fallback if the revisit triggers fire.
- **Run on blur / on Enter** — fewer dispatches than debounce, but it makes the answer
  lag behind the visible input in a way users read as a bug ("I changed it and nothing
  happened"). Rejected.
- **Cancel in-flight packs by terminating the worker** — genuinely stops wasted compute,
  but throws away the warm worker and its JIT state on every keystroke, and the id guard
  already prevents a stale result from ever being *shown*. Rejected as a worse trade.

## Revisit triggers

- Thorough or a future nesting tier takes long enough on real parts that the estimate
  visibly trails typing → add an explicit compute button, or auto-run only the fast tier
  and make expensive tiers on-demand.
- Users report the answer changing "too fast to read" while editing → lengthen the
  debounce or settle only on blur.
- Worker CPU becomes a battery/thermal complaint on laptops → widen the debounce, or
  skip re-running when the inputs are numerically unchanged.
