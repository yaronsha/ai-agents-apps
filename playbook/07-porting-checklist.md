# 07. Porting checklist

Every place in `thailand-trip/` that assumes Thailand, Israeli travellers or Hebrew, as of October
2026. Paths are relative to `thailand-trip/`. Re-run the search at the end before trusting the list:

```bash
grep -rniE "thai|bangkok|\+66|utc\+7|asia/|fcdo|chiang|israel|etihad|abu dhabi|1155|1669" \
  --include=*.ts --include=*.tsx --include=*.toml --include=*.json --include=*.html \
  shared app worker sim | grep -v node_modules
```

## Time zone (do this first)

The whole app assumes one fixed offset, UTC+7, no daylight saving.

| Where | What |
| --- | --- |
| `shared/src/time.ts` | `TH_OFFSET_HOURS = 7`, `thLocal`, `thParts`, `thDate`, quiet hours and the 20:00 briefing are all in that offset. Used across shared, app, worker and sim (about 20 files). |
| `shared/src/types.ts` | The header comment: local times are Thailand time. |
| `worker/src/sources/openmeteo.ts` | `timezone=Asia%2FBangkok` in both requests. |
| `worker/src/index.ts` | Preview moments parsed as Thai time. |
| `sim/scenarios/*.json` | All event times are Thailand local time. |

- Same fixed offset, no DST: change the number and the Open-Meteo time zone; rename `th*` to
  `local*` while you are there.
- DST or several time zones: store an IANA zone on the trip (or per day) and convert with
  `Intl.DateTimeFormat` / Temporal. Test the DST switch day in `shared/test`.

## Data sources

| Where | What |
| --- | --- |
| `worker/src/sources/fcdo.ts` | `foreign-travel-advice/thailand` in two URLs. |
| `shared/src/rules.ts` `ROUTE_AREAS` | Regex of region and border names that make an advisory change "on the route". |
| `worker/src/sources/gdelt.ts`, `googlenews.ts` | `PLACES` query: the three northern provinces. Keep the query short (GDELT refuses long ones). |
| `worker/src/shadow.ts` | Place list for the shadow log. |
| `worker/src/prompts.ts` | Triage, advisory and re-plan prompts name "two Israeli tourists on a private-driver trip in northern Thailand" and write Hebrew. |
| `shared/src/rules.ts` `RULES` | Thresholds (rain, cold 12 °C, PM2.5 50, quake M5 / 300 km, traffic ×1.3, delay 30 min) tuned for northern Thailand in late November. |
| `shared/src/rules.ts` `flightAlerts` | Cancel and delay text names one airline and one connection city. Move into the private flight data. |

## Trip data

| Where | What |
| --- | --- |
| `shared/src/itinerary.ts` | The whole plan. Replace. |
| `shared/src/places.ts` | Place texts and Thai-script names. Replace. |
| `shared/src/place-facts.ts` (PR 65) | Hours, fees, cash per stop. Replace. |
| `shared/src/emergency.ts` | Thai emergency numbers, Israeli MFA situation room, embassy URL, hospitals, Thai phrases. Replace all. |
| `shared/src/trip-private.example.json`, `sim/trip-private.sim.json` | Example lodgings and flights. Replace with made-up ones for the new trip. |
| `sim/scenarios/*`, `sim/fixtures/*`, `sim/src/places.ts` | Scenarios and recordings for Thai places and dates. Write new scenarios for the new trip's real risks; re-record fixtures. |

## App

| Where | What |
| --- | --- |
| `app/src/screens/Emergency.tsx` | `+66` dialling, `1155` as the big button. |
| `app/src/screens/Sheets.tsx`, `Emergency.tsx` | `lang="th"` on local-script names and phrases. |
| `app/index.html` | `lang="he" dir="rtl"`. |
| `app/src/main.tsx` | Hebrew subsets of the Assistant and Secular One fonts. |
| `app/src/format.ts` and every screen | Hebrew UI strings, Hebrew weekday names, `d.m` dates. |
| `app/src/sw.ts` | Comment about Thai fallback tiles (behaviour is generic). |

## Names and infrastructure

| Where | What |
| --- | --- |
| `worker/wrangler.toml` | Worker name `thailand-trip`, KV id, VAPID public key (generate new keys per app). |
| `app/wrangler.toml` | Pages project `thailand-trip-app`, service binding to the worker name. |
| `worker/src/push.ts` | `DEFAULT_CONTACT` is the Pages address. |
| `.github/workflows/thailand-trip-*.yml` | Paths, names, `PAGES_PROJECT`. New files per app (owner pastes them). |
| `package.json`, `CLAUDE.md`, `README.md` | Names and the trip description. |

## Template refactor

Worth doing before the second trip. The goal: a new trip is a new data folder plus keys.

1. **One trip config** (`trip/config.ts` or JSON): country code, IANA time zone, travellers'
   language and text direction, travellers' nationality (embassy, advisory source), currency,
   emergency numbers, dialling code, region names for news and advisory, rule thresholds.
2. **Trip content files** next to it: itinerary, places, place facts, hospitals, phrases, Plan B.
   `shared/` exports them; nothing else imports a country-specific file.
3. **Time helpers take the zone from the config** (see above).
4. **Sources become pluggable**: each `sources/*.ts` exports `{ name, enabled(config), fetch, toAlerts }`,
   and the engine loops over the enabled ones. Today `runCheck` in `worker/src/engine.ts` calls
   each source by hand.
5. **UI strings in one file per language** (`app/src/i18n/he.ts`), with `dir` from the config. Rename
   `nameHe` / `titleHe` / `bodyHe` to `name` / `title` / `body` once there is more than one language,
   or keep `He` if every trip is for Hebrew speakers.
6. **Prompts take the config** (who the travellers are, where, which language to answer in).
7. **Infrastructure names from one place** (worker, Pages project, KV) so the workflows and both
   `wrangler.toml` files can be generated or templated.
8. Keep `thailand-trip` as the first instance of the template and keep its simulator scenarios
   passing; they are the regression suite.
