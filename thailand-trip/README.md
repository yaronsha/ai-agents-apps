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
| GDELT | News about the route, screened by Claude or OpenAI | Free (the model is paid) |
| Google Routes API | Traffic-aware drive time in the 3 h before each drive | Paid, optional |
| AeroDataBox (RapidAPI) | Delays, gate changes, cancellations | Paid, optional |
| Claude API or OpenAI API | News triage and "re-plan for me" (pick one with `AI_PROVIDER`) | Paid, optional |

Every paid source is optional; without its key the app simply skips it. Daily caps in `worker/src/engine.ts` (`DAILY_CAPS`: 100 route calls, 60 flight calls, 60 news-triage calls) stop a bug from running up a bill.

## Privacy

This repository is public, so hotel names and flight numbers are not committed. They live in `shared/src/trip-private.json`, which is git-ignored. `npm install` copies `trip-private.example.json` to it if it is missing; replace it with your real file. Set `number` and `departLocal` on each flight to turn on flight tracking.

Only the worker bundles this file (through `@trip/shared/private`). The app is built from the itinerary alone and fetches hotels and flights from `GET /api/trip-private`, which, like `/api/state`, needs a signed-in allowed email (see [Who can open the app](#4-who-can-open-the-app)) or, before that is set up, the access code. Never import `@trip/shared/private` from `app/`.

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

The app is a Cloudflare Pages project (`app/wrangler.toml`). It calls `/api/*` on its own address, and the Pages Function in `app/functions/api/` hands those calls to the worker through a service binding, so the app and the API share one address and one sign-in. Build with `npm run build -w app`, then deploy from `app/` with `npx wrangler pages deploy`. Locally, `npm run dev` proxies `/api` to the worker on port 8787.

Open the site, go to **הגדרות** and tap **הפעלת התראות**, then **שליחת התראה בדיקה**. Until Cloudflare Access is set up, the settings screen also asks for the `APP_TOKEN`.

**iPhone:** Web Push works only after adding the site to the home screen (Share → Add to Home Screen) and opening it from there.

### 3. Automatic deploy from main

`.github/workflows/thailand-trip-deploy.yml` runs on every push to `main` that touches `thailand-trip/`: it type-checks, runs the tests, builds the app, then deploys the worker and the Pages project `thailand-trip-app`. Other branches and pull requests never deploy. It can also be run by hand from the Actions tab (on `main` only).

Repository secrets it needs (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token with Workers Scripts: Edit, Workers KV Storage: Edit and Cloudflare Pages: Edit |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account id |
| `TRIP_PRIVATE_JSON` | The full contents of `shared/src/trip-private.json` |

Worker secrets (`APP_TOKEN`, `VAPID_PRIVATE_JWK`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and the optional keys) stay in Cloudflare; a deploy keeps them.

### 4. Who can open the app

Cloudflare Access (Zero Trust, free up to 50 users) puts a sign-in page in front of the app: Google, or a one-time code sent by email. Only emails on the allow list get in. The list lives only in the Zero Trust dashboard, never in this repository.

1. **Zero Trust → Settings → Authentication → Login methods:** add Google (or keep "One-time PIN" alone, which needs no setup).
2. **Zero Trust → Access → Applications → Add → Self-hosted:** domain `thailand-trip-app.pages.dev`, session duration 1 month. Add a policy: Action *Allow*, Include *Emails* (or an email *List* from **My Team → Lists**). Then also add `*.thailand-trip-app.pages.dev` so preview deployments are covered.
3. From the application's **Overview**, copy the *Application Audience (AUD) Tag*; the team domain (`<team>.cloudflareaccess.com`) is shown under **Settings** as *Team domain*.
4. **Workers → thailand-trip → Settings → Variables and Secrets:** add both as type *Secret*: `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. From then on the worker answers `/api` only for requests signed by Access, and the access code stops working.

To add someone, add their email to the policy or list; it works at once. To remove someone, delete the email and revoke their session in **Access → Users**. The worker's `workers.dev` address stays reachable, but without a valid Access token it serves nothing private. Cron runs inside Cloudflare and needs no sign-in.

## How alerts work

- Weather alerts go out the evening before and 2 hours before the stop. Quakes, advisory changes, urgent news and flight changes go out at once.
- Quiet hours are 22:00–06:00 Thailand time; non-urgent pushes wait until morning. A briefing about tomorrow goes out at 20:00.
- Each push is sent once. A push more than 2 hours late is dropped.
- Thresholds are in `shared/src/rules.ts` (`RULES`).

## Notes

- Stop and hospital coordinates are approximate. Check them before the trip, especially the lantern festival and Akha Kitchen.
- Check the Israeli emergency number in `shared/src/emergency.ts` before you go.
- `AI_PROVIDER` in `wrangler.toml` picks who runs news triage and re-plan: `"claude"` (default) or `"openai"`. Both use the same prompts. The models are set next to it (`CLAUDE_TRIAGE_MODEL`, `CLAUDE_REPLAN_MODEL`, `OPENAI_TRIAGE_MODEL`, `OPENAI_REPLAN_MODEL`). Claude re-plan uses server-side fallback, so it still answers if the main model is busy.
