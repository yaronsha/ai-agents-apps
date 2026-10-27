# Election game: tomatoes at the ballot box

A satirical browser game for the 2026 Israeli election. Politicians pop up in the Knesset,
a quote appears at the top of the screen, and you throw a tomato at whoever actually said it.
Hit the wrong politician and you lose points. Hebrew, right to left, made for phones first.

Status: planning. There is no game code yet. This folder collects the material the game
will be built from.

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
  and the exact words spoken. Play clips from the throw/tap handler (mobile blocks
  autoplay otherwise) and give players a mute toggle.

Other parts (mockups, caricatures) are added here as they're ready.

## Ground rules

- **Only real quotes, word for word.** Putting words in a real person's mouth is a
  defamation risk, so every quote needs a source.
- **Drawn caricatures only.** No press photos, no party logos.
- **No commercial use** of politicians' likenesses: no ads and no paid version without a
  lawyer's review.
