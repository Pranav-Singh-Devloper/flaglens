# FlagLens for Flagsmith

> See and safely change your **self-hosted Flagsmith** flags right where they live in your code, and catch environment
> drift, typos and stale flags before they bite.

[![CI](https://github.com/Pranav-Singh-Devloper/flaglens/actions/workflows/ci.yml/badge.svg)](https://github.com/Pranav-Singh-Devloper/flaglens/actions/workflows/ci.yml)
· **Toggle Wars 2026, Track 03: Build on Open Source Flagsmith**
· [▶ Demo video](#demo) · [⬇ Download the .vsix](https://github.com/Pranav-Singh-Devloper/flaglens/releases/latest)

FlagLens is two things that work together:

1. **A VS Code extension** that puts live Flagsmith state next to every flag in your code: every environment's
   on/off and value, a ⚠ when Staging and Production disagree, squiggles under misspelled flag keys, and safe,
   confirmed toggles without leaving the editor.
2. **A one-command self-hosted dev kit**: `make up && make seed` starts the official open-source Flagsmith 2.295.2
   in Docker and fills it with a realistic demo project, so anyone can try the extension in about five minutes.

It is a community project, not an official Flagsmith product.

![FlagLens in VS Code: live state of every flag in every environment, and the hover card for checkout_button_color](docs/screenshots/hover.png)

```
⚑ new_checkout   Development ● on · Staging ● on · Production ○ off   ⚠ drift
if (flags.isFeatureEnabled('new_checkout')) {

⚑ rate_limit_per_minute   Development ● on 1000 · Staging ● on 100 · Production ● on 50   ⚠ drift
const limit = flags.getFeatureValue('rate_limit_per_minute');

if (flags.isFeatureEnabled('new_chekout')) {      ← Flag "new_chekout" doesn't exist in Flagsmith. Did you mean "new_checkout"?
                            ~~~~~~~~~~~              Quick fix: Replace with "new_checkout" · Create flag in Flagsmith…
```

## Screenshots

| | |
|---|---|
| ![CodeLens above every flag reference](docs/screenshots/codelens.png) **Live state inline**: every environment above every flag, with ⚠ drift, 🗑 stale and archived badges. | ![Environment Matrix](docs/screenshots/matrix.png) **Environment Matrix**: every flag × environment, differences highlighted, copy the diff as Markdown. |
| ![Typo quick fix](docs/screenshots/typo-quick-fix.png) **Typo detection**: unknown keys are underlined, with *Replace with…* and *Create flag…* quick fixes. | ![Typed confirmation for Production](docs/screenshots/protected-confirm.png) **Protected environments**: changing Production means typing the flag's name. |
| ![Problems panel with archived and stale flags](docs/screenshots/archived-and-stale.png) **Archived and stale flags** show up as problems, computed locally on open-source Flagsmith. | ![The self-hosted Flagsmith dashboard](docs/screenshots/dashboard-production.png) **Same data as the dashboard**: every value comes from your self-hosted Flagsmith. |

## Why

- **Context switching.** You read `isFeatureEnabled("new_checkout")` and can't tell whether it's on in production
  without opening the dashboard, picking the project, then the environment, then searching. Then again for staging.
- **Environment drift.** "What you want to know at 2 AM is whether staging and production disagree." Today that means
  clicking through every environment.
- **Silent typos.** `isFeatureEnabled("new_chekout")` doesn't error: every SDK returns the default and the feature
  never ships.
- **Flag debt on open source.** Flags stay fully on for months. Flagsmith's stale-flag detection is a paid SaaS
  feature, and on self-hosted open-source Flagsmith even the audit-log API returns nothing. FlagLens computes
  staleness itself.

## What it does

| | Feature | Flagsmith API it uses |
|---|---|---|
| 🔍 | Live state of every environment above each flag reference (CodeLens) and in a hover card with values, variant weights, overrides and last change | `GET /projects/{id}/features/`, `GET /environments/{key}/featurestates/` |
| 🔁 | **Safe toggles and value edits**: modal confirmation, typed confirmation for protected environments (`prod\|live\|main`), Undo, every change logged | `PATCH /environments/{key}/featurestates/{id}/` |
| ⚠️ | **Drift badge** when Staging ≠ Production, **Environment Matrix** of every flag × environment, **Copy diff as Markdown** for a PR | feature states × environments |
| ✍️ | **Typo detection** for unknown keys with *Replace with…* and *Create flag in Flagsmith…* quick fixes (respects the project's naming rules) | `POST /projects/{id}/features/` |
| 🧹 | **Stale flags on open-source Flagsmith**: identical in every environment for N days, no targeting, not tagged permanent | `updated_at` of feature states, tags (`is_permanent`) |
| 🗄 | **Archived flags still referenced** in code are flagged for removal | `is_archived` |
| 🔒 | **Experiment lock**: flags in a running experiment are badged and can't be toggled | `GET /environments/{key}/experiments/` (beta) |
| ⌨️ | Autocomplete flag keys inside `isFeatureEnabled("…")`, sidebar tree, status-bar environment switcher, flag history, *Find unused flags* in the workspace | all of the above |
| 🐳 | **Dev kit**: pinned official images, idempotent REST seed, demo shop using the official Node SDK | Docker, REST, SDK API |

It fits the existing Flagsmith toolchain instead of inventing its own:

- It reads **`flagsmith.json`**, the config file written by the official Flagsmith CLI (`flagsmith init`), to pick
  the project and default environment.
- It finds flag keys with **the same pattern as Flagsmith's own Code References scanner**
  ([Flagsmith/ci](https://github.com/Flagsmith/ci)), so `is_feature_enabled("x")`, `isFeatureEnabled('x')`,
  `hasFeature("x")`, `getFeatureValue("x")`, `IsFeatureEnabled("x")`… work in JS/TS, Python, Go, Java, Kotlin, C#,
  Dart and Ruby. Two extra patterns add the JS client's `flagsmith.getValue('x')` and the React SDK's
  `useFlags(['x', 'y'])`, which the official scanner misses.

## Quick start (about 5 minutes)

**Prerequisites:** [Docker](https://docs.docker.com/get-docker/) with Compose v2 (Docker Desktop is fine),
Node.js 22 or newer, VS Code 1.95 or newer, and `make` (on Windows, use the `npm run …` command shown next to each step).

```bash
git clone https://github.com/Pranav-Singh-Devloper/flaglens.git && cd flaglens

make up      # start self-hosted Flagsmith 2.295.2 on http://localhost:8000      (npm run devkit:up)
make seed    # admin user, "Demo Shop" project, 3 environments, 7 flags, .env      (npm run devkit:seed)
make demo    # the demo shop on http://localhost:3030, reading flags via the SDK   (npm install && npm run demo)
```

The first `make up` pulls the images and runs database migrations, which takes 1–3 minutes. It returns once Flagsmith
is healthy.

Then install the extension, in either of two ways:

- **Download** `flaglens-0.1.1.vsix` from [Releases](https://github.com/Pranav-Singh-Devloper/flaglens/releases/latest),
  then in VS Code: Command Palette → **Extensions: Install from VSIX…** → pick the file.
- **Or build it**: `make package` (npm: `npm install && npm run package`) creates `extension/flaglens.vsix`. If the
  `code` command is on your PATH, `make install-ext` builds and installs it in one step.

Finally open the demo workspace: **File → Open Folder… → `flaglens/examples/demo-shop`**
(or `code examples/demo-shop`). FlagLens notices the `.env` that `make seed` wrote and asks
**"Connect with it?"**. Click **Connect**.

### What success looks like

- `make seed` ends with a box: `✔ Self-hosted Flagsmith is seeded and ready.`
- VS Code's status bar shows **`⚑ Demo Shop · Development`**.
- In `server.mjs`, above `isFeatureEnabled('new_checkout')`, you see
  `⚑ new_checkout   Development ● on · Staging ● on · Production ○ off`, and `rate_limit_per_minute` shows **⚠ drift**.
- `typo.ts` has a yellow squiggle under `new_chekout` (try the quick fix) and a blue hint on `dark_mode` (stale).
- Click the `new_checkout` CodeLens → **Turn off in Development** → confirm. Within 3 seconds the shop at
  http://localhost:3030 switches back to the classic checkout. Try Production: you'll be asked to type the flag name.
- The Flagsmith dashboard at http://localhost:8000 shows the same change. Log in with
  `admin@flaglens.local` / `FlagLens-demo-2026`.

Something wrong? See [Troubleshooting](#troubleshooting).

## Use it with your own Flagsmith

1. Command Palette → **FlagLens: Connect to Flagsmith**.
2. Enter your API URL: your self-hosted instance (e.g. `https://flags.mycompany.com`), or `https://api.flagsmith.com`
   for Flagsmith Cloud.
3. Paste an **Organisation API key** (dashboard → Organisation Settings → API Keys). It is stored in VS Code's
   encrypted SecretStorage, one key per server, and never written to settings or logs.
4. Pick the project. If your repo already has a `flagsmith.json` from the Flagsmith CLI, FlagLens uses it
   (`project` and `environment` may be ids, names or a client-side key).

## Commands

| Command | |
|---|---|
| FlagLens: Connect to Flagsmith… / Sign Out | Connect, or forget the stored API key |
| FlagLens: Toggle Flag… / Set Flag Value… | Change a flag in one environment (with confirmation) |
| FlagLens: Create Flag in Flagsmith… | Create a flag (starts OFF everywhere) |
| FlagLens: Open Environment Matrix | Every flag × environment, differences highlighted, click to toggle |
| FlagLens: Copy Environment Diff as Markdown… | Paste-ready table of differences between two environments |
| FlagLens: Show Flag History… | Audit log (if the server exposes it), last change per environment, changes made with FlagLens |
| FlagLens: Find Unused Flags in Workspace | Project flags that no file references |
| FlagLens: Switch Active Environment… / Switch Project… / Refresh Flags / Show Log | |

## Configuration

| Setting | Default | Purpose |
|---|---|---|
| `flaglens.apiUrl` | `http://localhost:8000` | Flagsmith API base URL, without `/api/v1`. If unset: `apiUrl` in `flagsmith.json`, then `FLAGSMITH_API_URL` in the workspace `.env`. |
| `flaglens.dashboardUrl` | same as `apiUrl` | Dashboard base for links (`https://app.flagsmith.com` is used automatically for Cloud) |
| `flaglens.projectId` | from `flagsmith.json` | Project to show |
| `flaglens.activeEnvironment` | from `flagsmith.json` | Environment used by the status bar, tree and autocomplete |
| `flaglens.refreshIntervalSeconds` | `10` | Polling interval (minimum 3) |
| `flaglens.protectedEnvironments` | `prod\|live\|main` | Case-insensitive regex; matching environments need the flag name typed to confirm a change |
| `flaglens.driftEnvironments` | `["Staging", "Production"]` | The pair compared for the ⚠ drift badge |
| `flaglens.staleAfterDays` | project's `stale_flags_limit_days`, else `30` | Days unchanged before a uniform flag counts as stale |
| `flaglens.permanentTags` | `["permanent", "kill-switch"]` | Tags that are never stale (tags marked *permanent* in Flagsmith count too) |
| `flaglens.extraPatterns` | `getValue` and `useFlags` patterns | Extra regexes with a named group `key` |
| `flaglens.codeLens.enabled` | `true` | Show the inline states |
| `flaglens.diagnostics.unknownFlagSeverity` | `warning` | `error`, `warning`, `information` or `off` |
| `flaglens.diagnostics.staleFlags` | `true` | Show stale-flag hints |

## Environment variables (dev kit)

`make seed` writes a git-ignored `.env` at the repo root and a copy in `examples/demo-shop/.env`.
[`.env.example`](.env.example) documents every variable. You only need to set one yourself to change a default
**before** seeding.

| Variable | Default | Used by | Purpose |
|---|---|---|---|
| `FLAGSMITH_API_URL` | `http://localhost:8000` | seed, demo shop, extension | Flagsmith base URL |
| `FLAGSMITH_API_KEY` | written by seed | extension (offered on first open) | Organisation API key. **Secret.** |
| `FLAGSMITH_ORGANISATION_ID` | written by seed | reference | |
| `FLAGSMITH_PROJECT_ID` | written by seed | extension | |
| `FLAGSMITH_ENV_KEY_DEVELOPMENT`, `…_STAGING`, `…_PRODUCTION` | written by seed | demo shop | Client-side environment keys (public by design) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@flaglens.local` / `FlagLens-demo-2026` | seed | Dev-kit dashboard login |
| `DEMO_PORT` | `3030` | demo shop | |
| `DEMO_ENVIRONMENT` | `Development` | demo shop | Environment the shop reads by default (`?env=Production` overrides) |
| `FLAGSMITH_PORT` | `8000` | `make up` (shell variable) | Host port if 8000 is taken: `FLAGSMITH_PORT=8080 make up`, then set `FLAGSMITH_API_URL=http://localhost:8080` |

### Dev kit commands

| make | npm | |
|---|---|---|
| `make up` | `npm run devkit:up` | Start Flagsmith (waits until healthy) |
| `make seed` | `npm run devkit:seed` | Seed or re-seed. Safe to re-run: it restores every demo flag to its declared state ([`devkit/seed-data.json`](devkit/seed-data.json)) |
| `make demo` | `npm run demo` | Run the demo shop |
| `make down` / `make reset` | `npm run devkit:down` / `devkit:reset` | Stop / stop **and delete all data** |
| `make logs` | `npm run devkit:logs` | Follow Flagsmith logs |
| `make mcp` | `npm run devkit:mcp` | Also start Flagsmith's MCP server on :8002 |

The seeded flags are designed so every feature is visible:

| Flag | Development | Staging | Production | Shows |
|---|---|---|---|---|
| `new_checkout` | on | on | off | Toggle it live; the shop's checkout changes |
| `banner_text` | `🚧 dev build` | `Black Friday: 30% off` | `Black Friday: 30% off` | Values inline; the shop banner |
| `rate_limit_per_minute` | 1000 | 100 | 50 | **⚠ drift** between Staging and Production |
| `checkout_button_color` | blue / green 50% / orange 50% | same | same | Multivariate variants and weights |
| `dark_mode` | on | on | on | **Stale** (the demo workspace sets `staleAfterDays: 0`) |
| `maintenance_mode` | off | off | off | Tagged `kill-switch` (permanent), so never stale |
| `legacy_search` | off | off | off | **Archived** but still referenced |

## How it uses Flagsmith

Remove Flagsmith and FlagLens does nothing: every badge, value and warning is live data from the Flagsmith API, and
every change is a Flagsmith write.

```mermaid
flowchart LR
  subgraph Editor["VS Code + FlagLens"]
    S[Scanner<br/>Code References pattern] --> V[CodeLens · Hover · Diagnostics<br/>Tree · Matrix · Autocomplete]
    ST[Flag store<br/>polls every 10 s] --> V
    V -- "toggle / set value / create<br/>(confirmed)" --> C[API client]
    ST --> C
  end
  subgraph Docker["Self-hosted Flagsmith 2.295.2 (make up)"]
    API["REST API :8000<br/>/api/v1"] --> PG[(Postgres)]
    TP[Task processor] --> PG
  end
  C -- "Api-Key (Organisation key)<br/>Management API" --> API
  Shop["Demo shop<br/>@flagsmith/nodejs"] -- "environment key<br/>SDK API" --> API
  Seed["devkit/seed.mjs"] -- "REST: signup, org, project,<br/>environments, flags, API key" --> API
  CLI["flagsmith.json<br/>(Flagsmith CLI v2)"] -.-> ST
```

- **Management API, read.** On each refresh: environments, `GET /projects/{id}/features/`, tags, and one
  `GET /environments/{key}/featurestates/` per environment. This gives enabled, value, `updated_at` and per-environment
  variant weights for every flag in N+1 requests, joined into a feature × environment matrix. Experiments (beta) are
  read per environment to show the 🔒 lock.
- **Management API, write.** Toggles and values are `PATCH /environments/{key}/featurestates/{id}/` on the
  environment's default state (raw JSON values keep their type). New flags are `POST /projects/{id}/features/`. Every
  write also appears in Flagsmith's own audit log.
- **SDK API.** The demo shop uses the official `@flagsmith/nodejs` SDK with remote evaluation and per-visitor
  identities, so it serves multivariate variants and picks up changes on the next request.
- **Dev kit.** The seed uses only the public REST API (signup → organisation → project → environments → tags → flags →
  Organisation API key), so it doubles as a worked example of bootstrapping Flagsmith without clicking.

## Architecture

```
devkit/            compose.yaml (pinned 2.295.2 + optional MCP), seed.mjs + seed-data.json (zero-dependency Node)
extension/src/
  api/             typed Management API client: fetch, Api-Key auth, pagination, timeouts, typed errors
  core/            PURE logic, unit-tested: scanner (Code References pattern), model (matrix), analysis (drift,
                   stale, typo suggestions, name rules), report (Markdown diff)
  store/           FlagStore: polling, change detection, offline handling with backoff
  providers/       CodeLens, hover, diagnostics + quick fixes, autocomplete
  views/           sidebar tree, status bar, Environment Matrix webview
  commands/        connect, toggle, set value, create, history, diff, find unused
  safety.ts        confirmations, protected environments, write journal
examples/demo-shop the shop (Node SDK), plus Python / React / TypeScript files used in the demo
```

- **Zero runtime dependencies.** The extension uses only the VS Code API and Node's global `fetch`. The packaged
  `.vsix` is about 33 KB.
- Activation is cheap (`workspaceContains:**/flagsmith.json` or after startup). The matrix webview loads only when opened.
- Only open documents are scanned (debounced, cached by document version). *Find unused flags* scans the workspace on
  demand.

## Security

- The Organisation API key lives in VS Code SecretStorage only, keyed by server URL. It is never written to settings,
  logs or the workspace. **FlagLens: Sign Out** deletes it.
- Every change asks for confirmation. Protected environments also require typing the flag name, and Undo goes through
  the same check. Changes are logged to the *FlagLens* output channel and to Flagsmith's audit log.
- FlagLens warns when you connect to a remote server over plain `http://`.
- In untrusted workspaces FlagLens ignores the workspace's `flagsmith.json` and `.env`, because they decide which server
  receives your key.
- The webview has a strict Content-Security-Policy (no remote content, nonce-only scripts).
- `.env` files are git-ignored. The dev kit uses Flagsmith's local defaults (`DJANGO_SECRET_KEY=secret`, Postgres
  password `password`). They are fine on your laptop: **don't expose the dev kit to the internet.**

## Development and tests

```bash
npm install
npm run check                    # lint + type-check + unit tests (extension and dev kit)
npm run build                    # bundle the extension (esbuild)
# Press F5 in VS Code (open the repo root) to start an Extension Development Host.

make up && make seed
npm run test:integration -w extension   # end-to-end: real VS Code + real self-hosted Flagsmith
```

- **Unit tests** (Vitest, ~100 tests) cover the scanner (call styles in 9 languages, multi-line calls, false
  positives), drift and staleness rules, typo suggestions, the API client (pagination, internal hostnames in `next`,
  timeouts, retry rules, error mapping) and the Markdown diff.
- **End-to-end tests** launch VS Code with the demo workspace against the seeded Flagsmith and check CodeLens, hover,
  diagnostics, quick fixes, autocomplete, a real toggle and toggle-back, pick-up of a change made outside the editor,
  that a declined confirmation changes nothing, and the Markdown diff.
- **CI** runs both on every push, including `make up && make seed` (twice, to prove the seed is idempotent) on a
  fresh Ubuntu runner.

## Limitations and roadmap

- **v2-versioned environments are read-only.** FlagLens shows them and links to the dashboard. The versions flow
  (create version → edit → publish) is on the roadmap.
- **Polling, not push.** Changes appear within `refreshIntervalSeconds` (default 10). Real-time updates are an
  Enterprise feature; environment webhooks to a local listener are on the roadmap.
- **Segment and identity overrides are counted, not edited.**
- **Detection is pattern-based**, like Flagsmith's Code References: keys built at runtime (`isFeatureEnabled(name)`)
  aren't seen. Custom wrappers can be added with `flaglens.extraPatterns`.
- **History on open-source Flagsmith is partial.** The server hides audit-log entries from the API without a
  licence, so *Show history* combines the audit log (when available), each environment's last change and FlagLens's own
  change journal.
- **Experiment results** aren't rendered yet; only the lock badge is.
- Single-root workspaces. Multi-root support (one connection per folder) is on the roadmap.

## Things we learned about Flagsmith while building this

Checked against a live 2.295.2 instance (these shaped the design):

- `last_modified_in_any_environment` is filled only by v2 feature versioning, so it's `null` on default environments.
  FlagLens uses feature-state `updated_at` instead.
- The project audit-log API returns no rows on unlicensed self-hosted instances (`audit_log_visibility_days = 0` on the
  free plan), even though the rows are in the database.
- `GET /api/v1/audit/` returns HTTP 500 when called with an Organisation API key, and
  `PATCH …/mv-options/{id}/` without `default_percentage_allocation` returns HTTP 500 (`KeyError`). Multivariate
  `key`s sent when creating a feature are ignored. The seed works around this.
- `POST /projects/` creates no environments, and `GET /projects/` returns a plain array rather than a paginated object.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `make up` says port 8000 is in use | `FLAGSMITH_PORT=8080 make up`, then put `FLAGSMITH_API_URL=http://localhost:8080` in `.env` before `make seed` |
| `make seed`: "Could not log in" | You changed `ADMIN_PASSWORD` after the first seed. Start fresh: `make reset && make up && make seed` |
| Status bar shows ⚠ and "Can't reach Flagsmith" | Flagsmith isn't running: `make up`. FlagLens keeps the last known state and reconnects by itself |
| "Flagsmith rejected the API key" | After `make reset` the old key is gone. Run `make seed`, then **FlagLens: Connect to Flagsmith** → *Use the key from .env* |
| No "Connect with it?" prompt | Open the `examples/demo-shop` folder itself (the prompt reads `.env` at the workspace root), or run **FlagLens: Connect to Flagsmith** |
| `make demo` exits with "No FLAGSMITH_ENV_KEY_*" | Run `make seed` first |
| No CodeLens | Check `editor.codeLens` and `flaglens.codeLens.enabled` are on, and that the status bar says connected |

## Demo

▶ **Demo video (2:29, 1080p60):** [flaglens-demo.mp4](https://github.com/Pranav-Singh-Devloper/flaglens/releases/download/v0.1.1/flaglens-demo.mp4)

Everything in the video is real: the VS Code footage is the released extension, driven by a script against the
self-hosted Flagsmith from `make up && make seed`. The video itself is built in code (Playwright-driven capture,
Manim, Remotion, ElevenLabs audio); see [video/](video/) to rebuild it.

## Built with AI assistance

AI coding assistants helped write parts of this project. Every line was reviewed, and the author understands and can
explain all of the code.

## Team · Licence

Built by [Pranav Singh](https://github.com/Pranav-Singh-Devloper) for Toggle Wars 2026 (WeMakeDevs × Flagsmith),
Track 03.

[MIT](LICENSE). Flagsmith is © Flagsmith Ltd. and BSD-3-Clause licensed; FlagLens is an independent community project.
