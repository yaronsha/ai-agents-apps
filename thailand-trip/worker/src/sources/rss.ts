// A small RSS reader for the news feeds: titles, links, sources and dates, nothing else.
import type { Article } from "./gdelt";

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (m, n: string) => {
      const code = n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    })
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
    .flatMap(([, item]): Article[] => {
      // One broken item is skipped, so it can't make the whole feed count as down.
      try {
        const sourceUrl = item.match(/<source url="([^"]+)"/)?.[1];
        const pub = new Date(tag(item, "pubDate"));
        return [
          {
            url: tag(item, "link"),
            title: tag(item, "title"),
            domain: sourceUrl ? new URL(sourceUrl).hostname.replace(/^www\./, "") : domain,
            seendate: Number.isNaN(+pub) ? "" : pub.toISOString(),
          },
        ];
      } catch {
        return [];
      }
    })
    .filter((a) => /^https?:\/\//.test(a.url) && a.title)
    .sort((a, b) => b.seendate.localeCompare(a.seendate));
}
