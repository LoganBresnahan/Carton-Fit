# Carton Fit — dogfood brief for an AI client

**Paste everything below the line into a fresh Claude Desktop or ChatGPT (Codex)
conversation that has Carton Fit connected.** It works the same in both; the
first station asks which one you are. Takes about fifteen minutes.

Why this exists rather than another test file: the packaged suite already proves
the mechanism on two platforms, and it has never once caught the thing that
actually shipped wrong. Every defect this surface has produced was a *sentence* —
a note claiming something no field established — and each one passed a green
suite because nothing asserted what the words meant. So this brief spends its
time on claims, and deliberately withholds the expected numbers: an assistant
that has been told the answer will find the answer. The hand-computed values live
in `samples/goldens.ts` on the maintainer's side and come out only when the
report comes back.

### Before you paste — five things only you can answer

**This section is for the person at the keyboard, not for the assistant.**
Everything below the line is what gets pasted; this part never reaches it,
because connecting happens before the session starts and the reader inside the
session cannot see any of it. No CI runner has either client either, so the
fake CLI in `e2e/` proves only our half of a contract we wrote ourselves.

**Where the answers go: paste them into Claude Code in the same message as the
assistant's report.** A line each is plenty. Most are **one-time** — answered
once on a real machine, they close for good (they are ADR-0030's remaining
open details).

1. **Claude Desktop** — after Connect and a restart, are the Carton Fit tools
   listed? (yes / no)
2. **ChatGPT (Codex)** — same, and the restart is of the DESKTOP APP, not the
   CLI. `codex mcp list` shows the entry while ChatGPT still does not, which is
   the confusing case the panel's restart line exists for. (yes / no)
3. **Does the connect panel end up saying `connected`, or does it stay
   `outdated` however many times you press Reconnect?** One word. If the real
   CLI rewrites our arguments or environment, Reconnect becomes a button that
   never finishes the job, and this is the only way that shows.
4. **What `codex mcp add` put in your real `~/.codex`.** In a throwaway home it
   *declined* to create PATH aliases and helper binaries; in a real one it
   presumably makes them, and that is a write nobody asked for. In PowerShell:

   ```powershell
   Get-ChildItem -Force $HOME\.codex | Select-Object Name,Length,LastWriteTime
   ```

   Paste the output. Anything stamped around when you first connected is what
   the CLI created.

5. **Which `codex.exe` is there** — we pick the newest by modification time,
   which is a heuristic, and if the desktop app disagrees then `codex mcp get`
   reports the entry exists while ChatGPT never sees it. In PowerShell:

   ```powershell
   Get-ChildItem $env:LOCALAPPDATA\OpenAI\Codex\bin | Select-Object Name,LastWriteTime
   ```

   Paste the output. One directory means there is nothing to disagree about.

6. **Two things on the machine before the session, every time** (not
   one-time): a **copy of the reference file under another name** in the same
   folder — `as1-oc-214 copy.stp` is fine — and **at least one customer**
   created in the app. Station 6 reads both. The assistant cannot make either
   (no tool creates a customer, and the brief never asks the person to press
   keys), so without them that station's document and customer checks compare
   one thing with itself and prove nothing.

Skip any of these that a previous pass already answered — say "already
answered" rather than redoing them.

One thing about file access, so it does not read as a finding: the app's
tools read a model by absolute path with the app's own file access, on the
machine the files are on. A client's folder-consent surface (a connected
folder, a grant) does not gate what this app can read, and was never meant
to.

Bring the report back to the repo and run `/dogfood` with it.

---

## Carton Fit dogfood session

You are testing an application through the tools it exposes to you. **Do not
try to be reassuring.** A run that finds nothing is a run that told us nothing,
and the most valuable thing you can produce here is a disagreement with the
app's own words, backed by arithmetic you did yourself.

Two rules that decide the whole session:

1. **Derive before you call.** At every station, work out what the answer should
   be from the geometry and the weights *first*, in the open, and only then make
   the call. When the two differ, that difference is the finding — say so plainly
   rather than reconciling yourself to the tool's number.
2. **Every sentence is a claim.** These tools return prose beside their numbers.
   For each sentence that asserts something — especially a claim about what did
   **not** happen ("not the carton", "there is room left", "nothing bound") —
   name the field in the same reply that establishes it. **A sentence with no
   field behind it is a finding, even when it happens to be true.**

Work through the stations in order. Keep a running note; the report format is at
the end. Do not stop at the first problem — finish the itinerary and report
everything together.

stp file here: C:\Users\tarsier\Documents\carton fit files

### Station 0 — identity

Call `get_app_state`.

Record: the app version exactly as reported (a build between releases carries a
`+<sha>` suffix — that suffix is what makes this report actionable), the number
of tools you can see, and their names. Then state, from your own side: which
client you are, its version, and your operating system.

If the version has no `+<sha>` and is not a tagged release, say so — it means the
build cannot be identified, which is itself worth reporting.

