# ADR-0032: An AI client reading the prose is a test tier, and it gets a written brief

Date: 2026-09-03

Status: Accepted 2026-09-03

Extends ADR-0005 (test pyramid) and ADR-0029 (the MCP surface). Supersedes
nothing: ADR-0005's three tiers stand exactly as written, and this adds the
instrument its third tier was missing for a surface that did not exist when it
was accepted.

## Context

ADR-0005 named three tiers — vitest for the math, Playwright-Electron against
the packaged bytes, and **dogfooding**, "every deploy ends with a human running
a real part through the new build". That was right for an app whose entire
output is a screen a person is looking at. ADR-0029 then gave the app a second
audience, and the two are not tested by the same act: a person reads the panel,
which sits beside the numbers it describes, while an assistant reads a JSON
reply and repeats its sentences to an engineer who never sees the app at all.

The record since that surface shipped is unambiguous, and it is the reason for
this ADR:

| Finding | Caught by | The suite at the time |
| --- | --- | --- |
| Store Claude Desktop's config is virtualised (MSIX) | first Windows dogfood | green |
| Tool calls rejected — SDK stamps `$schema` draft-07 | first working session | green (our own client tolerates it) |
| "The weight cap stopped this" on a pack at 38% of the cap | the client, unprompted | green, 805 tests |
| "not the carton — there is room left" on a carton with no room | the client, unprompted | green, 845 tests |

Four findings, and **not one of them was a wrong number**. Three were sentences
and one was a two-party disagreement about a schema dialect. Every one passed a
suite that was green at the time, and they passed for the same structural
reason: a test asserts what a value *is*, and none of these were about a value.
A note claiming the carton had room was never compared against anything,
because nothing in the codebase knew that the sentence was making a claim.

ADR-0029's phase-2 amendment already named the role — *the AI as an adversarial
reader of the engine's prose* — and left it as an observation. Twice more it
produced findings nothing else could. An observation that keeps paying is a
practice, and a practice that lives only in someone's memory of how the last
session went is one bad week from being lost.

The 2026-09-03 session also showed the practice's failure mode, which any
adoption has to survive. The reader correctly found that a note asserted room
the engine had never checked, and proposed detecting it with
`upperBound === count`. That cannot work: the rigorous bound is
`min(volumetric, per-axis, weight)` (ADR-0022 §7), so on any weight-capped run
that equality holds regardless of how empty the carton is. Implementing the
proposal as given would have replaced a false claim with a false claim, and
done it with more confidence. **The reader is a good detector and an unreliable
mechanic**, and the practice must encode that difference or it will import a
defect the suite cannot see either.

## Decision

**1. The assistant reading the prose is tier 3's instrument for the MCP
surface, and it runs from a written brief** — `doc/dogfood/mcp-session.md`,
paste-able into Claude Desktop or ChatGPT (Codex) unedited. One brief for both
clients, with a client-declared header, rather than two that drift.

**2. The brief withholds the expected answers.** Its stations say *derive it,
then call, then compare*; the hand-computed values stay in `samples/goldens.ts`
on the maintainer's side. This is the whole mechanism — a reader given the
answer confirms the answer, and confirmation is precisely the thing four green
suites already provided.

**3. Every returned sentence is a claim, and the brief ends by auditing them.**
Its final station tables each asserting sentence against the field that
establishes it, with three verdicts: backed, unbacked, contradicted. **Unbacked
is a finding even when the sentence is true** — that is the rule ADR-0029's
amendment 2 arrived at from the other direction, and stating it in the brief is
what makes the tier reproducible instead of lucky.

**4. Findings are verified before they are implemented, and the reader's
proposed fix is never adopted on its authority.** `/dogfood` (skill B) derives
every mechanism itself and records three outcomes — confirmed, refuted, and
*right defect, wrong fix* — because the third is both the most common and the
most dangerous, and burying it would lose the only warning the next session gets.

**5. A confirmed prose defect is fixed with a field, never a rewording.** Rule 3
of ADR-0029's phase-2 addendum, restated here because it is what stops this tier
from generating an endless stream of copy edits: if a sentence cannot be backed
by something a client can read, the sentence does not ship.

**6. The brief is versioned with the surface it tests.** A station naming a tool
that no longer exists is a bug in the brief, and `/dogfood` checks the stations
against `server.ts`'s registrations before handing it out.

## Consequences

- **The tier is repeatable and comparable.** Fixed inputs and a fixed report
  shape mean two clients on one build, or one client across two builds, produce
  diffable reports. That is new; the four findings above arrived as prose in
  chat and were reconstructed by hand afterwards.
