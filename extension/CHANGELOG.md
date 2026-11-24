# Changelog

## 0.1.1

- CodeLens sections no longer run together: environments are separated by ` · ` and badges by a wide gap,
  because CodeLens text collapses repeated spaces.

## 0.1.0

First release.

- Live flag state for every environment above each flag reference (CodeLens) and in a hover card.
- Safe toggles and value edits with confirmation, typed confirmation for protected environments, and Undo.
- Warnings for unknown flag keys (with "Replace with…" and "Create flag…" quick fixes), archived flags still in use,
  and stale flags (computed locally, works on open-source Flagsmith).
- Environment drift badge, Environment Matrix webview and "Copy diff as Markdown".
- Sidebar tree, status bar environment switcher, autocomplete of flag keys, flag history, "Find unused flags".
- Reads `flagsmith.json` from the Flagsmith CLI; detection matches Flagsmith's Code References scanner.
