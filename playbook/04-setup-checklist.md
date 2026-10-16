# 04. Setup checklist

In order. Each step says who does it: **owner** (needs the owner's accounts or a UI only the owner
can reach) or **Claude** (can be done from a session with the right token). The Thailand README's
[Setup section](../thailand-trip/README.md#setup) has the exact commands.

## 0. Before anything

- [ ] **Owner:** repository on GitHub, and the Claude GitHub app installed on it.
- [ ] **Owner:** free Cloudflare account. An API token for the session with: Workers Scripts Edit,
      Workers KV Storage Edit, Cloudflare Pages Edit, and (for step 5) Access: Apps and Policies Edit,
      Access: Organizations, Identity Providers and Groups Edit. Put it in the session's environment
      as `CLOUDFLARE_API_TOKEN` with `CLOUDFLARE_ACCOUNT_ID`, and allow `api.cloudflare.com` in the
      environment's network settings.
- [ ] **Owner:** decide whether the repo is public. If it is, follow the privacy split in
      [02-trip-data.md](02-trip-data.md) from the first commit.
- [ ] **Owner:** prepaid credit on the AI provider; a Google Cloud key with only the Routes API
      enabled and a daily quota; a RapidAPI subscription to AeroDataBox. All optional.

## 1. Worker

- [ ] **Claude:** create the KV namespace and put its id in `worker/wrangler.toml`.
- [ ] **Claude:** `npm run vapid`; the public key goes in `wrangler.toml`, the private JWK becomes a
      secret. The public key must be on `main` before any deploy from `main`, or push breaks.
- [ ] **Claude or owner:** worker secrets, always as type **Secret**, never Text (a deploy deletes
      Text variables, see [06-lessons-learned.md](06-lessons-learned.md)): `APP_TOKEN`,
      `VAPID_PRIVATE_JWK`, optional `VAPID_CONTACT` (`mailto:`), `OPENAI_API_KEY` or
      `ANTHROPIC_API_KEY`, `GOOGLE_MAPS_KEY`, `RAPIDAPI_KEY`, `HEARTBEAT_URL`.
- [ ] Never write `APP_TOKEN` in the repo, a PR, a chat or notes. If it is lost, set a new one.
- [ ] `AI_PROVIDER` and model names are plain `[vars]` in `wrangler.toml`, deployed with the code.
- [ ] `workers_dev = false`: the worker has no public address; the app reaches it only through
      the Pages Function's service binding.

## 2. App on Cloudflare Pages

- [ ] **Claude:** create the Pages project. Do not give it the same name as the worker (creating
      a Pages project named like the worker failed with an unknown API error; `<name>-app` worked).
- [ ] Service binding `WORKER` in `app/wrangler.toml` to the worker's name.
- [ ] **Owner:** a CARTO basemaps key (free) for English map labels; **Claude:** set it as the Pages
      production secret `CARTO_KEY`. Takes effect on the next Pages deploy.
- [ ] Deploy from `app/`, never from `worker/` (wrangler picks up the wrong `wrangler.toml`).

## 3. GitHub Actions

- [ ] **Owner:** repository secrets `CLOUDFLARE_API_TOKEN` (a token with only Workers, KV and Pages
      edit, not the session's Access token), `CLOUDFLARE_ACCOUNT_ID`, `TRIP_PRIVATE_JSON` (the whole
      private file).
- [ ] **Owner pastes, Claude prepares:** `.github/workflows/<name>-ci.yml` (type-check, tests, lint,
      simulator with browser check on every PR and push to `main`) and `<name>-deploy.yml` (on
      `workflow_run` of a green CI on `main`, deploys the commit CI checked; refuses without
      `TRIP_PRIVATE_JSON`). Claude's GitHub token cannot push workflow files, so Claude writes them to
      a file and the owner pastes them in the GitHub UI. Never wrap paste-ready YAML in code fences.
- [ ] Run the deploy once by hand from the Actions tab and check both deploys succeeded.

## 4. Repository hygiene (owner, in the GitHub UI)

- [ ] Dependabot alerts and security updates, secret scanning, push protection.
- [ ] Actions: workflow permissions read-only; require approval for outside contributors' workflows.
- [ ] A ruleset on `main`: no deletion, no force push, PR required, conversation resolution,
      required status check (the CI job).
- [ ] Optional: a `production` environment limited to `main` holding the Cloudflare secrets.
      Claude's session cannot change repository settings; prepare a step list for the owner.

## 5. Who can open the app (Cloudflare Access)

- [ ] Login method: One-time PIN by email (no setup) or Google.
- [ ] Self-hosted application for `<project>.pages.dev` and `*.<project>.pages.dev`, session 1 month,
      policy Allow with the travellers' emails. The list lives only in Cloudflare.
- [ ] If anything must be reachable from a terminal (the shadow report), a second application for
      that one path with policy Bypass; the worker still asks for `APP_TOKEN` there.
- [ ] Worker secrets `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. From then on the worker answers `/api`
      only for requests signed by Access, and `APP_TOKEN` stops working for normal calls.
- [ ] Writes to Access settings need the owner's explicit OK in the conversation, even with the token.

## 6. Monitoring

- [ ] **Owner:** a free healthchecks.io check (period 15 min, grace 30 min), its ping URL as the
      `HEARTBEAT_URL` secret. It emails when the cron stops, a run fails, or pushes fail.

## 7. Phones (each traveller)

- [ ] Open the app address, sign in with the emailed code.
- [ ] **iPhone:** Share, Add to Home Screen, then open it from the home screen. Web Push works only there.
- [ ] **Android Chrome:** the app shows its own install card; accept it.
- [ ] Turn on notifications from the app's prompt or Settings, then "send test notification".
- [ ] Open every screen once with data on, so the offline copy and map tiles are cached.

## 8. Before the trip

- [ ] Fill flight numbers and departure times in the private file and in `TRIP_PRIVATE_JSON`.
- [ ] Re-sync the itinerary with the latest document; re-check unconfirmed coordinates and numbers.
- [ ] Choose the news source from shadow mode, then set `SHADOW_NEWS = "off"`.
- [ ] Run `npm run check:free` and `npm run check:paid` once on a developer machine.
- [ ] From the day before departure until the end of the trip, merge only fixes to `main`: every
      merge deploys to every phone within minutes. Know how to roll back (README, "Rolling back").
