# Demo Shop

A tiny shop whose banner, checkout flow, button colour, theme and rate limit all come from the self-hosted Flagsmith
started by the FlagLens dev kit. Open this folder in VS Code with FlagLens installed to see every flag reference
annotated with its live state.

| File | Shows |
|---|---|
| `server.mjs` | The running shop (`make demo` → http://localhost:3030). Official `@flagsmith/nodejs` SDK, remote evaluation. |
| `worker.py` | Detection in Python (`flags.is_feature_enabled("…")`). |
| `Banner.jsx` | React SDK `useFlags([...])`, caught by FlagLens's default extra pattern. |
| `typo.ts` | `new_chekout`: the unknown-flag warning and its quick fixes; `dark_mode`: a stale flag. |
| `flagsmith.json` | Flagsmith CLI v2 config. FlagLens reads it to pick the project and default environment. |

`?env=Staging` or `?env=Production` in the shop URL shows what another environment serves.
