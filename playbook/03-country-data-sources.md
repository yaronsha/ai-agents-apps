# 03. Data sources per country

Start every new trip with this table. For each row, decide: keep as is, change a parameter, replace
the source, or drop it. Write the answers in a short brainstorm document with costs before any code.

## Sources in the Thailand app

| Source | Used for | Coverage | Cost | For a new country |
| --- | --- | --- | --- | --- |
| [Open-Meteo](https://open-meteo.com) forecast | Rain, thunder, temperature, low and high cloud per stop and hour | Global | Free, no key | Keep. Change the `timezone=` parameter (`Asia/Bangkok`) in `worker/src/sources/openmeteo.ts`. |
| Open-Meteo air quality | PM2.5 per stop | Global | Free | Keep. Matters most where there is seasonal burning or smog; the threshold is `RULES.pm25`. |
| [USGS earthquakes](https://earthquake.usgs.gov/fdsnws/event/1/) | M5+ within 300 km of the day's stops | Global | Free | Keep. Tune `quakeMag` / `quakeKm` for the region. |
| [GOV.UK FCDO travel advice](https://www.gov.uk/foreign-travel-advice) (Content API) | Changes to the official travel advice, translated by the AI model | Every country | Free | Keep, change the country slug in `worker/src/sources/fcdo.ts`. The Israeli travellers used the UK advice because it has a clean, free JSON API; check whether the travellers' own government publishes one. Also update `ROUTE_AREAS` in `shared/src/rules.ts` (which region names count as "on the route"). |
| [GDELT](https://www.gdeltproject.org) DOC API | Local news mentioning the route, screened by the AI model | Global | Free (the model is paid) | Weak: the index lagged up to 37 hours, so a 24 h query returned nothing, and it rate-limits shared addresses. The query must stay short (a 252-character query was refused). |
| Google News RSS (`news.google.com/rss/search`, `when:1d`) | Same, as an alternative | Global | Free | Ran in **shadow mode** next to GDELT (logged, no alerts) to compare before switching. It found real local flood news within hours. Probably the better default; confirm with shadow mode. |
| [Google Routes API](https://developers.google.com/maps/documentation/routes) | Traffic-aware drive time and "no route" in the 3 hours before each drive | Global, quality varies | Paid, optional (Pro SKU, 5,000 free a month; a trip used a few hundred) | Keep where there is road traffic data. |
| [AeroDataBox](https://rapidapi.com/aedbx-aedbx/api/aerodatabox) on RapidAPI | Delays, gate changes, cancellations | Global | Paid, optional (free tier, or about $7.50 a month) | Keep. Turn on per flight by filling `number` and `departLocal` in the private file. |
| Claude or OpenAI | News screening (small model), advisory translation, "re-plan for me" (large model) | n/a | Paid, optional | Keep. Prompts in `worker/src/prompts.ts` name the travellers and the region; rewrite them. |
| AI web search (PR 65) | Closures and changes at each stop | n/a | Paid, capped at 8 a day | Keep. Most attractions have no official site, only Facebook, which cannot be read automatically. National park and local news sites are what actually report closures. |
| CARTO Voyager map tiles via Pages Function | English place names on the map | Global | Free tier, needs a key | Keep. OSM's default tiles show names in the local script. |

## Questions to answer per country

- **Time zone and daylight saving.** Thailand is UTC+7 with no DST, and the code assumes a fixed
  offset (`TH_OFFSET_HOURS`, `thLocal`). A country with DST, or a trip across time zones, needs real
  time-zone handling before anything else. See [07-porting-checklist.md](07-porting-checklist.md).
- **What actually disrupts trips there?** Thailand: monsoon tail and mountain storms, landslides on
  mountain roads, seasonal smoke, festivals that close roads. Elsewhere it may be snow and avalanche
  warnings, strikes, wildfires, heat, ferry cancellations, rail delays. Add a source for each real
  risk, and drop the ones that do not apply.
- **National warning service.** Most countries have a weather service with official warnings
  (often CAP feeds, e.g. MeteoAlarm in Europe). These are better than inferring warnings from a
  forecast. The Thailand app infers warnings from the Open-Meteo forecast instead.
- **Local news in English?** If not, the news query and the screening prompt need the local language.
- **Parks and attractions.** Find the authority that publishes closures (Thailand: the Department of
  National Parks and Thai news sites reported closures within a day).
- **Public transport or ferries** if the trip uses them: a source for delays and cancellations.
- **Payment.** Cash only, card, or local QR (Thailand's PromptPay) per place: part of place facts.
- **Phones.** Will the travellers have data (local SIM or eSIM)? The app must still work offline from
  the last saved state, and say clearly when it is offline.

## Verifying sources before relying on them

- `npm run check:free` checks every free source for format and plausible values, against a second,
  independent source where one exists. `npm run check:paid` does the same for paid sources, prints
  each call and its cost, and asks first. Both run only by hand, never from CI.
- `npm run check:free -- --record` saves the real answers as the simulator's new fixtures, so the
  simulator stays realistic. `sim/fixtures/meta.json` says which fixtures are real recordings and
  which are starter files written from the API docs. Commit new fixtures after `npm run sim` passes.
- Before switching a source, run both in shadow mode for a couple of weeks and compare with
  `npm run shadow:report`.

## Cost guardrails

- `DAILY_CAPS` in `worker/src/engine.ts` (Thailand: 100 route calls, 60 flight calls, 60 news
  screenings, 20 re-plans, 8 place checks a day).
- Paid calls run only on or just before trip days, and only in the window where they matter.
- Prepaid credit (Claude, OpenAI) and a daily quota on the Google key, so a bug cannot run up a bill.
- Before choosing a paid source, check the official price page and write the expected cost for the
  whole trip in the brainstorm document.
