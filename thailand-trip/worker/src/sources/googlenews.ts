// Google News RSS search: free, no key. A candidate news source next to GDELT, whose index has
// lagged more than a day behind; shadow mode compares the two before one replaces the other.
import type { Article } from "./gdelt";
import { fetchWithTimeout } from "./http";
import { parseRss } from "./rss";

const PLACES = '("Chiang Mai" OR "Chiang Rai" OR "Mae Hong Son" OR Pai)';
const TROUBLE = "(protest OR closed OR flood OR landslide OR accident OR cancelled OR evacuation OR wildfire OR border OR earthquake OR haze)";

/** Headlines from the past `days` days (Google's `when:` operator), newest first. */
export async function fetchGoogleNews(days = 1): Promise<Article[]> {
  const q = encodeURIComponent(`${PLACES} ${TROUBLE} when:${days}d`);
  const res = await fetchWithTimeout(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`, {
    headers: { "User-Agent": "Mozilla/5.0 (thailand-trip)" },
  });
  const xml = await res.text();
  if (!res.ok) throw new Error(`news.google.com ${res.status}`);
  if (!xml.includes("<rss")) throw new Error(`news.google.com: not RSS: ${xml.slice(0, 120).trim()}`);
  // Google appends " - Source Name" to every title.
  return parseRss(xml, "news.google.com").map((a) => ({ ...a, title: a.title.replace(/ - [^-]+$/, "") }));
}
