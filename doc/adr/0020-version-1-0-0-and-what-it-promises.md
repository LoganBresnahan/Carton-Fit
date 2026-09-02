# ADR-0020: 1.0.0, and what the version number promises

Date: 2026-07-25
Status: Accepted
Relates to: ADR-0003 (heuristic tiers), ADR-0007 (storage schema),
ADR-0012 (draft releases), ADR-0014 (window state file),
ADR-0017 (export formats), ADR-0019 (the rename)

## Context

0.1.0 was tagged as a build number, not a claim: its release was never
published, and every 0.x version in semver explicitly means "anything may
change". The app now answers the whole question it was built for — import,
both modes, both tiers, weight as a hard constraint, presets, saved estimates,
undo, export — and is about to be installed and used on real parts.

Handing someone an installer converts the version from a label into a promise.
The promise needs stating before it is made, because the thing 1.0.0 protects
here is **not an API** — nothing is published as a library — it is the data on
the user's disk and the answers they have already written into quotes.

The rename (ADR-0019) is also the last good moment to do this: it already
orphaned pre-rename data deliberately, so 1.0.0 starts from a clean line rather
than inheriting a compatibility debt nobody agreed to.

## Decision

Ship **1.0.0**, and define the versioned surface as the things a user can
depend on:

1. **On-disk data.** The SQLite schema (presets, saved estimates), the window
   state JSON (ADR-0014, which carries the theme too since ADR-0025), and the
   localStorage keys — `carton-fit:settings`, and `carton-fit:layout` for the
   control-panel width (ADR-0026). Each key is a surface in its own right, and
   the split is deliberate: what keeps a preset from restoring someone else's
   panel width is that the two live apart, so a new preference gets its own key
   rather than a field inside `settings`. Within 1.x, a newer build must open
   data written by an older one — that is what the `PRAGMA user_version`
   migrations in ADR-0007 are for. Data written by a
   *newer* build is refused rather than quarantined, which is already the
   behaviour and stays that way.
2. **User-visible behaviour.** Modes, tiers, units, the meaning of the binding
   constraint, and the fact that a qualified answer stays qualified when
   exported (ADR-0015, ADR-0017).
3. **Export formats.** The CSV's columns and the summary's phrasing are read by
   people and pasted into quotes. Adding a column is a minor; removing or
   reordering one is a major.
4. **The MCP tool surface** *(added 2026-09-01, ADR-0029 phase 4)*. Tool names,
   their input and output schemas, and the meaning of the qualifications every
   answer carries. Adding a tool or an optional field is a minor; removing a
   tool, renaming one, requiring a field that used to be optional, or dropping a
   qualification from an output schema is a major — the SDK validates structured
   output against those schemas, so a dropped qualification is not a smaller
   answer, it is a failed call for every client that has one. This is one number
   with the app's, not a second version line: a client asks the server which
   build it is talking to and gets the same answer the installer's filename
   gives, which is what makes "which version answered?" a question with one
   answer.

Breaking any of those is **2.0.0**.

This says what a *released* number promises. What an unreleased build's number
promises — nothing, since `package.json` is not bumped until release — is
**ADR-0027**: `/deploy` names such a build after its sha so it cannot be
mistaken for the release whose number it is still carrying. *(2026-09-01: the
MCP handshake applies the same rule for the same reason — a server introducing
itself as `1.2.0+4f9f2f8` is telling a client that this build is not that
release. The suffix is composed at build time and lives only on that wire;
`package.json` and `app.getVersion()` stay clean, because `version.ts` rejects a
suffix and a stamped one would silence the update check.)*

**Explicitly NOT covered — a changed count is not a breaking change.** Packing
is heuristic by design (ADR-0003): *Fast* reports a bound, not a proof, and
*Thorough* searches harder. A future engine that fits 344 where 343 fit before
is the product working, not a compatibility break. This is the one exclusion
worth writing down, because it is the one a user could most reasonably read the
other way — so the results panel keeps stating its epistemic direction, and the
changelog calls out any release where counts move.

Internal TypeScript modules under `src/` carry no promise at all. They are not
published, and `core/` staying freely refactorable is what ADR-0003's
purity rule buys.

## Consequences

- The version string lives in **three** places that must agree: `package.json`,
  the `CHANGELOG.md` heading, and the README banner. CI enforces only the first
  — `release.yml`'s gate fails a tag that does not match `package.json` — so
  the other two are checked by eye at release time.
- Tagging `v1.0.0` builds and attaches artifacts to a **draft** release.
  Publishing stays a human act after dogfooding (ADR-0012); this ADR does not
  change that.
- The stale `v0.1.0` draft release, still titled under the old product name and
  pointing at a pre-rename commit, should be deleted rather than published —
  it would ship the wrong app under the wrong name.
- A schema change now costs a migration rather than a shrug. That is the point,
  and it is affordable: the machinery already exists and is tested.

## Alternatives considered

- **Stay on 0.x.** Honest about maturity and free of obligations. Rejected
  because the obligation is real whether or not the number admits it: once
  someone's presets and saved estimates exist, silently breaking them is a bug
  regardless of what the version says. 0.x would let that happen and call it
  compliant.
- **Wait for true nesting (tier 3) before 1.0.0.** Rejected — nesting is an
  additional tier, not a correction to the existing ones, and the selector
  already ships it visible-but-disabled. Holding a version number for a feature
  that adds a mode rather than changing one delays the promise without
  improving it.
- **Date-based versioning (`2026.07.0`).** Communicates recency and dodges the
  major-version argument entirely. Rejected: it also dodges the *signal* — a
  user cannot tell from `2026.08.0` whether their saved estimates still open,
  which is exactly the question the version is here to answer.

## Revisit triggers

- A schema change lands that cannot be migrated forward → that is 2.0.0, and
  the reasoning above is the checklist.
- Tier-3 nesting ships and materially moves counts on existing files → not a
  major by this ADR, but the changelog must say so loudly.
- The app is ever published as a library or gains a plugin surface → the
  versioned surface grows an API and this ADR needs a successor.
