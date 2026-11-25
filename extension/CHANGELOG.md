# Changelog

## 0.3.0

- **Targeting rule check.** Finds segment overrides that can never apply (every user they match is caught first by a
  higher-priority override), overrides that change nothing, segments that match nobody, and environment defaults
  nobody gets: the firewall rule anomalies of Al-Shaer & Hamed, applied to Flagsmith. Findings are proven for every
  possible user by checking one representative per equivalence class of trait values. Shown as a CodeLens badge, in
  hovers and the Problems panel, and as a report (*FlagLens: Check Targeting Rules*).
- **Pairwise test plan** (*FlagLens: Generate Pairwise Test Plan…*): the smallest set of runs in which every pair of
  values of the chosen flags appears together. Provably optimal for on/off flags (Kleitman–Spencer construction);
  IPOG plus simulated annealing, with a stated lower bound, for multivariate flags. Exports a Markdown table, JSON and
  a GitHub Actions matrix.
- The dev kit seeds two deliberate rule mistakes in Production (`pro_eu`, `uk`) so the check has something to show.

## 0.2.0

- **Preview as a user.** Pick a test user (from the new `flaglens.personas` setting, or type an identifier and
  traits) from the status bar. CodeLens, hovers and greyed-out code then show what that user gets in each
  environment, and why: segment and priority, % split bucket or identity override. Flags are evaluated locally from
  the environment document with a TypeScript port of Flagsmith's open-source engine; `npm run verify:engine` checks it
  against a live server (100% match over every rule operator).
- **Greys out code that can't run** in the active environment, like an inactive `#ifdef`: the losing branch of
  `if`/`else` and ternaries, through simple `const` aliases, and the rest of a block after a flag guard that returns,
  in JS/TS (and other brace languages) and Python. Three-valued logic means it only greys code when the outcome is
  certain. Toggle it with `flaglens.dimInactiveCode`.
- Hover cards list segment overrides per environment, read from the environment documents. The features list only
  counts them per environment, so the previous count was always 0.

## 0.1.1

- CodeLens sections no longer run together: environments are separated by ` · ` and badges by a wide gap,
  because CodeLens text collapses repeated spaces.
- Hover cards no longer show stray backslashes in flag keys (`new\_checkout`): code spans are not Markdown-escaped.

## 0.1.0

First release.

- Live flag state for every environment above each flag reference (CodeLens) and in a hover card.
- Safe toggles and value edits with confirmation, typed confirmation for protected environments, and Undo.
- Warnings for unknown flag keys (with "Replace with…" and "Create flag…" quick fixes), archived flags still in use,
  and stale flags (computed locally, works on open-source Flagsmith).
- Environment drift badge, Environment Matrix webview and "Copy diff as Markdown".
- Sidebar tree, status bar environment switcher, autocomplete of flag keys, flag history, "Find unused flags".
- Reads `flagsmith.json` from the Flagsmith CLI; detection matches Flagsmith's Code References scanner.
