// Google News RSS search: free, no key. A candidate news source next to GDELT, whose index has
// lagged more than a day behind; shadow mode compares the two before one replaces the other.
import type { Article } from "./gdelt";

const PLACES = '("Chiang Mai" OR "Chiang Rai" OR "Mae Hong Son" OR Pai)';
const TROUBLE = "(protest OR closed OR flood OR landslide OR accident OR cancelled OR evacuation OR wildfire OR border OR earthquake OR haze)";

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

/** Headlines from the past `days` days (Google's `when:` operator), newest first. */
export async function fetchGoogleNews(days = 1): Promise<Article[]> {
  const q = encodeURIComponent(`${PLACES} ${TROUBLE} when:${days}d`);
  const res = await fetch(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`, {
    headers: { "User-Agent": "Mozilla/5.0 (thailand-trip)" },
  });
  const xml = await res.text();
  if (!res.ok) throw new Error(`news.google.com ${res.status}`);
  if (!xml.includes("<rss")) throw new Error(`news.google.com: not RSS: ${xml.slice(0, 120).trim()}`);
  const tag = (s: string, t: string) => decode(s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? "");
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map(([, item]) => {
      const sourceUrl = item.match(/<source url="([^"]+)"/)?.[1];
      const pub = new Date(tag(item, "pubDate"));
      return {
        url: tag(item, "link"),
        // Google appends " - Source Name" to every title.
        title: tag(item, "title").replace(/ - [^-]+$/, ""),
        domain: sourceUrl ? new URL(sourceUrl).hostname.replace(/^www\./, "") : tag(item, "source"),
        seendate: Number.isNaN(+pub) ? "" : pub.toISOString(),
      };
    })
    .sort((a, b) => b.seendate.localeCompare(a.seendate));
}
