// Builds dist/ for Cloudflare Pages: the game in src/ plus the shared assets from election-game/.
// Only quotes said by a drawn politician and with a documented source (a link or an audio clip) make it into the game.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(here, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(here, 'src'), dist, { recursive: true });

const cast = JSON.parse(readFileSync(join(root, 'assets/caricatures/cast.json'), 'utf8'));
const ids = new Set(cast.map((c) => c.id));
mkdirSync(join(dist, 'assets/caricatures'), { recursive: true });
cpSync(join(root, 'assets/caricatures/cast.json'), join(dist, 'assets/caricatures/cast.json'));
// The faces are the AI stickers (assets/ai/cutout.py makes the webp files from the generated PNGs).
mkdirSync(join(dist, 'assets/ai'), { recursive: true });
for (const id of ids) {
  for (const v of ['idle', 'hit']) {
    const f = `${id}-${v}.webp`;
    cpSync(join(root, 'assets/ai', f), join(dist, 'assets/ai', f));
  }
}

mkdirSync(join(dist, 'scenes'), { recursive: true });
for (const f of readdirSync(join(root, 'mockups/scenes'))) {
  if (f.endsWith('.svg') || f.endsWith('.json')) cpSync(join(root, 'mockups/scenes', f), join(dist, 'scenes', f));
}

const bank = JSON.parse(readFileSync(join(root, 'data/quotes.json'), 'utf8'));
// A clip cut from a recording is a source too.
const clips = JSON.parse(readFileSync(join(root, 'assets/audio/sources.json'), 'utf8'));
const clipSource = Object.fromEntries(clips.map((c) => [c.quote_id, c.source_url]));
const quotes = bank.quotes
  .map((q) => (q.source || !clipSource[q.id] ? q : { ...q, source: clipSource[q.id] }))
  .filter((q) => ids.has(q.speaker) && q.source);
mkdirSync(join(dist, 'assets/audio'), { recursive: true });
for (const q of quotes) {
  if (!q.audio) continue;
  cpSync(join(root, q.audio), join(dist, q.audio));
}
mkdirSync(join(dist, 'data'), { recursive: true });
writeFileSync(join(dist, 'data/quotes.json'), JSON.stringify({ updated: bank.updated, quotes }));

console.log(`dist/: ${quotes.length} of ${bank.quotes.length} quotes, ${quotes.filter((q) => q.audio).length} with audio`);
