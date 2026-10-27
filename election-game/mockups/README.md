# עגבנייה בקלפי · עיצוב

Design reference for the tomato-throwing election game. The clickable mockups live on a design canvas: https://claude.ai/artifact/YWTKmWYPTKWjCrhvwa8KhM (private to Yaron until shared).

## Screens (phone, 390×844, Hebrew RTL)

| # | Screen | What's on it |
| --- | --- | --- |
| 1 | פתיחה | Title, three faces peeking from a ballot box, easy/hard toggle (easy shows name plates), Play, link to the poll. |
| 2 | משחק במליאה | HUD (score, timer, tomatoes left), "מי אמר?" quote card with a play-audio button, the plenum scene. |
| 2ב | משחק מול הכנסת | Same HUD and card, the Knesset at night: roof, entrance, menorah pedestal, bushes, ballot box. Scenes alternate between rounds. |
| 3 | פגיעה נכונה | Tomato splat on the speaker of the quote, yellow toast "בול! +100", streak. |
| 4 | פגיעה שגויה | Splat on the wrong person, red toast "אופס! −50", the real speaker ringed in yellow. Shown in hard mode (no names). |
| 5 | סוף סיבוב | Score card (this is the share image), title, correct IDs, accuracy, best streak, the pair you mixed up most, the quote that got you, share / again / poll. |
| 6 | סקר העגבניות | Tomatoes per politician from all players, today / week / all-time tabs. Only correct hits count. |

Rules shown in the mockups: the quote appears only on the card, never in a speech bubble, so the player has to know who said it. Correct hit +100, wrong hit −50. 10 quotes per round.

## Files

- `tokens.css`: colors, fonts and sizes used across the screens.
- `scenes/*.svg`: the two game scenes, 358×556. `*-bg.svg` goes behind the characters; `plenum-podium.svg` and `outside-fg.svg` are the props they hide behind.
- `scenes/spots.json`: every pop-up spot per scene, and how a character is clipped and scaled in it.
