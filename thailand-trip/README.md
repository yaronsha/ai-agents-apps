# Thailand Trip

אפליקציית טיול לצפון תאילנד (22.11–03.12.2026): מסלול יומי, מפה, בלת"מים עם תוכנית ב', התראות פוש ומסך חירום.

A trip companion PWA for a northern Thailand road trip. It watches weather, air quality, earthquakes, the UK travel advisory, local news, live drive times and flight status, and pushes a notification when something on the plan needs to change.

## What's inside

| Folder | What it is |
| --- | --- |
| `shared/` | The itinerary, the alert rules and time helpers, used by both sides. Tested with Vitest. |
| `worker/` | A Cloudflare Worker. A cron runs every 15 minutes, checks the sources, saves state in KV and sends Web Push. |
| `app/` | The PWA (React + Vite + Leaflet). Hebrew, RTL, works offline with the last known state. |

Screens: **היום** (today's timeline with forecast per stop and a green/yellow/red status), **מפה** (the day's route, hotels, hospitals, "where am I"), **בלת"מים** (active alerts, prepared Plan B, and "re-plan for me" with Claude), **חירום** (emergency numbers, nearest hospitals, Thai phrases), **הגדרות** (server, push, preview the engine at any moment of the trip).

## Data sources

| Source | Used for | Cost |
| --- | --- | --- |
| Open-Meteo forecast + air quality | Rain, storms, cold, PM2.5, sea-of-clouds chance | Free |
| USGS earthquakes | M5+ within 300 km | Free |
| GOV.UK FCDO Thailand advice | Advisory changes | Free |
| GDELT | News about the route, screened by Claude | Free (Claude is paid) |
| Google Routes API | Traffic-aware drive time in the 3 h before each drive | Paid, optional |
| AeroDataBox (RapidAPI) | Delays, gate changes, cancellations | Paid, optional |
| Claude API | News triage and "re-plan for me" | Paid, optional |

Every paid source is optional; without its key the app simply skips it. Daily caps in `worker/src/engine.ts` (`DAILY_CAPS`: 100 route calls, 60 flight calls, 60 Claude calls) stop a bug from running up a bill.

## Privacy

This repository is public, so hotel names and flight numbers are not committed. They live in `shared/src/trip-private.json`, which is git-ignored. `npm install` copies `trip-private.example.json` to it if it is missing; replace it with your real file. Set `number` and `departLocal` on each flight to turn on flight tracking.

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
npx wrangler secret put ANTHROPIC_API_KEY    # optional
npx wrangler secret put GOOGLE_MAPS_KEY      # optional, Routes API enabled
npx wrangler secret put RAPIDAPI_KEY         # optional, subscribed to AeroDataBox
npm run deploy
```

For local development put the same values in `worker/.dev.vars` and run `npm run dev:worker` from `thailand-trip/`.

### 2. App

Deploy `app/` to any static host. With Cloudflare Pages: build command `npm run build -w app`, output `app/dist`, root `thailand-trip`, and the environment variable `VITE_API_URL` set to the worker address (see `app/.env.example`).

Open the site, go to **הגדרות**, check the server address, enter the `APP_TOKEN` and tap **הפעלת התראות**, then **שליחת התראה בדיקה**.

**iPhone:** Web Push works only after adding the site to the home screen (Share → Add to Home Screen) and opening it from there.

## How alerts work

- Weather alerts go out the evening before and 2 hours before the stop. Quakes, advisory changes, urgent news and flight changes go out at once.
- Quiet hours are 22:00–06:00 Thailand time; non-urgent pushes wait until morning. A briefing about tomorrow goes out at 20:00.
- Each push is sent once. A push more than 2 hours late is dropped.
- Thresholds are in `shared/src/rules.ts` (`RULES`).

## Notes

- Stop and hospital coordinates are approximate. Check them before the trip, especially the lantern festival and Akha Kitchen.
- Check the Israeli emergency number in `shared/src/emergency.ts` before you go.
- The Claude models are set in `wrangler.toml` (`CLAUDE_TRIAGE_MODEL`, `CLAUDE_REPLAN_MODEL`). Re-plan uses server-side fallback, so it still answers if the main model is busy.
