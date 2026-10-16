# 01. Architecture

## The stack and why

| Part | Choice | Why |
| --- | --- | --- |
| App | React + Vite PWA, Leaflet map, service worker (Workbox via `vite-plugin-pwa`) | Installs to the home screen on Android and iPhone without an app store, works offline from the last saved state, and Web Push works on both platforms (iPhone only once installed). |
| Server | One Cloudflare Worker in TypeScript, cron every 15 minutes | Same language as the app, so the itinerary and the alert rules are one shared package. Free plan is enough. No server to keep alive. |
| Storage | Cloudflare KV | A key-value store is all that is needed: push subscriptions, alerts already sent, cached forecasts, daily budgets, the last state. |
| Hosting | Cloudflare Pages for the app, with a Pages Function that forwards `/api/*` to the worker through a service binding | The app and its API share one address, so one sign-in (Cloudflare Access) covers both, and the worker needs no public address. |
| Sign-in | Cloudflare Access (Zero Trust, free up to 50 users), email one-time code | Nobody has to create an account; the allow list lives only in Cloudflare, never in the public repo. |
| Push | Standard Web Push with VAPID keys, sent from the worker | No Firebase, no third-party push service. |
| AI | Claude or OpenAI, chosen by one setting (`AI_PROVIDER`) | Used for two things only: screening news headlines (cheap small model) and "re-plan for me" (large model). The owner had credits at OpenAI; Claude code was kept so it can be switched back. |
| Tests | Vitest for unit tests, plus a **trip simulator** that runs the real worker bundle in workerd against recorded data | The owner explicitly wanted a realistic simulation of the outside world, not only unit tests. It caught real alert bugs before any trip day. |

Total running cost for a 12-day trip was estimated at $0 to $12, almost all of it AI calls. Every paid
source is optional and capped per day.

## Folders (inside `<country>-trip/`)

| Folder | What it is |
| --- | --- |
| `shared/` | The itinerary, alert rules, time helpers, emergency data, place texts. Pure functions, used by worker, app and simulator. |
| `shared/src/trip-private.json` | Lodgings and flights. Git-ignored; created from `trip-private.example.json` on `npm install`. Only the worker and the simulator may import it. |
| `worker/` | The Cloudflare Worker: `engine.ts` (one check run), `sources/*` (one file per outside source), `push.ts`, `store.ts` (KV), `access.ts` (Access JWT check), `prompts.ts` (AI prompts shared by both providers), `claude.ts` / `openai.ts` (SDK calls only), `shadow.ts` (side-by-side source comparison). |
| `app/` | The PWA: `screens/*`, `api.ts`, `sw.ts`, `functions/api` (Pages Function to the worker), `functions/tiles` (map tiles with a server-side key). |
| `sim/` | The trip simulator: `scenarios/*.json`, recorded `fixtures/`, `src/world.ts` (answers every fetch), fake push service, Playwright browser check, and the live checks (`check:free`, `check:paid`) that run only by hand. |

## How data flows

1. The cron fires every 15 minutes. `engine.ts` decides which sources are worth calling now
   (weather hourly; drive times only in the 3 hours before a drive; flights from 24 hours before
   departure; news when the budget allows). Before the trip it checks only what is useful in advance.
2. Each source returns raw readings. `shared/src/rules.ts` turns readings into alerts with a stable
   id, a severity, the day they affect and the times they should be pushed.
3. The engine merges alerts, works out each day's status, writes the state to KV **only if it
   changed** (KV free plan allows 1,000 writes a day), and pushes alerts whose push time has come.
4. The app fetches `GET /api/state` on open and on return to the foreground, saves it locally, and
   renders from the saved copy when offline. Hotels and flights come from `GET /api/trip-private`,
   never from the bundle.
5. "Re-plan for me" is `POST /api/replan`: the day, its alerts and its Plan B go to the large model,
   which answers in the travellers' language. Counted against a daily cap.

## Alert timing rules (worth keeping)

- Weather alerts go out the evening before and 2 hours before the stop. Quakes, advisory changes,
  urgent news and flight changes go out at once.
- Quiet hours 22:00 to 06:00 local time; non-urgent pushes wait for the morning.
- A briefing about tomorrow at 20:00.
- Each alert id is pushed once. A push more than 2 hours late is dropped, not sent stale.
- A push that failed with a temporary error is retried, not marked sent.
- A healthchecks.io ping at the end of each run emails the owner when the cron stops.

## Boundaries enforced by tests and lint

- `app/` must never import `@trip/shared/private` (ESLint rule plus `app/test/privacy.test.ts`).
- Nothing in tests, CI or the simulator calls a real source or a paid API: tests block `fetch`,
  the simulator answers from fixtures, the browser check blocks outside hosts.
- New paid calls go through `DAILY_CAPS` in `worker/src/engine.ts`.
