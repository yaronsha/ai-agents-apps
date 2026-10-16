# Trip companion app playbook

How to build a trip companion app like [`thailand-trip/`](../thailand-trip/) for any country and any
itinerary. It is written for a fresh Claude session (or a person) that has this repository and these
files, and nothing else: none of the project threads, memory or chat history the Thailand app was
built in. Everything that lived only there and still matters is written down here.

The Thailand app is the reference implementation. When this playbook and the code disagree on a
detail, the code on `main` is right; when they disagree on *why*, this playbook is.

## What the app is

A phone-first PWA for a family road trip with a private driver, used by non-technical travellers:

- **Today**: the day's timeline (stops, drives, reminders, the night's lodging), a forecast per stop,
  and one green / yellow / red status for the day.
- **Map**: the day's route, lodgings, hospitals, "where am I".
- **Alerts** (in Hebrew, "בלת"מים"): what is going wrong, a prepared Plan B per day, and
  "re-plan for me" with an AI model.
- **Emergency**: local emergency numbers, the traveller's own embassy and foreign ministry, nearest
  hospitals by the phone's location, phrases in the local language to show a driver.
- **Settings**: push on/off, test push, what the app checks and when each source last answered.
- A Cloudflare Worker checks weather, air quality, earthquakes, the travel advisory, local news,
  live drive times and flight status every 15 minutes, and sends a Web Push when something on the
  plan needs to change. Everything knowable in advance (opening days, hours, fees, cash only) is
  shown before the day, not discovered on it.

## Files

| File | Read it when |
| --- | --- |
| [01-architecture.md](01-architecture.md) | Before writing code: the stack, the folders, how data flows, and why each choice was made |
| [02-trip-data.md](02-trip-data.md) | Turning an itinerary document into trip data; what is public and what is private; verifying places |
| [03-country-data-sources.md](03-country-data-sources.md) | Choosing the data sources for a new country: what is global, what was Thailand-only, what to replace it with |
| [04-setup-checklist.md](04-setup-checklist.md) | Accounts, Cloudflare, secrets, sign-in, push and install, in order |
| [05-working-method.md](05-working-method.md) | How the work was run: mocks first, a reviewer per PR, the simulator, decisions, the owner's preferences |
| [06-lessons-learned.md](06-lessons-learned.md) | Before every deploy and every "why is this broken": the traps already hit once |
| [07-porting-checklist.md](07-porting-checklist.md) | Every place in the code that is Thailand-, Israel- or Hebrew-specific, and the template refactor |
| [08-build-order.md](08-build-order.md) | The order to build things in, based on the PR history of the Thailand app |

## Starting a new trip with a fresh session

1. Give the session this repository and the itinerary document (Drive link or file).
2. Tell it to read `playbook/` in order before doing anything, then `thailand-trip/CLAUDE.md` and
   `thailand-trip/README.md`.
3. A kick-off message that works:

   > Read playbook/ and thailand-trip/CLAUDE.md. We are building the same app for
   > \<country\>, \<dates\>, itinerary in \<link\>. Travellers: \<who, which language, which
   > nationality (for embassy and advisory)\>. Start with 08-build-order.md phase 0: brainstorm the
   > sources for this country (03-country-data-sources.md) and the costs, as a document, no code.

4. Expect the session to ask for the things only you have: the itinerary, flight numbers, a
   Cloudflare account, API keys, and which emails may open the app. Everything else it should
   decide, say which default it picked, and keep going.

If the new session gets stuck on something this playbook does not cover, that is a gap in the
playbook: add it here in the same PR as the fix.

## Two options for the code

- **Copy and adapt** (fastest for one trip): copy `thailand-trip/` to `<country>-trip/`, then go
  through [07-porting-checklist.md](07-porting-checklist.md) top to bottom.
- **Turn it into a template** (better from the second trip on): do the refactor in
  [07-porting-checklist.md § Template refactor](07-porting-checklist.md#template-refactor) first,
  so a new trip is mostly a new `trip/` data folder.

Either way, keep the Thailand app working: it is the regression test for the template.
