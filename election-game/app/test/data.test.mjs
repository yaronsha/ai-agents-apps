// Checks the built dist/: every quote the game can show has a drawn speaker, a source and its files.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const dist = new URL('../dist/', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, dist), 'utf8'));

test('dist quotes are playable', () => {
  const cast = read('assets/caricatures/cast.json').map((c) => c.id);
  const { quotes } = read('data/quotes.json');
  assert.ok(quotes.length >= 50);
  for (const q of quotes) {
    assert.ok(cast.includes(q.speaker), q.id);
    assert.match(q.source, /^https:\/\//, q.id);
    if (q.audio) assert.ok(existsSync(new URL(q.audio, dist)), q.audio);
  }
  // Each round needs 10 quotes with at most 2 per speaker, at either level.
  for (const min of [1, 2]) {
    const per = {};
    for (const q of quotes.filter((x) => x.level >= min)) per[q.speaker] = Math.min(2, (per[q.speaker] || 0) + 1);
    assert.ok(Object.values(per).reduce((a, b) => a + b, 0) >= 10, `level ${min}`);
  }
});

test('every caricature and scene file is there', () => {
  for (const { id } of read('assets/caricatures/cast.json')) {
    for (const v of ['idle', 'hit']) assert.ok(existsSync(new URL(`assets/caricatures/${id}-${v}.svg`, dist)), id + v);
  }
  const spots = read('scenes/spots.json');
  for (const sc of Object.values(spots.scenes)) {
    assert.ok(existsSync(new URL('scenes/' + sc.background, dist)));
    for (const f of sc.foreground) assert.ok(existsSync(new URL('scenes/' + f.file, dist)));
  }
});
