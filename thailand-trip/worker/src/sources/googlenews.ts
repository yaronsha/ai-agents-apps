// Google News RSS search: free, no key. The app's news source: GDELT, the previous one, returned
// nothing for the past day because its index lags more than a day (shadow mode still logs both).
import type { Article } from "./gdelt";

// Places only, no "flood OR closed ..." list: Google matches those words loosely anyway, and a long
// query makes it silently drop `when:` and return articles months or years old. The AI filter
// decides what matters. "in Pai" because plain Pai is also a common surname.
const QUERY = '("Chiang Mai" OR "Chiang Rai" OR "Mae Hong Son" OR "in Pai")';

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
  const q = encodeURIComponent(`${QUERY} when:${days}d`);
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
    // Google has ignored `when:` before; never pass on stale news as new.
    .filter((a) => a.seendate && Date.parse(a.seendate) > Date.now() - (days * 24 + 6) * 3_600_000)
    .sort((a, b) => b.seendate.localeCompare(a.seendate));
}
