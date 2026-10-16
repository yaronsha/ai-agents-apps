# 08. Build order

The Thailand app took about two weeks, from the first brainstorm on 3 October 2026 to a
feature-complete app with an audit and its fixes, for a trip starting 22 November. This is the order
that worked, with the PRs that did each step, so a new trip can follow it with fewer detours.

## Phase 0: Brainstorm (no code)

- Read the itinerary. List what can go wrong on this trip and which source can tell us in time.
- Push rules: what is urgent, quiet hours, evening briefing, how early before a stop.
- Stack and costs, checked against official price pages.
- Report itinerary inconsistencies to the owner.
- Output: a document the owner can comment on. (Thailand: brainstorm doc, then a static visual demo.)

## Phase 1: The app end to end (Thailand PR 12)

- `shared/` (itinerary, rules, time), `worker/` (cron, sources, push), `app/` (Today, Map, Alerts,
  Emergency, Settings), tests. Private trip file split out from the first commit.
- Deploy by hand once to see it on a phone. UX pass against the demo (PR 13).

## Phase 2: Deploy, simulate, verify (PRs 14, 15, 16, 27)

- Auto-deploy from `main` with GitHub Actions (owner pastes the workflow).
- The trip simulator with scenarios for each real risk; fix what it catches.
- Verify every coordinate, hospital and emergency number.

## Phase 3: Make it real and private (PRs 26, 30, 33, 34, 35)

- Choose the AI provider by config.
- Offline CI, live checks by hand, news shadow mode.
- Push prompt on the home screen, install card for Android, notification icon.
- Cloudflare Access sign-in with the allowed emails, no public worker address.

## Phase 4: See every screen, then polish (PRs 36 to 40, 51)

- Screenshot showcase: every disruption source going wrong, every feature, light and dark. Fix
  what it finds (PR 36).
- Map labels in English (CARTO through a Pages Function with a key).
- Settings shows every source and when it last answered.
- Place cards (what each stop is) and a calmer Today screen. Mocks first.

## Phase 5: Audit and harden (issues 43 to 50, PRs 54 to 61)

- Full multi-lens audit, findings only. File each area as an issue.
- Fix in parallel threads, one PR per issue, each with a reviewer: cron timeouts, push retries, run
  lock and heartbeat; API hardening and the re-plan cap; hospitals by location; app robustness; map
  refresh; evening reminders visible without push; tap areas and press feedback; repo hygiene
  (privacy guard, lint, shared prompts, rollback docs).

## Phase 6: Last mile before the trip (PRs 62 to 65)

- Switch the live AI provider; re-sync the itinerary with the latest document.
- Computer layout (side menu, plan column, map always open) for planning on a laptop.
- "Know before you go": hours, fees and cash per stop, and web checks for closures.
- Then: flight numbers in, shadow mode off, live checks once, freeze `main` to fixes only.

## What to do differently next time

- Write the template config (country, time zone, language) before the itinerary, not after.
- Set up Cloudflare Access, the heartbeat, timeouts and push retries in phase 1; they were all
  audit findings later.
- Put keys in as Secrets from the start and write down where each one lives.
- Ask the owner to open the cloud session's network to the data sources on day one.
- Start news shadow mode as early as possible; the comparison needs weeks of data.
- Make the screenshot showcase a script from phase 2, and re-run it before each phase ends.