- **It costs about fifteen minutes of a person's time per client per deploy**,
  and it needs a real desktop client — so it cannot join CI, ever. That is not a
  gap to be closed later: the thing being tested is the disagreement between two
  independent readers, and a second copy of our own code is not a second reader.
- **False findings will arrive**, and the practice budgets for them rather than
  treating them as failures. Refutations are recorded with the step that was
  wrong, because a plausible wrong finding will be proposed again by the next
  session, possibly in a different client.
- **It changes what a green suite means.** The suite proves the mechanism; it has
  never once proven the prose. Anyone reading a green CI run on this surface
  should treat the sentences as untested until a session says otherwise.
- **`/deploy` gains a real handoff.** It already promised "a dogfood script" and
  handed over an ad-hoc paragraph; it now points at the brief.

## Addendum, 2026-09-04 (after the fourth run): where the handoff lives

Offered on 2026-09-03 and left undecided: should the handoff live only in
`/deploy`, leaving `/dogfood` to process reports? The fourth run decided it, by
producing the failure the ambiguity predicts.

`/deploy`'s handoff carried the connect steps under a heading that began *when
the build touched the connect panel*. The build being staged had touched it
only in documentation, so the steps were not read out — and ADR-0030's
remaining open details, all of which can only be answered by a person watching
a client connect, went unasked for the fourth pass running. The condition was
sound and the placement was wrong: **the observations are not about the build,
they are about the machine**, and most are one-time.

**Decision: the brief owns every instruction the dogfooder follows; both skills
hand it out.**

- Everything the dogfooder does lives in `doc/dogfood/mcp-session.md`,
  including a "Before you paste" section for connecting — which the reader
  inside the session cannot see, because it happens before the session starts.
- `/deploy` and `/dogfood` both hand the brief over, because a pass does not
  always follow a deploy: re-running against an installed build needs no new
  bytes. Neither restates it. A handoff is a pointer, the build's `+<sha>`, and
  one line on what is new.
- The reason is the same one this ADR was written for: two copies of an
  instruction drift, and the copy that drifts is the one nobody ran.

The station-0 half of this was already right and is worth naming as the
counter-example: the brief tells the reader to reset inherited state, and the
fourth run's reader did exactly that and reported it. An instruction in the
brief gets followed; an instruction in a skill gets followed only if the skill
reaches for it.

## Alternatives considered

- **Assert the sentences in vitest** — rejected as a substitute, adopted as a
  consequence. Pinning a note's exact wording tests the wording, and every one
  of these defects was a *sentence that was internally consistent and wrong
  about the world*. What the suite can hold is the claim once it has a field
  behind it, which is exactly what happens after a finding, not before it.
- **A scripted client in CI (our own SDK client driving the tools)** — rejected.
  It is the trap the draft-07 finding already sprang: our client tolerated the
  dialect our real clients rejected, and the suite was green because it was
  playing both parties. A scripted reader cannot be surprised by our own prose,
  because it has no engineer to answer to.
- **Two briefs, one per client** — rejected. The clients differ in transport and
  in image support, which is four sentences of conditional text, against the
  certainty that two documents diverge and the older one starts teaching a
  client that the app is broken.
- **Publish the goldens in the brief so the client can self-grade** — rejected,
  and it is the tempting one. It would produce cleaner reports and worthless
  ones: the reader's independence *is* the instrument.
- **Leave it as a habit** — rejected. Two of the four findings came from a
  session that happened to go well; the practice was one context window from
  being forgotten, and the brief costs a file.

## Revisit triggers

- **ADR-0034 ships** → station 0's "reset what you did not set" paragraph is
  rewritten to "load the model first — the document starts clean," and station
  6 gains the scoped `list_saved_estimates`. Two runs reported inherited state
  as a finding; the fix is in the app, and the brief must stop describing the
  workaround once it is.

- **Three consecutive sessions find nothing.** Either the surface has stabilised
  and the brief should shrink to the claims audit alone, or the stations have
  gone stale and stopped provoking — check which before dropping the cadence.
- **A finding arrives that the brief's stations could not have produced.** Add
  the station; that is the brief learning, and it is the main way it improves.
- **A third client is connected** (ADR-0030's recipe). Confirm one brief still
  covers all three, or split at that point rather than pre-emptively.
- **A prose defect ships that a session saw and did not report.** That is the
  tier failing at its one job, and the brief's instructions — not the reader —
  are the first thing to examine.
- If the MCP surface is ever retired or demoted, this ADR goes with it.
