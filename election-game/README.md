# Election game: tomatoes at the ballot box

A satirical browser game for the 2026 Israeli election. Politicians pop up in the Knesset,
a quote appears at the top of the screen, and you throw a tomato at whoever actually said it.
Hit the wrong politician and you lose points. Hebrew, right to left, made for phones first.

Status: first playable version in `app/`, deployed to Cloudflare Pages (project
`tomato-ballot`).

## What's here

- `data/quotes.json`: the quote bank, 103 real quotes with year, context, a
  recognizability level (3 = everyone knows it, 1 = politics buffs) and who else a player
  might confuse it with. Each quote has a stable `id` (like `netanyahu-01`) and an
  optional `audio` clip path relative to this folder. Entries with `"source": null` came
  from memory and need their wording checked against an original before release. Entries marked `"sensitive": true`
  are in by choice. They can be dropped in a family-friendly mode.

- `assets/audio/`: short clips (2–6 s) of the politician saying the quote, cut from
  original public recordings (Knesset channel, official channels, broadcast interviews).
  No AI-generated or cloned voices. Files are named by quote id, and a quote plays its
  clip only when its `audio` field is set, so audio is a bonus and every other quote
  shows as text. `sources.json` lists each clip's source URL, owner, start and end time,
  and the exact words spoken. A clip plays only after the player throws, since the voice
  gives the answer away. It starts from the throw/tap handler (mobile blocks autoplay
  otherwise), and players get a mute toggle.

- `assets/ai/`: the faces the game uses. AI caricature stickers of each politician, idle
  and hit, made with OpenAI's image model from a reference photo (prompts in the project
  files, `caricatures-v3/`). `<id>-idle.png` / `<id>-hit.png` are the raw generations;
  `python3 cutout.py` removes the painted background and writes the 360x450 `.webp` files.
  The game says on its home screen that the illustrations were made with AI (election rules
  on AI content about candidates).
- `assets/caricatures/`: the earlier hand-drawn SVG politicians, and `cast.json` (names).
- `mockups/`: the design reference and the two game scenes.
- `app/`: the game itself. See below.

## The game (`app/`)

Plain HTML, CSS and JavaScript, no framework and no dependencies. `node build.mjs` copies
`src/` plus the faces, scenes, audio and quote bank into `dist/`. Only quotes said by
one of the nine drawn politicians and with a documented source (a link, or an audio clip
listed in `assets/audio/sources.json`) go into the game; the rest stay in the bank until
they're checked.

- A round is 10 quotes, scenes alternate between rounds (plenum, outside the Knesset).
- One throw at a politician per quote: right +100, wrong −50, time out 0. Throws that hit
  only the background count against accuracy. Easy: 12 s per quote, name plates, only
  well-known quotes. Hard: 9 s, no names, all quotes, more decoys.
- Decoys are picked from the quote's `confusableWith` first.
- Tomato poll: `functions/api/poll.js` (a Pages Function) keeps correct hits per politician
  per day in the D1 database `election-game-poll` (`schema.sql`). Preview deployments
  read it but never write.

`npm test` builds and runs the tests. `npm run dev` runs it locally with wrangler.
`.github/workflows/election-game-deploy.yml` deploys every push that touches
`election-game/`: `main` to production, other branches to a preview URL.

## Ground rules

- **Only real quotes, word for word.** Putting words in a real person's mouth is a
  defamation risk, so every quote needs a source.
- **Caricatures only, AI use disclosed.** No press photos in the game, no party logos.
- **No commercial use** of politicians' likenesses: no ads and no paid version without a
  lawyer's review.
