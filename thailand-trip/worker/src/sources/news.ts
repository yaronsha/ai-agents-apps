// The news check's sources. GDELT never once answered the worker in five weeks of hourly tries
// (always a timeout), and Google News refuses Cloudflare's addresses about four times in five
// (503). Northern news sites' own feeds answered every try from Cloudflare in the test of
// 2026-11-16, as did Bing News search, so they carry the check; Google News adds its search
// when it does answer.
import type { Article } from "./gdelt";
import { fetchGoogleNews } from "./googlenews";
import { fetchWithTimeout } from "./http";
import { parseRss } from "./rss";

interface Feed {
  name: string;
  url: string;
  /** A feed about the whole country is cut down to items that name a place on the route. */
  wholeCountry?: boolean;
}

const bing = (q: string, market: string) =>
  `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=RSS&setmkt=${market}&qft=${encodeURIComponent('sortbydate="1"')}`;

export const FEEDS: Feed[] = [
  // The Thaiger's Chiang Mai and northern sections: English, several items a day about the north.
  { name: "thaiger-chiang-mai", url: "https://thethaiger.com/news/chiang-mai/feed" },
  { name: "thaiger-north", url: "https://thethaiger.com/news/northern-thailand/feed" },
  // Chiang Mai News: Thai, local news from Chiang Mai and the provinces around it.
  { name: "chiangmainews", url: "https://www.chiangmainews.co.th/feed/" },
  // Bing News search, newest first, in English and in Thai: the search Google News would give.
  { name: "bing-en", url: bing('"Chiang Mai" OR "Chiang Rai" OR "Mae Hong Son"', "en-US") },
  { name: "bing-th", url: bing("เชียงใหม่ OR เชียงราย OR แม่ฮ่องสอน", "th-TH") },
  // Matichon's regional desk: Thai, every province, so only items naming a place on the route count.
  { name: "matichon-region", url: "https://www.matichon.co.th/region/feed", wholeCountry: true },
];

/** Places on the route, in English and Thai, for cutting the whole-country feeds down. */
const ROUTE = /Chiang ?Mai|Chiang ?Rai|Mae Hong Son|\bPai\b|Chiang Dao|Doi Inthanon|Doi Chang|Mae Sai|Chiang Saen|Golden Triangle|เชียงใหม่|เชียงราย|แม่ฮ่องสอน|อำเภอปาย|อ\.ปาย|เชียงดาว|ดอยอินทนนท์|ดอยช้าง|แม่สาย|เชียงแสน|สามเหลี่ยมทองคำ/i;

/** How far back a feed item may be; older items were dealt with by earlier runs, or are stale. */
const MAX_AGE_MS = 48 * 3_600_000;

/** Bing's feed links go through a click counter; the article's own link is in its url parameter. */
function unwrapBing(a: Article): Article {
  try {
    const u = new URL(a.url);
    const real = u.hostname.endsWith("bing.com") ? u.searchParams.get("url") : null;
    return real && /^https?:\/\//.test(real) ? { ...a, url: real, domain: new URL(real).hostname.replace(/^www\./, "") } : a;
  } catch {
    return a;
  }
}

async function fetchFeed(feed: Feed): Promise<Article[]> {
  const host = new URL(feed.url).host;
  const res = await fetchWithTimeout(feed.url, { headers: { "User-Agent": "Mozilla/5.0 (thailand-trip)" } });
  const xml = await res.text();
  if (!res.ok) throw new Error(`${host} ${res.status}`);
  if (!/<rss[\s>]/.test(xml)) throw new Error(`${host}: not RSS`);
  const items = parseRss(xml, host.replace(/^www\./, "")).map(unwrapBing);
  return feed.wholeCountry ? items.filter((a) => ROUTE.test(a.title)) : items;
}

export interface NewsFetch {
  articles: Article[];
  /** The sources that answered, and why each other one didn't. */
  ok: string[];
  failed: string[];
}

/** Headlines from every source at once, taking turns between sources, one copy per link. Throws only when none answered. */
export async function fetchNews(now: Date): Promise<NewsFetch> {
  const sources: Array<[string, () => Promise<Article[]>]> = [
    ...FEEDS.map((f): [string, () => Promise<Article[]>] => [f.name, () => fetchFeed(f)]),
    ["google-news", () => fetchGoogleNews(1)],
  ];
  const results = await Promise.allSettled(sources.map(([, run]) => run()));
  const ok: string[] = [];
  const failed: string[] = [];
  const lists: Article[][] = [];
  results.forEach((r, i) => {
    const name = sources[i][0];
    if (r.status === "rejected") return void failed.push(`${name}: ${String(r.reason)}`);
    ok.push(name);
    lists.push(r.value.filter((a) => !(now.getTime() - Date.parse(a.seendate) > MAX_AGE_MS)));
  });
  if (!ok.length) throw new Error(failed.join("; "));
  // One from each source in turn, newest first within each, so a busy feed can't push a quieter
  // one's headlines past the cap on how many go to the AI model in one run.
  const byUrl = new Map<string, Article>();
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (l[i] && !byUrl.has(l[i].url)) byUrl.set(l[i].url, l[i]);
  }
  const articles = [...byUrl.values()];
  return { articles, ok, failed };
}