**Then load the model first — the document starts clean.** The unit part and
the per-kind weight overrides belong to the loaded file, and `load_model`
clears them and reports what it cleared (`cleared`), so nothing from an earlier
session can reach your station-4 numbers through them. What the app does keep
between sessions is the global carton — dimensions, clearances, the cap, the
weight mode — and `inputs.provenance` tells you which groups this launch has
written (`setThisSession`), which of those changed value
(`changedThisSession`), and whether the rest came from an earlier session or
the defaults. Set what your answer depends on rather than trusting what you
find, and say what provenance reported before and after you did: a group you
wrote to the value it already had belongs in the first list and not the
second, and that is the field showing you did the work.

### Station 1 — inspect a model

You need a CAD file on this machine. The reference file for this brief is
**`as1-oc-214.stp`** (an assembly of plates, brackets, bolts, nuts and a rod); if
you have it, use it and say so. Anything else works, but station 4's numbers are
written for that file — note the substitution if you make one.

Call `inspect_model` on it.

Check and report:
- Does every dimension and weight arrive with its **unit named**, or are there
  bare numbers you had to guess about?
- Are the part kinds and counts plausible against the file's own name?
- Is there an open-mesh warning, and if so does it say what it means for weight?
- Each kind says whether its faces curve and how coarse the facets are. Before
  you read those fields, write down which kinds *you* expect to be planar from
  the product's description — then compare. If one surprises you, say why the
  app might be right, and what a curved face does to a mesh volume.
- Is anything in the reply a number you could not act on without asking a
  follow-up question?

### Station 2 — a fit-check with no weight at all

Set up a fit-check in a carton you choose that comfortably holds everything.
Report: does the answer distinguish *space* from *weight* honestly when no weight
was supplied — or does it imply a weight conclusion it has no input for?

Quote the binding sentence verbatim and name the field behind it. Then export
this space-only answer both ways and say whether the exports still say no
weight was given, or print a weight.

### Station 3 — the same pack, with a real material

Repeat station 2 with a steel density of 7.85 g/cm³ and a 35 lb cap, everything
else unchanged. You should still be far under the cap.

This station exists because it once reported *"The weight cap stopped this"* on a
pack that finished at 38% of the cap with every part placed.

Report:
- Does anything in the reply claim a limit stopped a pack that nothing stopped?
- Is the qualification structural (a field you can read) or only prose?
- Do the two runs — no weight, then steel — disagree in any way you cannot
  explain from the inputs?
- The steel run's weights came from mesh volumes. Does the reply say how exact
  those volumes are, per kind, and does it say whether that matters *here* —
  as a field, not a sentence — or does it warn on every answer regardless?

### Station 4 — where both limits land on the same number

**The station this brief was written around.** Set up, exactly:

- carton **11 × 6 × 10 in, measured outer, 1 in walls**
- clearances **0.25 in** (between parts and wall)
- weight cap **35 lb**, steel density **7.85 g/cm³**
- mode **max-quantity**, tier **thorough**
- unit part: **the plate**

Before you call anything, do the geometry yourself: work out how many plates the
usable interior admits, in which orientation, and separately how many the cap
admits. Write both numbers down, and say whether they agree.

Then run it, and audit the answer against your own arithmetic:
- Does the count match what you derived? If not, whose number is wrong?
- Does the report claim anything about the constraint it did **not** name — and
  if so, which field establishes it?
- If both limits genuinely land on the same count, does the answer say so, or
  does it name one and describe the other as having room to spare?

Run this station **both ways** if your client offers both: through the running
app (`set_inputs` + `get_estimate`) and through the stateless `estimate` tool
with the same inputs. The two are supposed to produce the same answer *and the
same wording* — a difference between them is a finding on its own, because it
reads to a user as the app disagreeing with itself. Say which path each number
came from.

Then raise the cap to **100 lb** and rerun. The answer should change hands: the
carton now stops it well before the weight does. Check that the sentence changes
with it, and that the claim about the cap having room to spare is one the numbers
support.

Then one more cap, **36.5 lb**, and look at what the reply says about the
plate's weight. Work out for yourself: the plate's weight is density × a mesh
volume, and the reply tells you how far that volume can be off. Does that band
reach the cap at 36.5 lb? At 35? Remember the count has two limits, and a
lighter plate only helps if the carton would take another one. Does the
reply's own field agree with your arithmetic each time, and is the sentence
there exactly when the field says it should be?

### Station 5 — driving the live app

Everything so far could have been answered without a window. This station checks
that the app a person is looking at and the app you are talking to are the same
app.

1. `load_model` the file, then `set_inputs` changing **only** the weight cap.
   Everything else should survive untouched — verify that in the reply rather
   than assuming it.
2. `capture_view` and actually look at the image. Does the picture agree with the
   count you were told? Can you see the arrangement, or is it unreadable?
   **If your client cannot display the image at all, that is the finding —
   report it.**
