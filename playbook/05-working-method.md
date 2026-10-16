# 05. Working method

How the Thailand app was built with Claude, and what the owner asked for along the way. Follow it
unless the owner of the new trip says otherwise.

## Language and tone

- The owner writes Hebrew. Replies to the owner are in Hebrew, short and plain, leading with the answer.
- App text is in the travellers' language (Hebrew, right to left). Code, comments, docs, commit
  messages and PRs are in English.
- When asking for a decision: one question, a few short options, one recommended. Otherwise pick a
  sensible default, say which, and keep going.

## Brainstorm before building

The first step was a brainstorm document, not code: what can go wrong on this trip, which source
can tell us in real time, when a push should go out, the stack, and a cost table checked against
the official price pages. The owner then said to build the full version directly instead of a demo.

## Mocks before code for anything visible

- For any UI change, make mocks first and wait for the owner to pick an option. Mocks are made by
  running the real app through the simulator in Chromium (Playwright) and injecting the proposed
  CSS or DOM, so they show the real screens with realistic data. Generator scripts were kept next to
  the screenshots so mocks can be re-run.
- Show 2 to 4 options with one recommended, light and dark mode, and phone size first.
- The owner reads on a phone, where links to files in a project folder do not open. Publish mocks
  and reports as one web page (an Artifact) with all screenshots, and link that.
- "Just propose, don't implement" means exactly that: mocks or a write-up, no PR.
- Example: four redesign directions were all rejected; the app kept its calm look. Do not re-pitch
  a redesign unless asked, and ask what was disliked before making new options.

## One writer, one reviewer, per PR

- Each piece of work runs in its own thread (session) and ends with one PR.
- When the writer's PR is open and its work is finished, a separate **reviewer** session reviews
  it with the code-review and security-review skills (plus any skill matching the changed files),
  and posts findings as GitHub review comments.
- The writer fixes each finding or replies on the thread explaining why not.
- Later pushes to the same PR reuse the same reviewer. The reviewer subscribes to the PR's activity
  so the merge is noticed; when the PR merges, both threads are closed.
- Fixes go in a separate PR from feature work.

## The simulator is the acceptance test

- `npm run check` (type-check, tests, lint, simulator) passes before every push; CI runs the same.
- Every new kind of alert gets a scenario in `sim/scenarios/` with the events of a realistic bad day
  and what the app must do (which alert, by when, which severity, pushed once).
- A "screens per disruption" showcase (one page with Today, Map and Alerts for each source going
  wrong, plus the other features, light and dark) found five real bugs before the trip. Repeat it
  after big changes.

## Audits

- A full audit with every lens (design, UX, frontend, backend, structure, repo, production
  readiness, DX, performance) ran once the app was feature-complete, in one session, findings only.
  Its critical items (no timeouts in the cron, failed pushes marked sent, no alert when the cron dies,
  hospitals sorted by the wrong point, re-plan not capped) were then filed as issues and fixed in
  parallel threads, one PR per issue.
- **No accessibility or screen-reader work** in this project: no aria-live, no spoken
  announcements, no screen-reader-only text. Skip those lenses and items. Plain usability (tap
  targets, press feedback, readable colours, contrast) is still in scope; call it usability.

## Running work in parallel safely

- When several threads change the same app at once, each brief names which files each thread owns
  (for example: map thread owns `MapView.tsx` and the map CSS; another thread must not edit them).
- Run expensive work (audits, mock rounds) one after another when the owner is short on usage.
- Run a probe through GitHub Actions at most once; if the cloud environment's network blocks a
  source, ask the owner to allow the host rather than building workarounds.

## Prepare, don't hand off

- When something needs the owner (a GitHub setting, a workflow file, a Cloudflare secret), prepare
  it fully: the file ready to paste, the exact URL, numbered clicks. The owner should only click.
- State what was checked and how. Mark anything inferred or unverified as such.

## Product principles from the owner

- **Know before you go.** The travellers want to know everything possible in advance: closures,
  hours, opening days, prices, cash or card. Surface it before the day, not only when it breaks.
- **Calm by default.** On a normal day the Today screen is a quiet timeline; on a bad day, Plan B and
  "re-plan for me" are at the top, not folded at the bottom.
- **One push per event.** Never repeat a push every 15 minutes; drop it if it is too late to matter.
- **Works with no signal.** Everything needed on the road is bundled or cached.
- **Cheap and capped.** Free sources first; every paid call optional, windowed and capped per day.
