# Changelog

## 0.7.0

- **A/B test results on the flag.** For a flag in a running Flagsmith experiment (Experimentation, beta), the badge
  shows the leading variation (*experiment: green +55% (99% to win)*), and the hover shows the hypothesis, the metric
  and, per variation, exposures, conversion, lift against control with its 95% interval and the chance to win. It says
  when a variation is likely better (95% or more) and warns about a sample ratio mismatch. **Show Experiment Results**
  opens a report; **Refresh Experiment Results** asks Flagsmith to recompute. The statistics are Flagsmith's own.
- **Flagsmith's MCP server for AI assistants.** While FlagLens is connected and the server answers, it offers
  Flagsmith's MCP server to VS Code's AI assistants (VS Code 1.101+) as *Flagsmith*. The organisation key is added from
  secret storage only when VS Code starts the server. New setting `flaglens.mcp.url` (empty = off).
- The experiment lock badge now appears on Flagsmith 2.295, which returns the experiment's flag as an object.
- Dev kit: the seed runs a real experiment in Staging (warehouse on the Flagsmith database, a `checkout_completed`
  metric and 2,400 simulated shoppers, every event timestamped inside the window Flagsmith counts); the demo shop reports exposures and checkouts; `make mcp-check` checks the
  MCP server with the seeded key, and CI runs it.

## 0.6.1

- The listing (Open VSX) links the demo video, the website, the source and the research paper.

## 0.6.0

- **FlagLens in CI.** `flaglens check` runs the editor's checks over a repository against Flagsmith: unknown flag keys
  (with a suggested fix and a link to the line), archived flags still in code, and targeting-rule mistakes. As a
  GitHub Action (`uses: Pranav-Singh-Devloper/flaglens@v0.6.0`) the report goes to the job summary and, on pull
  requests, a comment; `strict: true` fails the job. Locally: `make flag-check`.
- **Kill switch for unhealthy flags.** When Flagsmith Feature Health newly reports a flag unhealthy in an environment
  where it is on, FlagLens says so once and offers *Turn off in <environment>*; the hover has the same link. It is the
  ordinary toggle: the confirmation (typed for protected environments), the journal and Undo.
- Releases publish to Open VSX and the VS Code Marketplace when their tokens are configured.

## 0.5.1

- The hover links *Set for <user>…* and *Segment overrides…* now work. Hover links may only run allow-listed commands,
  and the two new ones were missing from the list; an end-to-end test now checks every link in the hover.
- Feature Health alerts show up within one refresh interval while real-time updates are on. Health events don't
  trigger Flagsmith webhooks, so FlagLens checks them on their own (one request) instead of waiting for the slower
  fallback poll.
- Real-time updates are described as taking a few seconds, which is what we measure (about 3 s from a dashboard toggle
  to the editor), rather than two.

## 0.5.0

- **Real-time updates.** FlagLens registers a Flagsmith organisation webhook pointing at a small listener in the
  editor (random port and path; every call must carry a valid HMAC-SHA256 signature) and refreshes within a few seconds of any change, made anywhere. The webhook is removed when the window closes, and webhooks left by crashed
  windows are cleaned up. Polling continues as a fallback, every 30 s while the webhook works. On by default when
  Flagsmith runs on this machine (`flaglens.realtime.mode`); the dev kit allows `host.docker.internal` in Flagsmith's
  `SSRF_ALLOWED_HOSTS`. The status bar shows a lightning bolt while it is live.
- **Set Flag for Previewed User**: an identity override for the user you are previewing as (on, off, a value, or
  remove), with a confirmation that says who is affected and Undo.
- **Edit Segment Overrides**: add, turn on or off, change, reorder or remove a flag's segment overrides in one
  environment. The targeting-rule check runs again afterwards and reports any override the change left shadowed or
  redundant.
- **v2 feature versioning**: toggles and value changes in versioned environments are published as a new version
  (Undo publishes another). Segment overrides there stay dashboard-only.
- *Preview as → Custom identity* suggests traits and values from the project's segment rules and from trait keys
  stored in Flagsmith.

## 0.4.0

- **Flag dependencies.** A flag that requires another shows *Requires `parent`* in the hover, and a *blocked* badge in
  environments where the parent is off (so it can't serve on, however it is set). Flagsmith stores a dependency as a
  system segment with a `$.flags[...]` condition; the local engine now evaluates these in two passes, exactly as the
  server does, so *Preview as* and greying out account for them. `make verify-engine` covers a dependency and the
  no-identity case: 15,050 checks, 100% match.
- **Publish Code References to Flagsmith** (command, view toolbar, or `make code-refs` / `npm run code-refs` for CI):
  uploads every flag reference in the repository in the format of Flagsmith's own scanner, after a confirmation.
  Flagsmith then shows each flag's files and lines with links to GitHub and moves the flag from *new* to *live*.
- **Feature Health.** When Flagsmith's Feature Health reports a flag unhealthy (for example from a monitoring webhook),
  FlagLens badges it at every reference, shows the reason and links in the hover, and repeats the warning in the
  confirmation for toggles and value changes. The dev kit adds a Webhook provider and `make alert` / `make recover`.
- Hovers show Flagsmith's lifecycle stage, the flag's code-reference count and owners; flags Flagsmith marks *to
  remove* get a badge.
- The features list is now requested for the active environment, which is what makes Flagsmith return lifecycle data.

## 0.3.1

- Pairwise test plans prove a stronger lower bound when one flag has several values and the rest are on/off (2a+1
  runs once there are more than 2^(a−1) on/off flags), so plans like the demo's 7 runs for 6 flags are reported as
  optimal.
- Corrected the IPOG citation (Lei, Kacker, Kuhn, Okun & Lawrence, 2007).

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
