# 06. Lessons learned

Traps the Thailand app hit once. Each one cost a deploy, a day, or a broken feature.

## Cloudflare

- **Dashboard "Text" variables are deleted on every deploy.** `wrangler deploy` replaces the worker's
  plain variables with `[vars]` from `wrangler.toml`. Two API keys added in the dashboard as Text
  were wiped by the next merge to `main`, silently turning off AI and drive times. Add keys only as
  type **Secret** (or `wrangler secret put`). Check with the API:
  `GET accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/<worker>/settings`.
- **Deploy the app from `app/`.** Run from elsewhere, wrangler finds `worker/wrangler.toml` and
  deploys the wrong thing.
- **Pages project name must differ from the worker name**, or project creation fails with an
  unknown error.
- **The VAPID public key must be on `main` before the first deploy from `main`**, or every existing
  push subscription breaks.
- **KV free plan: 1,000 writes a day.** A cron every 15 minutes writing a few keys each run uses
  most of it. Write only when the value changed (`Store.putIfChanged`).
- **Concurrent writes to one KV key lose data.** Two phones subscribing at the same moment
  could overwrite each other (found in the audit). Use one key per subscription, or re-read and retry.
- **CARTO raster tiles need a key** (keyless tiles are stamped "API KEY REQUIRED"). Fetch them
  through a Pages Function that adds the key; fall back to OSM tiles (local-script labels) without it.
- **Service worker `skipWaiting` means a deploy reaches every phone at once.** Good for fixes,
  dangerous during the trip. Freeze `main` to fixes only while travelling; know the rollback.

## GitHub and the Claude session

- **Claude's GitHub token cannot push `.github/workflows/*`**, by git or the file API, even after
  the owner tried granting the scope. Prepare the file and the edit URL; the owner pastes it.
  Never put the paste-ready YAML inside a Markdown code fence: a fence once broke the YAML.
- **Claude cannot change repository settings** (rulesets, security settings, environments) through
  the session's proxy. Prepare a numbered step list with URLs.
- **Claude acts on GitHub as the owner's account**, so it cannot approve its own PRs and CODEOWNERS
  does not help. Review comes from a separate reviewer session, not from GitHub approvals.
- **Merges are not noticed unless someone subscribes to the PR.** Two merged PRs were missed
  because no session was subscribed; reviewer sessions subscribe.
- **The deploy must wait for CI.** At first it ran in parallel with CI on every push to `main`;
  it now runs only after the CI workflow succeeds, and deploys exactly the commit CI checked.

## The cloud session's network

- The session's proxy blocked `*.workers.dev`, `*.pages.dev`, Open-Meteo, USGS, gov.uk, GDELT,
  OpenStreetMap / Nominatim / Overpass, Wikipedia and most map sites. Plan for it:
  - Live checks of the deployed app happen on a phone.
  - Recording real source answers ran in GitHub Actions or on a developer machine.
  - Place and coordinate checks relied on web search snippets when pages could not be opened.
  - Map screenshots from the session have no tiles.
- Ask the owner to allow the needed hosts in the environment's network settings early; it is
  cheaper than workarounds.

## Data sources

- **GDELT's index lags more than a day.** A `timespan=24h` query returned nothing for days. It also
  rate-limits shared CI addresses and drops connections, and refuses long queries. Compare it with
  Google News RSS in shadow mode before relying on either.
- **Google News RSS ignores `after:` / `before:` for old ranges**, so past events cannot be
  back-tested with it.
- **Coordinates from memory are wrong**, sometimes by kilometres. Verify every pin (see
  [02-trip-data.md](02-trip-data.md)).
- **Festival dates differ between sources** (the main Loy Krathong night was 24.11 in Thai sources,
  25.11 in some English ones). Prefer local-language sources and tell the owner when they disagree.
- **Most attractions have no website, only Facebook**, which cannot be read automatically.
  National park authorities and local news report closures; search those.
- **Flight lookups can return the wrong flight.** If no result matches the departure airport,
  return nothing rather than the first result.

## The worker

- **Set timeouts on every outside call.** The AI SDKs default to 10 minutes with 2 retries; one
  slow call could delay a road-closure push past the next cron run.
- **A failed push must not be marked sent.** Retry temporary failures (5xx, 429, network) until the
  push is too late to matter.
- **Lock the cron run** (a KV key with a short TTL) so two runs never overlap and double-push.
- **Count every paid route in the daily caps**, including user-triggered ones like "re-plan for me".
- **Validate every API input** (dates, JSON bodies) and answer 400, not 500.
- **Make the alert text generic.** The flight-cancel text named one airline and one connection
  city for every flight; keep such details in the private trip data.

## The app

- **Never refetch-and-refit the map on every state refresh**: it jumped while the user was panning.
  Fit only when the day changes.
- **Guard every `JSON.parse` of saved state** and tolerate fields missing from older versions.
- **Ignore a slower, older response** when two refreshes race.
- **Switch to today after midnight** if the user did not pick a day by hand.
- **Dark mode reaches third-party widgets too** (Leaflet popups stayed white).
- **Numbers in right-to-left text**: wrap ranges like "25°–29°" in an LTR span, or they read backwards.
- **On a bad day, Plan B goes at the top**, open, under the status bar.
- **iPhone Web Push only works from the home-screen app.** Say so in the push prompt.
- **A push payload that is not JSON must still show a notification**, or iOS may drop the subscription.
