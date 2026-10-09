# Thailand Trip

אפליקציית טיול לצפון תאילנד (22.11–03.12.2026): מסלול יומי, מפה, בלת"מים עם תוכנית ב', התראות פוש ומסך חירום.

A trip companion PWA for a northern Thailand road trip. It watches weather, air quality, earthquakes, the UK travel advisory, local news, live drive times and flight status, and pushes a notification when something on the plan needs to change.

## What's inside

| Folder | What it is |
| --- | --- |
| `shared/` | The itinerary, the alert rules and time helpers, used by both sides. Tested with Vitest. |
| `worker/` | A Cloudflare Worker. A cron runs every 15 minutes, checks the sources, saves state in KV and sends Web Push. |
| `app/` | The PWA (React + Vite + Leaflet). Hebrew, RTL, works offline with the last known state. |
| `sim/` | Trip simulator: plays scenario days (storm, landslide, cancelled flight, quake, news) through the real worker on a fast clock and checks the alerts, pushes and screens. See [sim/README.md](sim/README.md). |

Screens: **היום** (today's timeline with forecast per stop and a green/yellow/red status), **מפה** (the day's route, hotels, hospitals, "where am I"), **בלת"מים** (active alerts, prepared Plan B, and "re-plan for me" with Claude or OpenAI), **חירום** (emergency numbers, nearest hospitals, Thai phrases), **הגדרות** (server, push, preview the engine at any moment of the trip).

## Data sources

| Source | Used for | Cost |
| --- | --- | --- |
| Open-Meteo forecast + air quality | Rain, storms, cold, PM2.5, sea-of-clouds chance | Free |
| USGS earthquakes | M5+ within 300 km | Free |
| GOV.UK FCDO Thailand advice | Advisory changes | Free |
| Google News RSS | News about the route, screened by OpenAI or Claude | Free (the model is paid) |
| Google Routes API | Traffic-aware drive time in the 3 h before each drive | Paid, optional |
| AeroDataBox (RapidAPI) | Delays, gate changes, cancellations | Paid, optional |
| Claude API or OpenAI API | News triage and "re-plan for me" (pick one with `AI_PROVIDER`) | Paid, optional |

Every paid source is optional; without its key the app simply skips it. Daily caps in `worker/src/engine.ts` (`DAILY_CAPS`: 100 route calls, 60 flight calls, 60 news-triage calls) stop a bug from running up a bill.

## Privacy

This repository is public, so hotel names and flight numbers are not committed. They live in `shared/src/trip-private.json`, which is git-ignored. `npm install` copies `trip-private.example.json` to it if it is missing; replace it with your real file. Set `number` and `departLocal` on each flight to turn on flight tracking.

Only the worker bundles this file (through `@trip/shared/private`). The app is a public site, so it is built from the itinerary alone and fetches hotels and flights from `GET /api/trip-private`, which, like `/api/state`, needs the access code. Never import `@trip/shared/private` from `app/`.

## Setup

Requires Node 20+ and a free Cloudflare account.

```bash
cd thailand-trip
npm install
npm test
```

### 1. Worker

```bash
cd worker
npx wrangler login
# The KV namespace already exists; its id is in wrangler.toml
npm run vapid                                # prints a public key and a private JWK
```

Put the public key in `VAPID_PUBLIC_KEY` and your email in `VAPID_CONTACT` in `wrangler.toml`, then set the secrets:

```bash
npx wrangler secret put APP_TOKEN            # any shared code; you type it into the app once
npx wrangler secret put VAPID_PRIVATE_JWK    # the JSON line from npm run vapid
npx wrangler secret put ANTHROPIC_API_KEY    # optional, when AI_PROVIDER = "claude"
npx wrangler secret put OPENAI_API_KEY       # optional, when AI_PROVIDER = "openai"
npx wrangler secret put GOOGLE_MAPS_KEY      # optional, Routes API enabled
npx wrangler secret put RAPIDAPI_KEY         # optional, subscribed to AeroDataBox
npm run deploy
```

For local development put the same values in `worker/.dev.vars` and run `npm run dev:worker` from `thailand-trip/`.

### 2. App

Deploy `app/` to any static host. With Cloudflare Pages: build command `npm run build -w app`, output `app/dist`, root `thailand-trip`, and the environment variable `VITE_API_URL` set to the worker address (see `app/.env.example`).

