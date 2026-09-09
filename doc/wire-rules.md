# Wire rules — what fourteen dogfood runs taught about the MCP surface

The rules a new tool, a new field, or a new sentence on the MCP surface has
to pass before it ships. Each one was learned by a reader with a calculator
finding a sentence no test asserted; the run and the amendment that taught it
are named so the reasoning can be read in full. **Fourteen runs found one
wrong number** (rule 6). Everything else was a sentence.

Read this before writing the output schema of a tool. Read it again before
writing the prose that reads the schema. The order matters — see rule 1.

## The rules

1. **Every qualification is a field plus a sentence that reads it. Never a
   rewording.** A sentence that hedges ("the carton has room", "this answer
   depends on orientation") is a claim; a claim needs a field that could be
   false. The fix for a wrong sentence is always a field first and prose
   second. Write the structured fields of a reply before the note that reads
   them, never after. *(ADR-0029 amendments 1, 2, 7; ADR-0033.)*

2. **A constant cannot qualify the sentence beside it.** `persisted: true`,
   `notTracked: ["unitPart"]`, a `basis` that never changes — a field with one
   possible value carries no information and a reader learns nothing from
   it. If the honest field is a constant, the answer is a sentence in the
   description and nothing on the wire. Proposed six times for `set_inputs`;
   refuted six times. *(Amendment 12; ADR-0034 amendment 1; roadmap items
   36, 37.)*

3. **A description does not reach a reader who is reading values.** Five
   readers on five runs took a well-described field for what its name and
   value suggested. When a value can be misread, change the value or its
   name (`source` → `mode`), or add the field that disambiguates
   (`countedWeightFrom`). A description is the cheapest fix and it has never
   been the last one. *(ADR-0020 amendment; amendments 11, 13; items 35, 36.)*

4. **An input is not a claim about the answer.** `weightMode` says what was
   set; `countedWeightFrom` says where the counted pounds came from.
   `constraint` names the closest limit; `bound` says whether it stopped
   anything. Keep the two in separate fields with names that say which is
   which, and never let a note draw a conclusion from an input. *(Amendments
   1, 11; ADR-0020.)*

5. **One function per claim, read by every surface.** The panel, both
   exports and the wire must say the same thing because they call the same
   function: `utilizationBasis`, `upperBoundLabel`, `verdictCaption`,
   `mixedInstanceKinds`, `bindingReport`. Two implementations of one claim
   drift, and the drift reads as one surface qualifying an answer another
   does not. The summary export's weight line broke this rule for a month by
   reading settings instead of the rule. *(Amendments 10, 14, 18; ADR-0017
   addenda.)*

6. **A tolerance answers one question.** The engine's `EPS` decides whether
   one box sits inside another. "Are these two instances the same part the
   same way up" is a different question with a different scale, and
   borrowing the first tolerance for it flagged a bolt as mixed on seven
   runs over 7.6 millionths of a millimetre. Name every tolerance for the
   question it answers. *(Amendment 18; `ALIKE_TOLERANCE_MM`.)*

7. **The wire is additive. Nothing is renamed, nothing is removed.** A field
   a script reads is a contract; renaming it is a major under ADR-0020 §3.
   When a name turns out wrong, add the sibling that is right and leave the
   old one in place with a description that points across. The CSV keeps
   *Upper bound* and gained *Geometry bound* beside it. *(ADR-0020;
   ADR-0017 addendum 3; amendment 14.)*

8. **A filtered list says what it filtered and how much.** Two axes on a list
   (document scope, customer) stay independent, each gets a label in the
   reply, and the reply carries a count of what the filter hid. Two readers
   on two runs proved that the label alone reads as "all" when the rows are
   the same. *(ADR-0035 §4 and amendment 1; amendment 17.)*

9. **Provenance is two questions.** "Did the value change since launch" and
   "did a hand write it since launch" are answered by two lists, and a group
   in the second and not the first was written to the value it already had.
   "Session" means the app's launch, not the client's connection. Undo and
   redo are not writes. Things that cannot be inherited (the unit part,
   overrides — cleared on every load) are not in the lists, and `cleared`
   on `load_model` is their provenance. *(ADR-0034 amendments 1, 2;
   amendments 15, 16.)*

10. **No delete on the wire, and say so where the write happens.** Everything
    else a client does is undoable; a delete is not, and a reader's guess is
    not the act to spend it on. `list_*` and `save_*` both say the row can
    only be removed by the person at the window. *(Amendment 8; ADR-0034 §4.)*

11. **Never ask the person at the keyboard.** A station or a tool that needs
    a human to press a key stalls every client that tries it. The undo
    property is pinned by machine tests that can press the key themselves.
    *(ADR-0032; the brief's station 5.)*

12. **A new tool ships with its station.** The brief at
    `doc/dogfood/mcp-session.md` is the artifact; a station that names a tool
    that no longer exists, or a tool with no station, teaches the reader the
    app is broken. Same commit. *(ADR-0032 addendum; CLAUDE.md.)*

13. **The golden fixtures are the third consumer.** Every scenario in
    `samples/goldens.ts` runs through the wire as well as the engine and the
    e2e, in inches, so a missed conversion cannot pass. A new tool that
    answers a number joins that test. *(ADR-0005; `tests/mcp-goldens.test.ts`.)*

## Before a new tool: the claims table

The 13th and 14th readers each built this table in an hour. Build it first.

| The sentence the tool can say | What it asserts | The field behind it |
| --- | --- | --- |

One row per sentence, including every variant of a note. A row with an empty
third column is a rule 1 violation and the tool is not ready. A row whose
field has one possible value is a rule 2 violation. The table goes in the
tool's ADR (or the amendment that adds the tool), and the brief's new station
asks the reader to rebuild it without being shown it.

## Standing refutations

Proposals that keep arriving and stay refused, so the next one is recognised
in a minute:

- **`persisted: true` / `persisted: [groups]` on `set_inputs`.** An echo of
  the request (rule 2). `setThisSession` and `unchangedAre` are the fields.
  If the underlying decision — wire writes persist so "new part, same box"
  works — is to move, it moves as an amendment to ADR-0034 §2, not as a
  marker.
- **The unit part or overrides in provenance.** They cannot be inherited, so
  the honest field is a constant (rule 2), and adding them makes
  `unchangedAre: "earlier-session"` false for a null unit part.
- **Nulling or renaming `binding.constraint` when nothing bound.** It names
  the closest limit; `bound` says whether it bound. Rejected twice
  (amendment 1).
- **Detecting "the carton has room" with `upperBound === count`.** The weight
  cap is inside `upperBound`; the constructive answer is `spaceOnlyCount`
  with `evidence: "arrangement"` (ADR-0033).
- **`scope: "all"` widening the customer axis.** The axes stay independent
  (rule 8); the count is the disclosure.
- **A `presetSavedWithOverrides` comparison.** A preset does not record
  overrides at all (ADR-0034 §2); the seam is the preset-vs-receipt mental
  model, pinned under roadmap item 33.

## Where the full record is

- `doc/adr/0029-expose-the-packing-engine-to-ai-clients.md` — the surface
  and its eighteen amendments, one per run that changed it.
- `doc/adr/0032-the-assistant-is-a-test-tier.md` — why a reader is a test
  tier and how the loop runs.
- `doc/roadmap.md` items 24, 25, 33–37 — every finding, confirmed or refuted,
  with the step that was wrong.
- `.claude/skills/dogfood/SKILL.md` — how a report is verified and pinned.
