import assert from 'node:assert/strict';
import { test } from 'node:test';
import { israelDay, isPreview, onRequestGet, onRequestPost, parseHits } from '../functions/api/poll.js';

// Just enough of D1 for the poll: one table, the two statements the function runs.
function fakeDb() {
  const rows = new Map();
  const prepare = (sql) => ({
    bind: (...args) => ({
      sql, args,
      all: async () => {
        const sums = {};
        for (const [key, n] of rows) {
          const [day, speaker] = key.split('|');
          if (sql.includes('day = ?') && day !== args[0]) continue;
          if (sql.includes('day >= ?') && day < args[0]) continue;
          sums[speaker] = (sums[speaker] || 0) + n;
        }
        return { results: Object.entries(sums).map(([speaker, n]) => ({ speaker, n })) };
      },
    }),
  });
  const batch = async (stmts) => {
    for (const { args: [day, speaker, n] } of stmts) rows.set(`${day}|${speaker}`, (rows.get(`${day}|${speaker}`) || 0) + n);
  };
  return { prepare, batch, rows };
}

const post = (url, body) => new Request(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

test('parseHits accepts a round and rejects junk', () => {
  assert.deepEqual(parseHits({ hits: { netanyahu: 2, lapid: 1 } }), [['netanyahu', 2], ['lapid', 1]]);
  assert.equal(parseHits({ hits: { netanyahu: 11 } }), null);
  assert.equal(parseHits({ hits: { netanyahu: 6, lapid: 5 } }), null);
  assert.equal(parseHits({ hits: { deri: 1 } }), null);
  assert.equal(parseHits({ hits: { netanyahu: 1.5 } }), null);
  assert.equal(parseHits({ hits: { netanyahu: 0 } }), null);
  assert.equal(parseHits({ hits: {} }), null);
  assert.equal(parseHits({ hits: [1] }), null);
  assert.equal(parseHits(null), null);
});

test('isPreview tells preview hosts from production', () => {
  assert.equal(isPreview('https://tomato-ballot.pages.dev/api/poll'), false);
  assert.equal(isPreview('https://ab12cd.tomato-ballot.pages.dev/api/poll'), true);
  assert.equal(isPreview('https://main.tomato-ballot.pages.dev/api/poll'), true);
  assert.equal(isPreview('http://localhost:8788/api/poll'), false);
});

test('israelDay uses Israel time', () => {
  // 22:30 UTC on Oct 27 is already Oct 28 in Israel.
  assert.equal(israelDay(0, Date.UTC(2026, 9, 27, 22, 30)), '2026-10-28');
  assert.equal(israelDay(6, Date.UTC(2026, 9, 27, 12)), '2026-10-21');
});

test('POST adds hits and GET sums them per range', async () => {
  const env = { DB: fakeDb() };
  const url = 'https://tomato-ballot.pages.dev/api/poll';
  assert.equal((await onRequestPost({ request: post(url, { hits: { netanyahu: 3, gantz: 1 } }), env })).status, 200);
  assert.equal((await onRequestPost({ request: post(url, { hits: { netanyahu: 2 } }), env })).status, 200);
  env.DB.rows.set('2020-01-01|gantz', 5);
  const all = await (await onRequestGet({ request: new Request(url + '?range=all'), env })).json();
  assert.equal(all.counts.netanyahu, 5);
  assert.equal(all.counts.gantz, 6);
  assert.equal(all.counts.lapid, 0);
  const today = await (await onRequestGet({ request: new Request(url + '?range=today'), env })).json();
  assert.equal(today.counts.gantz, 1);
  assert.equal((await onRequestGet({ request: new Request(url + '?range=year'), env })).status, 400);
});

test('POST rejects bad bodies and does not write from previews', async () => {
  const env = { DB: fakeDb() };
  assert.equal((await onRequestPost({ request: post('https://tomato-ballot.pages.dev/api/poll', 'nope'), env })).status, 400);
  assert.equal((await onRequestPost({ request: post('https://tomato-ballot.pages.dev/api/poll', { hits: { x: 1 } }), env })).status, 400);
  const res = await onRequestPost({ request: post('https://ab12.tomato-ballot.pages.dev/api/poll', { hits: { lapid: 1 } }), env });
  assert.equal((await res.json()).preview, true);
  assert.equal(env.DB.rows.size, 0);
});