Open the site, go to **הגדרות**, check the server address, enter the `APP_TOKEN` and tap **הפעלת התראות**, then **שליחת התראה בדיקה**.

**iPhone:** Web Push works only after adding the site to the home screen (Share → Add to Home Screen) and opening it from there.

### 3. Automatic deploy from main

`.github/workflows/thailand-trip-deploy.yml` runs on every push to `main` that touches `thailand-trip/`: it type-checks, runs the tests, builds the app with `VITE_API_URL` set to the worker, then deploys the worker and the Pages project `thailand-trip-app`. Other branches and pull requests never deploy. It can also be run by hand from the Actions tab (on `main` only).

Repository secrets it needs (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token with Workers Scripts: Edit, Workers KV Storage: Edit and Cloudflare Pages: Edit |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account id |
| `TRIP_PRIVATE_JSON` | The full contents of `shared/src/trip-private.json` |

Worker secrets (`APP_TOKEN`, `VAPID_PRIVATE_JWK` and the optional keys) stay in Cloudflare; a deploy keeps them.

## Checks

- **Offline, on GitHub:** `.github/workflows/thailand-trip-ci.yml` runs `npm run typecheck`, `npm test` and `npm run sim -- --browser` on every pull request and push to `main`. None of it calls a real source or a paid API.
- **Live, only by hand on your machine:** copy `.env.example` to `.env` and fill in the keys, then `npm run check:free` (free sources: format, plausible values, and a second independent source for each) and `npm run check:paid` (Routes, AeroDataBox, OpenAI or Claude; prints the calls and their cost and asks first). Details in [sim/README.md](sim/README.md#offline-in-ci-live-only-by-hand).

## How alerts work

- Weather alerts go out the evening before and 2 hours before the stop. Quakes, advisory changes, urgent news and flight changes go out at once.
- Quiet hours are 22:00–06:00 Thailand time; non-urgent pushes wait until morning. A briefing about tomorrow goes out at 20:00.
- Each push is sent once. A push more than 2 hours late is dropped.
- Thresholds are in `shared/src/rules.ts` (`RULES`).

## News shadow mode

News alerts come from Google News; GDELT, the previous source, lags more than a day, so its 24-hour query came back empty. To confirm the choice on real data, the worker also logs both side by side without acting on the log: once an hour it fetches Google News (past day), GDELT 24 h and GDELT 3 d, and logs for each whether it answered, how many headlines, how old the newest one is, how many mention a place on the route, and the first 10 titles. The log sends no alerts and no pushes. One KV write an hour (`shadow:news:<date>`, kept 45 days); the code is in `worker/src/shadow.ts`.

- `SHADOW_NEWS` in `wrangler.toml`: `"on"` (default) or `"off"`.
- `SHADOW_AI`: `"off"` (default). `"on"` sends each source's past-day headlines to the news triage once a day, from 08:00 Thailand time, and logs how many it judged relevant. That is at most 2 triage runs a day (each one or two calls), counted in the same daily cap as the real triage.
- Cost: $0 with `SHADOW_AI` off.
- Read it with `npm run shadow:report` (uses `WORKER_URL` and `APP_TOKEN` from `.env`, or asks for the code). It prints success rate, lag, headline and route-mention counts per source with a verdict, and writes `sim/reports/shadow-news.md`. The raw log is `GET /api/shadow?days=21` with the access code.
- After choosing a source, set `SHADOW_NEWS = "off"` (or remove the shadow code).

## Notes

- Stop and hospital coordinates are approximate. Check them before the trip, especially the lantern festival and Akha Kitchen.
- Check the Israeli emergency number in `shared/src/emergency.ts` before you go.
- `AI_PROVIDER` in `wrangler.toml` picks who runs news triage and re-plan: `"openai"` (current) or `"claude"`. Both use the same prompts. The models are set next to it (`OPENAI_FILTER_MODEL`, `OPENAI_TRIAGE_MODEL`, `OPENAI_REPLAN_MODEL` and the `CLAUDE_*` ones).
- News triage is two calls. The filter model (`gpt-5.4-nano`) reads every new headline with the whole itinerary and the flights, and answers only with the numbers of those that could matter, so most hours cost one small call. Only if it keeps any does the triage model (`gpt-5.4-mini`) write severity, date and the Hebrew text for those. `npm run check:paid` tests both steps on planted headlines with known answers, 3 times each.
- Claude re-plan uses server-side fallback, so it still answers if the main model is busy.
