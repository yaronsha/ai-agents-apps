# Caricatures

Original drawn caricatures for the tomato-throwing election game. No photos, no party logos.

- `<id>-idle.svg`: the politician popping up.
- `<id>-hit.svg`: after a tomato hit (eyes squeezed shut, open mouth, splat on the forehead).
- `cast.json`: ids and Hebrew display names.

Ids: `netanyahu`, `liberman`, `eisenkot`, `golan`, `bennett`, `bengvir`, `smotrich`, `lapid`, `gantz`.

Each SVG is 240×300 and is meant to be shown at 120×150 (or smaller; they stay readable down to about 48px wide). The bottom of the frame is shoulders, so they can pop up from behind seats or a podium.

The SVGs are generated. Edit `gen.js`, then run `node gen.js` in this folder to rewrite them.
