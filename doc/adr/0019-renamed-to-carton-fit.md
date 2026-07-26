# ADR-0019: The app is named Carton Fit

Date: 2026-07-26
Status: Accepted
Relates to: ADR-0004 (carton vocabulary), ADR-0007 (storage location),
ADR-0010/0012 (installers, CI), ADR-0014 (window state file)

## Context

"Packaging Estimator" was the working title from repo setup and was never
examined. Asked directly, before tagging v1.0.0, it has one real defect: in
manufacturing and construction an **estimator** is the person who prices a job.
A packaging engineer reading "Packaging Estimator" can reasonably expect
cost-per-unit and quotes — the app answers fit, orientation and count, and says
nothing about money. The word that is right (the app genuinely estimates rather
than proves — ADR-0003) collides with a domain meaning that is wrong.

Two candidate replacements survived scrutiny. **Cube Fit** borrows the
industry's own "cube out vs weigh out", which is exactly the binding constraint
this app reports — but the UI never says "cube" (it labels that metric *Fill*),
so the name would point at a concept the product does not use. **Carton Fit**
names the object and the question, and *carton* is already this product's own
word: the inputs panel's CARTON section, "Name this carton setup", the
`Carton (inner)` line in every export, ADR-0004's vocabulary throughout.

Renaming is cheapest now and never gets cheaper: the only data at risk is the
author's own dogfooding rows.

## Decision

The app is **Carton Fit**. Its identity is split by audience, because the
display name has a space and the author does not want spaces in paths:

| Context | Value |
| --- | --- |
| Display — window, Start-menu shortcut, docs, exports | `Carton Fit` |
| Repository, working directory | `Carton-Fit` |
| npm `name` | `carton-fit` |
| `appId` | `com.loganbresnahan.cartonfit` |
| Executable, installer artifact | `Carton-Fit.exe`, `Carton-Fit-Setup-${version}.exe` |
| `userData` directory | `Carton-Fit` |
| Database file | `carton-fit.db` |
| localStorage key | `carton-fit:settings` |

Two of those need machinery rather than a config value:

- **`executableName` and `artifactName` are set explicitly**, because both
  default to `productName` and would otherwise put a space in every shipped
  filename.
- **`app.setName('Carton-Fit')` runs before anything reads `userData`.**
  Electron derives that path from the app name, so without it the directory
  would be `Carton Fit`. It is called at module load in main, ahead of
  `whenReady`, because `windowState` reads `userData` in the first line of
  `createWindow` (ADR-0014).

## Consequences

- **Existing local data is orphaned, deliberately.** The `userData` directory
  and the database file both change name, so presets, saved estimates and
  window geometry from before the rename are not found. No migration is
  written: the data is one developer's dogfooding rows, and a
  copy-the-old-directory shim would be permanent code paying for a single
  afternoon. Same for the localStorage settings key — the inputs return to
  defaults once.
- Anyone who installed a pre-rename build has a second app in Programs and
  Features. Uninstall the old one; nothing is shared between them.
- The GitHub repository is renamed. GitHub redirects the old URL, so existing
  clones keep working, but the remote is updated here anyway rather than
  relying on a redirect that is a courtesy, not a contract.
- Every doc, skill and ADR that named the product was updated in place. That
  is not a violation of "supersede rather than rewrite": no decision changed,
  only the product's name, and leaving the old name in prose would make those
  documents wrong about the thing they describe. This ADR is the record that
  the change happened.
- `dist-live/` still holds a pre-rename installer until the next `/deploy`.

## Alternatives considered

- **Keep "Packaging Estimator".** Accurate, and "estimator" honestly signals
  heuristic. Rejected on the pricing misread — the audience most likely to use
  this tool is the audience most likely to misread it.
- **"Cube Fit".** Domain-native to logistics ("cube utilization"), but the UI
  says *Fill*; adopting it honestly means renaming that metric too, which is a
  change to the product's vocabulary rather than just its title.
- **"DIM Check".** Rejected firmly: **DIM weight** is dimensional-weight
  *billing*. The name would promise a cost calculation the app does not
  perform — the same failure as "estimator", but sharper. ("dim check"
  lowercase also reads badly.)
- **Spaces everywhere, matching `productName`.** Simplest configuration —
  delete two lines instead of adding them. Rejected on the author's stated
  preference, and spaces in `%APPDATA%` paths and artifact names are a
  perennial quoting hazard in scripts and CI.
- **A migration that copies the old `userData` directory forward.** Correct for
  a shipped product with users. Rejected here as permanent code serving a
  one-time, single-machine problem.

## Revisit triggers

- The app grows shipping-cost or dimensional-weight features → the name stops
  covering the product; revisit rather than stretch it.
- A trademark or a name collision surfaces on a public listing.
