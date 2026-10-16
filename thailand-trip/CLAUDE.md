# Thailand trip app

A trip companion PWA (`app/`), a Cloudflare Worker that watches the sources and sends pushes
(`worker/`), the itinerary and alert rules both use (`shared/`), and a trip simulator (`sim/`).
The README has the full picture; this file is the short list of rules.

## Run and check

All commands run from `thailand-trip/`.

- `npm install` once (it creates `shared/src/trip-private.json` from the example file).
- `npm run check` before every push: type-check, tests, lint and the simulator. CI runs the same
  on every pull request and, once the issue #50 workflow update is applied, a deploy waits for it.
- `npm run dev` for the app, `npm run dev:worker` for the worker.

## Privacy: the repository is public

- Hotel names, flight numbers and anything else from `trip-private.json` never go into git, a
  commit message, a PR, an issue or a screenshot. Use `trip-private.example.json` for examples.
- Only the worker (and `sim/`) may import `@trip/shared/private`. The app gets hotels and
  flights from `GET /api/trip-private`. `app/test/privacy.test.ts` and the ESLint rule
  enforce this; never weaken them.
- Emails, tokens and keys live in Cloudflare or GitHub secrets, never in `wrangler.toml`.

## Paid APIs

- Nothing in CI, tests or the simulator calls a real source or a paid API (Claude, OpenAI,
  Google Routes, AeroDataBox). Tests block `fetch`; the simulator answers from `sim/fixtures`.
- Live checks (`npm run check:free`, `npm run check:paid`) run only by hand on a developer
  machine, never from a workflow.
- New paid calls in the worker go through the daily caps (`DAILY_CAPS` in `worker/src/engine.ts`).

## Conventions

- Prompts and answer schemas shared by both AI providers live in `worker/src/prompts.ts`;
  `claude.ts` and `openai.ts` only call their SDK.
- KV writes are limited (1,000 a day on the free plan): write only when something changed
  (`Store.putIfChanged`).
- User-facing text is Hebrew; code, comments and docs are English.
- Workflow files under `.github/workflows/` can't be pushed from Claude's sessions; prepare the
  file and ask the owner to change it in the GitHub UI.
