# Trip simulator

סימולציה של ימי טיול: העולם החיצוני משתנה לפי תרחיש (סופה, מפולת, טיסה מבוטלת, חדשות), ה-worker האמיתי רץ עליו בשעון מואץ, ובודקים שההתראה הגיעה למסך ושנשלח פוש.

The worker's code is not mocked. The real `worker/src` bundle runs in workerd (Cloudflare's runtime, through Miniflare) and its cron handler is called once per 15 simulated minutes. Only the outside world is simulated: every `fetch` the worker makes lands in `src/world.ts`, which answers from recorded responses in `fixtures/`, changed by whatever the scenario has made happen by that moment. Pushes go to a fake push service that decrypts them like a phone would.

```bash
npm run sim                          # every scenario, a few seconds each
npm run sim -- road-to-pai           # one scenario
npm run sim -- --browser             # also open the real app in Chromium (see below)
npm run sim -- storm-pai-canyon --serve   # keep the worker running at :8787 afterwards (access code: sim-token)
npm run sim -- --real-claude         # real Claude news triage instead of the scenario's answers (needs ANTHROPIC_API_KEY)
npm run sim:live                     # check the real sources and re-record the fixtures
```

Each run prints the day as the travellers would live it and writes `reports/<scenario>.md`:

```
09:00  ◆ world   The forecast turns: thunderstorms over Pai Canyon and Yun Lai, 15:00-19:00
09:00  ▲ alert   [warning] סופת רעמים צפוי בשקיעה בקניון פאי  (weather:pai-canyon:storm, 2026-11-26)
14:30  🔔 push    סופת רעמים צפוי בשקיעה בקניון פאי | בין 16:30 ל-18:15. ...
```

followed by the scenario's checks. The command fails if any check fails.

## Scenarios

| File | Day | What happens |
| --- | --- | --- |
| `storm-pai-canyon` | 26.11 | Forecast turns to thunderstorms over the canyon at sunset, then rain over the night market |
| `road-to-pai` | 25.11 | Route 1095 slows, a landslide is in the news, then no route at all, before the 08:30 van |
| `flight-home` | 2–3.12 | Gate change, 90-minute delay, cancellation of the flight home |
| `quake-and-advisory` | 28.11 | M5.6 quake near Chiang Dao (a small one and a far one are ignored), UK advice changes for Chiang Rai |
| `lantern-festival` | 24.11 | Haze over the festival, news that the lantern release is cancelled |
| `rain-scare-inthanon` | 23.11 | Rain forecast for the trail that clears before its push is due: no push |

A scenario is a JSON file in `scenarios/`: a time window, `events` (what the world does and when) and `expect` (what the app must do). The event and check types are documented in `src/scenario.ts`. Times are Thailand local time. Stop and drive ids come from `shared/src/itinerary.ts`; flight ids from `trip-private.sim.json`.

```json
{ "at": "2026-11-26T09:00", "weather": { "stops": ["pai-canyon"], "from": "2026-11-26T15:00", "to": "2026-11-26T19:00", "preset": "storm" } }
{ "at": "2026-11-25T07:15", "traffic": { "drive": "d25-pai", "closed": true } }
{ "at": "2026-12-03T04:30", "flight": { "flight": "ret-1", "status": "Canceled" } }
{ "at": "2026-11-28T09:20", "quake": { "mag": 5.6, "nearStop": "chiang-dao-cave", "km": 60, "place": "Shan State, Myanmar" } }
{ "at": "2026-11-28T10:05", "advisory": { "description": "..." } }
{ "at": "2026-11-25T06:30", "news": { "title": "...", "domain": "bangkokpost.com", "triage": { "severity": "urgent", "affectedDate": "2026-11-25", "titleHe": "...", "bodyHe": "..." } } }
```

Weather presets: `storm`, `heavy-rain`, `cold`, `smoke`, `clear`.

By default a scenario runs on a calm baseline: the recorded temperatures, clouds and air, without the recorded rain and storms, so only the scenario's own events trigger weather warnings. `"baseline": "recorded"` plays the recorded week as it was.

## In the browser

`--browser` builds the app (production build, service worker included), opens it in headless Chromium at phone size with the clock set to the end of the scenario, and checks that the scenario's `screen` texts are on the alerts screen. Then it hands every push the worker sent to the app's service worker, the way the phone's push service would, and checks each one became a notification. Screenshots of the alerts and today screens go to `reports/`.

## Recordings and the live check

`fixtures/` holds one response per source, in that API's exact format. `fixtures/meta.json` says for each source whether it is a real recording (`live`) or a starter file (`seed`, written by `src/seed.ts` from the API documentation with typical late-November values).

`npm run sim:live` calls each real source once through the worker's own fetch and parse code, so a changed API format shows up as a failure, and saves the answers as the new recordings. Weather is recorded for the coming week at every stop and replayed onto the trip days. Free sources always run. Paid ones run when their key is set: `GOOGLE_MAPS_KEY` (records every planned drive), `RAPIDAPI_KEY` with `LIVE_FLIGHT="EY 432 2026-10-20"` (the trip's flights are weeks away, so it checks the format on a flight you name), and `ANTHROPIC_API_KEY` (plants a Route 1095 landslide headline among real ones and checks Claude flags it).

The simulator uses `trip-private.sim.json`, made-up hotels and flight numbers, never the real private file.

## Notes

- Miniflare 4 is used for its stable API. Its own workerd is older than the worker's `compatibility_date`, so `package.json` overrides it with the workerd that wrangler uses.
- The only change the simulator needed in the worker is that the cron handler uses the cron's `scheduledTime` instead of the clock, which is the same thing in production.
