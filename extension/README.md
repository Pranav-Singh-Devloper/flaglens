# FlagLens for Flagsmith

A community VS Code extension for **self-hosted Flagsmith** (works with Flagsmith Cloud too).
See every flag's live state right where your code uses it, change flags safely, and catch environment drift,
typos and stale flags before they bite.

> Not an official Flagsmith product. Full documentation, the one-command self-hosted dev kit and the demo:
> https://github.com/Pranav-Singh-Devloper/flaglens

## Features

- **Inline state for every environment**: `⚑ new_checkout   Development ● on   Staging ● on   Production ○ off`
- **Greys out code that can't run** in the active environment, like an inactive `#ifdef`: the losing `if`/`else` or
  ternary branch and the rest of a block after a flag guard that returns, with the reason at the end of the line.
  Only when it's certain: a flag that differs between users is left alone.
- **Preview as a user**: pick a test user (identifier + traits) and every CodeLens, hover and greyed-out region shows
  what *they* get and which segment, % split or override decided. Evaluated locally with Flagsmith's own rules from
  the environment document, verified against a live server.
- **Hover card**: values, variants and weights, overrides, last change, one-click toggles.
- **Safe changes**: confirmation for every write; protected environments (`prod|live|main`) need the flag name typed;
  Undo; every change logged.
- **Typo detection**: `isFeatureEnabled('new_chekout')` is underlined, with *Replace with `new_checkout`* and
  *Create flag in Flagsmith* quick fixes.
- **Targeting rule check**: segment overrides that can never apply (shadowed by higher-priority ones), overrides that
  change nothing, segments that match nobody. Each finding is proven for every possible user; shown in CodeLens,
  hovers, the Problems panel and a Markdown report (*FlagLens: Check Targeting Rules*).
- **Pairwise test plan**: the smallest set of runs covering every pair of values of chosen flags, provably optimal for
  on/off flags (Kleitman–Spencer), with JSON and a GitHub Actions matrix (*FlagLens: Generate Pairwise Test Plan…*).
- **Flagsmith's flag lifecycle, in the editor**: flag dependencies (*Requires `x`*, and a *blocked* badge where the
  prerequisite is off), Feature Health alerts (an *unhealthy* badge, the reason, and a warning before you change the
  flag), lifecycle stage, owners and code-reference counts in the hover.
- **Real-time updates** through a signed Flagsmith webhook: changes made anywhere show up within a few seconds.
- **Change targeting from the editor**: set a flag for the user you are previewing as (identity override), and add,
  change, reorder or remove segment overrides, with the rule check re-run after each change. Environments with
  feature versioning get a new published version per change.
- **Kill switch**: when Flagsmith Feature Health reports a flag unhealthy where it is on, turn it off from the alert or
  the hover.
- **FlagLens in CI**: the same checks for a whole repository, as a GitHub Action with a pull-request comment.
- **Publish Code References to Flagsmith**: upload every flag reference in the repository, so the Flagsmith
  dashboard links each flag to its files and lines.
- **Drift**: a ⚠ badge when Staging and Production disagree; Environment Matrix; *Copy diff as Markdown*.
- **Stale flags** on open-source Flagsmith: flags identical in every environment for N days.
- **Archived flags still in use**, autocomplete of flag keys, sidebar tree, history, *Find unused flags*.

## Getting started

1. Run **FlagLens: Connect to Flagsmith** from the Command Palette.
2. Enter your API URL (`http://localhost:8000` for the dev kit, `https://api.flagsmith.com` for Cloud).
3. Paste an **Organisation API key** (Organisation Settings → API Keys). It is kept in VS Code SecretStorage.
4. Pick a project, or add a `flagsmith.json` (Flagsmith CLI format) to your workspace and FlagLens picks it up.

Flag references are found with the same pattern as Flagsmith's Code References scanner
(`isFeatureEnabled("x")`, `is_feature_enabled('x')`, `hasFeature("x")`, `getFeatureValue("x")`…), plus
`flagsmith.getValue('x')` and React's `useFlags(['x'])`. Add your own with `flaglens.extraPatterns`.

## Settings

| Setting | Default | |
|---|---|---|
| `flaglens.apiUrl` | `http://localhost:8000` | Flagsmith API base URL |
| `flaglens.dashboardUrl` | same as API | Dashboard base URL for links |
| `flaglens.projectId` | from `flagsmith.json` | Project ID |
| `flaglens.activeEnvironment` | from `flagsmith.json` | Active environment |
| `flaglens.refreshIntervalSeconds` | `10` | Polling interval |
| `flaglens.protectedEnvironments` | `prod\|live\|main` | Typed confirmation for these |
| `flaglens.driftEnvironments` | `["Staging","Production"]` | Pair compared for the drift badge |
| `flaglens.staleAfterDays` | project setting, else `30` | Stale threshold |
| `flaglens.permanentTags` | `["permanent","kill-switch"]` | Never stale |
| `flaglens.extraPatterns` | getValue, useFlags | Extra key regexes (named group `key`) |
| `flaglens.codeLens.enabled` | `true` | |
| `flaglens.diagnostics.unknownFlagSeverity` | `warning` | |
| `flaglens.diagnostics.staleFlags` | `true` | |
| `flaglens.personas` | `[]` | Test users for *Preview as* (`name`, `identifier`, `traits`) |
| `flaglens.dimInactiveCode` | `true` | Grey out code that can't run |

MIT licensed.
