# FlagLens for Flagsmith

A community VS Code extension for **self-hosted Flagsmith** (works with Flagsmith Cloud too).
See every flag's live state right where your code uses it, change flags safely, and catch environment drift,
typos and stale flags before they bite.

> Not an official Flagsmith product. Full documentation, the one-command self-hosted dev kit and the demo:
> https://github.com/Pranav-Singh-Devloper/flaglens

## Features

- **Inline state for every environment**: `⚑ new_checkout   Development ● on   Staging ● on   Production ○ off`
- **Hover card**: values, variants and weights, overrides, last change, one-click toggles.
- **Safe changes**: confirmation for every write; protected environments (`prod|live|main`) need the flag name typed;
  Undo; every change logged.
- **Typo detection**: `isFeatureEnabled('new_chekout')` is underlined, with *Replace with `new_checkout`* and
  *Create flag in Flagsmith* quick fixes.
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

MIT licensed.
