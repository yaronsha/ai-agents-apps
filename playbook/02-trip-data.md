# 02. Trip data

## The repository is public

The Thailand repository is public, so trip data is split in two from day one:

| Public, in git (`shared/src/itinerary.ts`) | Private, never in git (`shared/src/trip-private.json`) |
| --- | --- |
| Days, stops with coordinates and times, drives, reminders, Plan B per day | Lodging names, addresses and pins, booking sites |
| Hospitals, emergency numbers, phrases, place texts | Flight numbers, departure times, airlines |
| | Anything that identifies the travellers: names, emails, phone numbers |

Rules that follow:

- Lodgings are referenced from public data by id only (`lodgingId: "cm1"`, drives from `"lodging:cm1"`).
- The private file never appears in a commit, commit message, PR, issue, screenshot or mock. Mocks
  and simulator runs use `trip-private.example.json` or `sim/trip-private.sim.json` with made-up
  hotels and flights.
- The deploy workflow writes the real file from the GitHub secret `TRIP_PRIVATE_JSON` and refuses
  to deploy if it is missing (so the example data is never deployed by accident).
- The app gets lodgings and flights at run time from `GET /api/trip-private`, behind sign-in.
- Keep a copy of the real file somewhere the next session can reach that is not git (a shared
  project folder, a password manager). Note where in your own notes, not in the repo.

If the new repository is private, this split still costs little and keeps the option to publish.

## From an itinerary document to `itinerary.ts`

The Thailand itinerary was a Word document in Google Drive, written by a family member, in Hebrew,
with a day-by-day plan and an expenses table. The conversion that worked:

1. Read the document and list every place, time and drive per day. Write `Stop`, `Drive` and
   `Reminder` entries (`shared/src/types.ts`). Times are local, `"YYYY-MM-DDTHH:mm"`.
2. Mark `outdoor: true` for anything weather can ruin and `highland: true` for summits and cold
   mornings; the weather rules depend on these flags.
3. Write 2 to 3 **Plan B** lines per day, concrete and local ("rain: take the cable car both ways and
   skip the 306 wet stairs"). This is the content the travellers actually read on a bad day.
4. Put the source document name and version date in the file header comment.
5. Report inconsistencies in the document back to the owner instead of guessing: in Thailand the
   dates in the itinerary and the expenses table disagreed, a festival's main night was a day before
   the planned visit, and the return flight number was missing.

The itinerary changes. It was re-synced from Drive three times (PRs 38, 63). A re-sync is its own
PR: diff the new document against `itinerary.ts`, update ids only where the place itself changed
(alert ids and sent-push records depend on stop ids), and list what moved in the PR. A Drive
download right after an edit can briefly return an empty document; download again a few minutes later.

## Coordinates are wrong until checked

Coordinates written from memory or from a single search were off by up to 16 km (the Thailand
lantern festival venue). The check that worked (PR 27):

- Check every stop and hospital against at least two listings (Google Maps, OpenStreetMap,
  Wikipedia, AllTrails, Tripadvisor, Waze, Atlas Obscura, Plus Codes).
- `npm run verify:places` reverse-geocodes every pin with Nominatim and flags the ones that land in
  the wrong village or district. Cloud sessions' proxies often block OSM; run it locally or in Actions.
- Write the date each value was checked in a comment next to it, and keep a list of what is still
  unconfirmed so it gets re-checked before the trip.

## Emergency data (`shared/src/emergency.ts`)

- Local numbers (tourist police, ambulance, police, fire) confirmed from two sources each.
- The travellers' own foreign ministry emergency line and embassy page. In Thailand this was the
  Israeli MFA situation room and the embassy in Bangkok; confirm from the ministry's own site.
- Hospitals near each base with phone numbers, stored in local format and dialled with the country
  code so they work from a roaming SIM.
- 5 to 10 phrases in the local script for the driver ("take us to the hospital", "please drive
  slower", "we need to stop, car sick", "is the road open?", "not spicy").
- Sort hospitals by the phone's location, falling back to the day's first stop when location is off.

## Place texts and "know before you go"

- `shared/src/places.ts`: for each stop, the local-script name (to show a driver), a one-line teaser
  under the stop in the timeline, two or three sentences about the place, and practical tips. Written
  in advance and bundled, so it works with no signal in the mountains.
- Place facts (PR 65, open at the time of writing): opening hours, opening days, entry fee, cash
  only or card/QR, each with its source and the date it was checked, shown in the stop's sheet as
  "know before you go". The worker re-checks today's and tomorrow's stops on the web twice a day,
  and every stop weekly before the trip, and raises an alert when a place is closed or changed.
- Anything not found in a reliable source is marked unknown, never written as fact.

The owner's guiding principle: the travellers want to know everything possible in advance. Prefer
features that surface knowable facts before the day (closures, hours, prices, cash, opening days)
over features that only react on the day.
