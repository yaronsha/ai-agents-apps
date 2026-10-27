// Tomato poll: GET /api/poll?range=today|week|all returns correct hits per politician,
// POST /api/poll {"hits": {"netanyahu": 2, ...}} adds one finished round's correct hits.
const CAST = ['netanyahu', 'liberman', 'eisenkot', 'golan', 'bennett', 'bengvir', 'smotrich', 'lapid', 'gantz'];
const MAX_HITS_PER_ROUND = 10;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// YYYY-MM-DD in Israel, daysAgo days back.
export function israelDay(daysAgo = 0, now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(now - daysAgo * 86400000));
}

// Preview deployments (<hash>.<project>.pages.dev) share the database, so they don't write to it.
export function isPreview(url) {
  const host = new URL(url).hostname;
  return host.endsWith('.pages.dev') && host.split('.').length > 3;
}

export function parseHits(body) {
  const hits = body && body.hits;
  if (!hits || typeof hits !== 'object' || Array.isArray(hits)) return null;
  const entries = Object.entries(hits);
  if (!entries.length) return null;
  let total = 0;
  for (const [id, n] of entries) {
    if (!CAST.includes(id) || !Number.isInteger(n) || n < 1) return null;
    total += n;
  }
  return total <= MAX_HITS_PER_ROUND ? entries : null;
}

export async function onRequestGet({ request, env }) {
  const range = new URL(request.url).searchParams.get('range') || 'all';
  let sql = 'SELECT speaker, SUM(n) AS n FROM hits';
  const params = [];
  if (range === 'today') { sql += ' WHERE day = ?'; params.push(israelDay()); }
  else if (range === 'week') { sql += ' WHERE day >= ?'; params.push(israelDay(6)); }
  else if (range !== 'all') return json({ error: 'range must be today, week or all' }, 400);
  sql += ' GROUP BY speaker';
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  const counts = Object.fromEntries(CAST.map((id) => [id, 0]));
  for (const row of results) if (CAST.includes(row.speaker)) counts[row.speaker] = Number(row.n) || 0;
  return json({ range, counts });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'body must be JSON' }, 400); }
  const entries = parseHits(body);
  if (!entries) return json({ error: `hits: politician ids with whole counts, at most ${MAX_HITS_PER_ROUND} in all` }, 400);
  if (isPreview(request.url)) return json({ ok: true, preview: true });
  const day = israelDay();
  const stmt = env.DB.prepare(
    'INSERT INTO hits (day, speaker, n) VALUES (?, ?, ?) ON CONFLICT(day, speaker) DO UPDATE SET n = n + excluded.n',
  );
  await env.DB.batch(entries.map(([id, n]) => stmt.bind(day, id, n)));
  return json({ ok: true });
}
