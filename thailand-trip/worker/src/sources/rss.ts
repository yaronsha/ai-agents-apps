// A small RSS reader for the news feeds: titles, links, sources and dates, nothing else.
import type { Article } from "./gdelt";

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

const tag = (s: string, t: string) => decode(s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? "");

/** The items of an RSS feed, newest first. `domain` is used when an item names no source of its own. */
export function parseRss(xml: string, domain: string): Article[] {
  return [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)]
    .map(([, item]) => {
      const sourceUrl = item.match(/<source url="([^"]+)"/)?.[1];
      const pub = new Date(tag(item, "pubDate"));
      return {
        url: tag(item, "link"),
        title: tag(item, "title"),
        domain: sourceUrl ? new URL(sourceUrl).hostname.replace(/^www\./, "") : domain,
        seendate: Number.isNaN(+pub) ? "" : pub.toISOString(),
      };
    })
    .filter((a) => /^https?:\/\//.test(a.url) && a.title)
    .sort((a, b) => b.seendate.localeCompare(a.seendate));
}
