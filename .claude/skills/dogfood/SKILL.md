---
name: dogfood
description: Run the AI-client dogfood loop for Carton Fit's MCP surface — hand the user the paste-able brief for Claude Desktop or ChatGPT (Codex) with the build's identity filled in, then take the report that comes back, check its findings against the goldens and the code, and turn the ones that survive into roadmap and ADR entries. Use when the user is about to dogfood a build through a desktop assistant, or has pasted a session report back.
---

# /dogfood — the third tier of the pyramid, driven by an assistant

ADR-0005 names dogfooding as a test tier and leaves it as a human habit. This
skill is that tier for the MCP surface, where the habit has a specific shape:
**every defect this surface has shipped was a sentence, not a number**, and each
one passed a green suite because nothing asserted what the words meant. Machines
check the mechanism; a client reading the prose is the only thing that has ever
caught the prose.

The brief lives at `doc/dogfood/mcp-session.md`. It is the artifact, not this
file — keep it current when the tool surface changes, and treat a station that
no longer matches the tools as a bug in the brief.

Two directions. Read the user's message to see which one you are in.

## A. Handing out the brief

The user is about to dogfood a build. Give them something they can paste without
editing.

1. **Name the build.** The report is worthless without it, and the brief's
   station 0 asks the client to read it back — so you need the truth to compare
   against:
   ```bash
   git log --oneline -1 && git status --short
   ```
   A build staged by `/deploy` wears the last release's number plus `+<sha>`
   (ADR-0027). If the working tree is dirty, say so now: the client will report a
   `+<sha>` that does not describe what is actually running.

2. **Check the brief still matches the surface.** Cheap and worth it — a station
   that names a tool that no longer exists teaches the client that the app is
   broken:
   ```bash
   grep -n "registerTool(" -A 1 src/main/mcp/server.ts | grep "'"
   ```
   Reconcile against the tool names the brief's stations use. Fix the brief if
   they have drifted; do not paper over it in the handoff message.

3. **Hand it over.** Point at `doc/dogfood/mcp-session.md`, say which build it
   should be run against and which client(s), and state the one thing that
   changes per session: whether `as1-oc-214.stp` is on the dogfooding machine
   (station 4's numbers assume it) and where.

4. **Say what is new since the last dogfood**, in one or two lines — the
   stations that most deserve attention this time. Do **not** tell them, or the
   client, what the expected answers are. The brief's value is that the client
   derives them; a client told the answer will find the answer.

## B. Processing a report that came back

The user has pasted a session report. Your job is to be the second reader — the
one who checks the checker.

1. **Read the whole report before verifying anything.** Findings interact; the
   third one is often the first one restated.

2. **Establish the build it describes.** Compare the reported version against
   the sha the user was dogfooding. A report against a build that is not the one
   you think it is, is a report about nothing — resolve that before going on.

3. **Verify each finding independently, against the code and the goldens.**
   `samples/goldens.ts` holds the hand-computed values; the engine is in
   `src/renderer/src/core/packing/`. Do the arithmetic yourself. Three outcomes,
   and all three get recorded:
   - **Confirmed** — the app is wrong. Reproduce it in a test *before* fixing it.
   - **Refuted** — the client is wrong. Say which of its steps was, precisely,
     and keep it in the record: a plausible wrong finding is worth remembering,
     because it will be proposed again.
   - **Right defect, wrong fix.** The most common and the most dangerous. The
     2026-09-03 session correctly found that a note claimed the carton had room
     it had never checked, and proposed detecting it with `upperBound === count`
     — which cannot work, because the weight cap is *inside* that bound. Adopting
     it would have replaced one false claim with another. **Never implement a
     reader's proposed mechanism without deriving it yourself.**

4. **Classify what survives.** A finding is one of:
   - a **wrong number** — engine defect, the rarest by far;
   - a **wrong sentence** — prose asserting what no field establishes. The
     standing rule from ADR-0029's phase-2 amendments applies: the fix is a
     field plus a sentence that reads it, never a rewording;
   - a **client/transport gap** — it works here and not there (MSIX config
     locations, schema dialects, an environment the entry did not carry). These
     are invisible to CI by construction, so they earn a regression test at
     whatever layer *can* see them, and the reason goes in the ADR;
   - a **surface gap** — the answer was right and unusable. Real, and product
     work, not a bug fix.

5. **Pin it immediately.** The user's standing rule is that a dogfood surprise
   goes into the record the same day:
   - the roadmap item it belongs to gains a finding line (`doc/roadmap.md`);
   - a decision or contract change gets an ADR amendment, not an edit
     (`doc/adr/`);
   - anything user-visible gets a `CHANGELOG.md` line in the same commit as the
     fix.

6. **Report back** in this shape:

```
DOGFOOD REPORT — <build> · <client>
  stations    <n> OK · <n> suspect · <n> wrong
  confirmed   <finding — one line each, worst first>
  refuted     <finding — and the step that was wrong>
  half-right  <the defect is real, the proposed fix is not — and why>
  pinned      <roadmap / ADR / changelog edits made>
  next        <the one thing worth doing now>
```

## What this skill will not do

It will not fix anything in the same breath as verifying it. Confirming a
finding and building its fix are separate turns with a go-ahead in between —
the user works in phased go-aheads, and a report that arrives with unrequested
code attached is harder to trust, not easier.

It also will not grade the client. A session that finds nothing on a build that
has nothing wrong is a good session; a session that manufactures a doubt to be
useful is a bad one, and the brief says so in as many words.