3. `set_part_weight` on one kind by hand, and check the estimate that comes back
   used your number rather than the density it had been deriving. Then clear
   it: `weight: null`, or `clear: true` if your client cannot send a null —
   say which one you needed, because the first client that could not send
   one ended its session with an override it could only remove by
   reloading the file.

**Do not ask the person to press Ctrl+Z**, or anything else at the keyboard.
An earlier version of this station did, and both first-run sessions stalled on
it: one asked, then invalidated its own test by making more edits while waiting;
the other never got an answer and correctly refused to report a result it had
not observed. The undo property — one AI edit, one undo step — is pinned by
machine tests that can press the key themselves (ADR-0016, ADR-0029). Asking a
human to watch a field and narrate it back is friction that buys nothing, and it
interrupts the person whose machine you are already borrowing.

### Station 6 — presets, history, exports

`list_presets`, `save_preset`, `apply_preset`, `list_saved_estimates`,
`save_estimate`, `restore_estimate`, `export_estimate` (both `csv` and
`summary`), `list_customers`, `set_customer`.

Check and report:
- Does an export carry every warning the estimate carried, or does a
  qualification get lost on the way out? An answer that is hedged on screen and
  flat in a quote is the failure mode here.
- Is anything written to disk that you were not told about?
- Saved estimates belong to the loaded document. After `save_estimate`, call
  `list_saved_estimates` with no arguments and again with `scope: "all"`, and
  say what each reply's `scope` field claimed and whether the rows matched the
  claim. Then call `get_app_state` and check `file.savedEstimates` against what
  you saved. A list that shows another part's receipts under this one, or a
  count that disagrees with the list, is the failure mode here.
- Same bytes, another name. If a copy of the reference file under a
  different name is in the same folder, `load_model` it after your
  `save_estimate`. A document is its content, not its name (ADR-0034): the
  same kinds and counts as station 1, `file.savedEstimates` exactly what the
  original showed after your save, and the receipts you saved listed under
  the copy with no question asked. It is still a load, so `cleared` reports
  the unit part and overrides it threw away like any other — that is not the
  finding. Say whether the rows named the file you loaded or the one they
  were saved under; both are honest, and which one you saw is the finding.
  If there is no copy, say so and skip this; do not make one yourself unless
  you already have a way to copy a file on that machine.
- Call `list_customers` and say who the app is working for. If there is more
  than one customer, `set_customer` to another one and back, and say what
  changed in both lists and what did not change in the estimate — nothing in
  a count depends on the customer. Coming back is `id: null`, or
  `house: true` if your client cannot send a null — do not leave the app
  working for a customer you switched to. Do not try to create, rename or
  delete one; you should find no way to do any of the three, and the reply
  should say why and where a person does them.
- Receipts and presets also carry a customer, and every list has a second
  axis for it (`customer: "active"`, the default, is the app's current
  customer plus house; `"all"` is everyone). `scope: "all"` widens the
  documents, not the customers. If a row you expect is missing, say which
  axis hid it and whether the reply's own `scope`, `customer` and
  `withheldByCustomer` fields told you before you worked it out.
- Try to delete a preset or a saved estimate from where you are. You should
  find no way to do it — the person at the keyboard has Delete for both, you
  do not. Report what you find, and whether the surface made the absence
  understandable.

### Station 7 — the claims audit

Go back over every reply from stations 1–6 and build one table:

| The sentence, quoted | What it asserts | The field behind it | Verdict |

One row per sentence that makes a claim. The verdict is **backed** (a field
establishes it), **unbacked** (nothing does — a finding, true or not), or
**contradicted** (the fields say otherwise — a defect).

Then answer, in your own words: **if an engineer acted on this session's numbers
and was later asked to justify them, which sentence would embarrass them?**

### The report

Reply with exactly this shape, so reports from different clients and builds can
be compared:

```
CARTON FIT DOGFOOD — <date>
build        <version exactly as reported, +sha included>
client       <which assistant, version, OS>
transport    <how you reach it: tool count, anything odd about the connection>
file         <CAD file used, and whether it was as1-oc-214.stp>

station 0  OK | SUSPECT | WRONG — <one line>
station 1  …
station 2  …
station 3  …
station 4  …
station 5  …
station 6  …

CLAIMS AUDIT
<the table>

FINDINGS
<numbered, worst first. For each: what you expected and why, what you got,
 and the arithmetic. A finding without your own derivation is an opinion.>

WOULD I STAND BEHIND THESE NUMBERS
<straight answer, and what would have to change>
```

Two closing instructions. **Do not soften a finding to be agreeable** — the
useful reports so far have all been ones that told the maintainer their app was
wrong. And **do not invent a finding to be useful**: "station 4 matched my
arithmetic exactly" is a real result, and saying so plainly is worth more than a
manufactured doubt.
