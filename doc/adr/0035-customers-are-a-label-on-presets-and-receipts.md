# ADR-0035: Customers are a label on presets and receipts, never an input

**Status:** Proposed, 2026-09-04. Builds on ADR-0034 and is sequenced behind
it (roadmap item 27).

## Context

Two identical parts ship to two companies, and the companies want different
boxes — one requires more padding, one has a weight limit per carton, one
simply has a standard case size. The app already *can* express this: two
presets, two saved estimates, each carrying its own carton and clearances. What
it cannot express is **why** the same part has two different receipts, or let
someone work inside one of the two answers without seeing the other.

The question raised on 2026-09-04 was whether that wants "some kind of entity"
— a table that a preset and a receipt can belong to, so the user can work
within one. It does. What it must not become is the thing that word suggests.

Three constraints from the record decide the shape:

- **ADR-0016 §3 fixed the vocabulary**: a *preset* is a reusable carton setup
  with no part attached; a *saved estimate* is a receipt about a specific
  part. ADR-0034 kept presets global for that reason — they are how you ship,
  not what you ship. A per-customer carton requirement is exactly a preset;
  the customer is what a preset is *for*.
- **Nothing the engine computes may depend on it.** The pack takes a carton,
  clearances, a cap and parts. If a customer carried its own padding or cap,
  it would be a preset under another name, and the vocabulary blurs again.
- **VISION's non-goals** refuse cost estimation and box recommendation, and
  ADR-0019 renamed the app because "estimator" promised costing. A customer
  record with addresses, contacts, terms and notes is a CRM, and every one of
  those fields is a request that will arrive on its own and should be refused
  on its own.

## Decision

### 1. A customer is a name and an id

`customers (id, name UNIQUE, created_at)`. Nothing else. Not an address, not a
contact, not a note. If a field beyond the name is ever wanted, it is its own
ADR with its own reason, and the default answer is no.

The **UI says "Customer."** "Entity" is database vocabulary — nobody at a
packing bench says it — and what varies packaging requirements is the
recipient. The table may be renamed if the first real grouping turns out to be
a carrier or a plant rather than a company (revisit trigger); the concept does
not change.

### 2. Presets and receipts each carry an optional customer

`configurations.customer_id` and `estimates.customer_id`, both nullable, both
added by migration (`user_version` 3, after ADR-0034's alias table at 2). A
null means **house** — the carton everyone gets. Most shops have five boxes
that go to everyone and one customer who wants double-wall; the null is the
common case and is never made to feel like a missing value.

A receipt's customer is set at save time from the active customer (§3) and
**never changes** — the same immutability every other field on a receipt has.
A preset's customer is set at save time and may be changed from the picker,
since a preset is a library entry, not a record of a decision.

### 3. "Working for" is a header control

A selector in the header — *Working for: House ▾ / Acme / Beta* — holds the
**active customer**, which is app state, not document state: it survives a
file load, because "same customer, next part" is the workflow it exists for.
It persists in `localStorage` beside the layout preferences, in its own key,
so it is never serialized into a preset or a receipt as a setting (ADR-0026 §6
drew that line for the panel width; it holds here).

The active customer filters what the two lists show: the preset picker shows
the active customer's cartons **plus house**, and the saved-estimates section
shows the document's receipts for the active customer **plus house**. *All*
widens both, as in ADR-0034. Saving a preset or a receipt tags it with the
active customer.

**Switching customer is not an undo step.** Undo (ADR-0016 §2) covers inputs;
the customer changes what is *shown*, not what is *computed*. Nothing in the
pack pipeline reads it, and a test pins that: the same request under two
customers is byte-identical.

### 4. The wire follows, additively

- `get_app_state.customer: { id, name } | null`.
- `list_customers`, and `set_customer` — the latter a drive tool like
  `set_inputs`, since it changes what the running app shows.
- `save_preset` and `save_estimate` tag with the active customer, and say so
  in their reply; `list_presets` and `list_saved_estimates` gain
  `customer: 'active' | 'all'`, defaulting to `'active'`, composing with
  ADR-0034's `scope`.
- Creating a customer stays in the app. An assistant can list and switch; a
  new name is the user's act, for the same reason a delete is (ADR-0029
  amendment 8): not undoable, and not something to do on a reader's guess.

## Consequences

- The "why does this part have two receipts?" question gets a one-word answer
  in the list, and a shop with real customers can work inside one without
  reading the others.
- The twelve-preset residue problem gains structure without reopening the
  global-library decision: presets stay one table, and a customer with three
  cartons sees three.
- Second migration in the sequence (v3), two nullable columns and one table.
  Existing rows are house rows by definition and need no backfill.
- A fourth kind of header control arrives (theme, storage, update, customer).
  The header is the place for things that are app-wide and not inputs; if it
  fills, that is a layout decision, not a reason to push the customer back
  into the sidebar.
- The dogfood brief gains nothing until a station needs a customer; the
  reference file ships to nobody in particular.

## Alternatives considered

- **Free-form tags** on presets and receipts. More flexible and less useful:
  tags do not give "work within," which was the ask, and they invite
  `acme`, `Acme`, `ACME`. A named table with a selector does.
- **The customer carries its own clearances or cap** as defaults. Rejected:
  that is a preset, and two things that both hold a carton setup will drift.
  A customer's requirements are expressed as that customer's presets.
- **Fold the customer into the preset name** (`Acme — 12×10×8`). Zero build,
  and it cannot filter receipts, cannot be selected, and scales exactly as
  well as a naming convention.
- **Scope the customer to the document** (a part's customers). Rejected: the
  workflow is "same customer, next part," so the customer must survive a
  load. The document × customer filter gives the other reading for free.
- **Make it "entity" in the UI too**, to stay neutral. Rejected in §1: the
  concrete word is more usable and the concept is unchanged if the word is
  later wrong.

## Revisit triggers

- **The first real grouping is not a customer** — a carrier, a plant, a
  product line. Rename the UI word (and the table if it bothers anyone); do
  not add a `kind` column to make one table serve two words.
- **Someone asks for a field on a customer** (address, contact, notes). That
  is the CRM boundary; the answer is its own ADR, and the default is no.
- **A customer wants to *be* a default carton** — users creating a customer
  and immediately a single preset for it, every time. Then a shortcut
  ("create customer with this carton") is warranted; the model still is not
  changed.
- **Receipts want to move between customers** because someone saved under the
  wrong one. Delete and re-save is the answer while receipts are immutable;
  if that is too slow in practice, revisit §2's immutability for the customer
  column alone, and say why it differs from the rest of the row.
