// Temporary diagnostic (not for merge): would Google News RSS (and GDELT) have caught past
// disruptions in northern Thailand, and how soon? Prints the earliest matching headlines per event.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PLACES = '("Chiang Mai" OR "Chiang Rai" OR "Mae Hong Son" OR Pai)';
const TROUBLE = "(protest OR closed OR flood OR landslide OR accident OR cancelled OR evacuation OR wildfire OR border OR earthquake OR haze)";

const events = [
  { name: "Mae Sai / Chiang Rai flash floods (Typhoon Yagi)", from: "2024-09-09", to: "2024-09-14" },
  { name: "Chiang Mai city floods, Ping river", from: "2024-10-02", to: "2024-10-08" },
  { name: "M7.7 Myanmar earthquake felt in the north", from: "2025-03-27", to: "2025-03-30" },
  { name: "Chiang Mai PM2.5 haze peak", from: "2024-03-25", to: "2024-04-02" },
  { name: "Thailand-Cambodia border clashes (control: not the north)", from: "2025-07-23", to: "2025-07-27" },
];

type Item = { title: string; pub: Date; source: string };
async function googleNews(q: string): Promise<Item[] | string> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 thailand-trip-sim" } });
  const xml = await res.text();
  if (!res.ok) return `HTTP ${res.status}: ${xml.slice(0, 100)}`;
  const tag = (s: string, t: string) => s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? "";
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({
    title: tag(m[1], "title").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
    pub: new Date(tag(m[1], "pubDate")),
    source: tag(m[1], "source"),
  }));
}

async function gdelt(q: string, from: string, to: string): Promise<string> {
  const d = (s: string) => s.replace(/-/g, "") + "000000";
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&format=json&maxrecords=5&sort=DateAsc&startdatetime=${d(from)}&enddatetime=${d(to)}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      const text = await res.text();
      if (res.status === 429 || /limit requests/i.test(text)) { await sleep(10_000 * attempt); continue; }
      try {
        const arts = (JSON.parse(text).articles ?? []) as { seendate: string; title: string }[];
        return arts.length ? arts.slice(0, 2).map((a) => `${a.seendate} ${a.title.slice(0, 80)}`).join(" || ") : "0 articles";
      } catch { return `not JSON: ${text.slice(0, 100)}`; }
    } catch (err) { await sleep(5_000); if (attempt === 4) return String(err); }
  }
  return "rate-limited";
}

const fmt = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + "Z";
for (const ev of events) {
  console.log(`\n## ${ev.name} (${ev.from} to ${ev.to})`);
  const items = await googleNews(`${PLACES} ${TROUBLE} after:${ev.from} before:${ev.to}`);
  if (typeof items === "string") console.log(`  Google News: ${items}`);
  else {
    items.sort((a, b) => +a.pub - +b.pub);
    console.log(`  Google News: ${items.length} headlines (cap 100). Earliest:`);
    for (const i of items.slice(0, 6)) console.log(`    ${fmt(i.pub)} [${i.source}] ${i.title.slice(0, 110)}`);
  }
  await sleep(2_000);
  console.log(`  GDELT: ${await gdelt(`${PLACES} ${TROUBLE}`, ev.from, ev.to)}`);
  await sleep(6_000);
}

console.log("\n## Freshness now: Google News, last 24 hours");
const now = await googleNews(`${PLACES} ${TROUBLE} when:1d`);
if (typeof now === "string") console.log(`  ${now}`);
else {
  now.sort((a, b) => +b.pub - +a.pub);
  console.log(`  ${now.length} headlines. Newest:`);
  for (const i of now.slice(0, 6)) console.log(`    ${fmt(i.pub)} [${i.source}] ${i.title.slice(0, 110)}`);
}
export {};
