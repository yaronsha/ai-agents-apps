import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNews } from "../src/sources/news";

const now = new Date("2026-11-24T03:00:00Z");
const rss = (items: Array<{ title: string; link: string; at: string; source?: string }>) =>
  `<?xml version="1.0"?><rss version="2.0"><channel>${items
    .map(
      (i) =>
        `<item><title><![CDATA[${i.title}]]></title><link>${i.link}</link><pubDate>${new Date(i.at).toUTCString()}</pubDate>${i.source ? `<source url="${i.source}">x</source>` : ""}</item>`,
    )
    .join("")}</channel></rss>`;

function stub(byHost: Record<string, () => Response>) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    const path = u.host + u.pathname;
    const hit = Object.entries(byHost).find(([k]) => path.startsWith(k));
    return hit ? hit[1]() : new Response("down", { status: 503 });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("news sources", () => {
  it("merges the feeds that answer, taking turns, and names the ones that didn't", async () => {
    stub({
      "thethaiger.com/news/chiang-mai": () =>
        new Response(
          rss([
            { title: "Road to Doi Inthanon closed by landslide", link: "https://thethaiger.com/a", at: "2026-11-24T01:00:00Z" },
            { title: "Old story", link: "https://thethaiger.com/old", at: "2026-11-20T01:00:00Z" },
          ]),
        ),
      // Bing's links go through a click counter.
      "www.bing.com/news": () =>
        new Response(
          rss([
            {
              title: "Pai flooding &#8211; roads cut",
              link: "http://www.bing.com/news/apiclick.aspx?ref=FexRss&aid=&tid=1&url=https%3a%2f%2fwww.nationthailand.com%2fnews%2f1&c=1",
              at: "2026-11-24T02:00:00Z",
            },
          ]),
        ),
      // A whole-country feed keeps only items that name a place on the route.
      "www.matichon.co.th": () =>
        new Response(
          rss([
            { title: "น้ำท่วมเชียงราย ถนนปิด", link: "https://www.matichon.co.th/1", at: "2026-11-24T00:30:00Z" },
            { title: "ฝนตกหนักที่ภูเก็ต", link: "https://www.matichon.co.th/2", at: "2026-11-24T00:40:00Z" },
          ]),
        ),
    });
    const news = await fetchNews(now);
    expect(news.articles.map((a) => [a.title, a.url, a.domain])).toEqual([
      ["Road to Doi Inthanon closed by landslide", "https://thethaiger.com/a", "thethaiger.com"],
      ["Pai flooding – roads cut", "https://www.nationthailand.com/news/1", "nationthailand.com"],
      ["น้ำท่วมเชียงราย ถนนปิด", "https://www.matichon.co.th/1", "matichon.co.th"],
    ]);
    expect(news.ok).toEqual(["thaiger-chiang-mai", "bing-en", "bing-th", "matichon-region"]);
    expect(news.failed.map((f) => f.split(":")[0])).toEqual(["thaiger-north", "chiangmainews", "google-news"]);
  });

  it("lets every source into the first places, however busy another feed is", async () => {
    const busy = Array.from({ length: 30 }, (_, i) => ({ title: `Local item ${i}`, link: `https://www.chiangmainews.co.th/${i}`, at: "2026-11-24T02:30:00Z" }));
    stub({
      "www.chiangmainews.co.th": () => new Response(rss(busy)),
      "thethaiger.com/news/northern-thailand": () =>
        new Response(rss([{ title: "Mae Hong Son campsite shut", link: "https://thethaiger.com/b", at: "2026-11-23T05:00:00Z" }])),
    });
    const titles = (await fetchNews(now)).articles.map((a) => a.title);
    expect(titles.indexOf("Mae Hong Son campsite shut")).toBeLessThan(2);
    expect(titles).toHaveLength(31);
  });

  it("fails only when no source answers", async () => {
    stub({});
    await expect(fetchNews(now)).rejects.toThrow(/thaiger-chiang-mai: Error: thethaiger.com 503.*google-news/);
  });

  it("does not count a page that isn't a feed as an answer", async () => {
    stub({ "thethaiger.com": () => new Response("<html>captcha</html>") });
    await expect(fetchNews(now)).rejects.toThrow("not RSS");
  });
});

describe("rss reader", () => {
  it("skips a broken item instead of dropping the feed, and decodes hex entities", async () => {
    const { parseRss } = await import("../src/sources/rss");
    const xml = `<rss><channel>
      <item><title>Bad &#99999999; item</title><link>https://a.example/1</link><source url="not a url">x</source></item>
      <item><title>Road closed &#x2013; Pai</title><link>https://a.example/2</link></item>
    </channel></rss>`;
    expect(parseRss(xml, "a.example").map((a) => a.title)).toEqual(["Road closed – Pai"]);
  });
});

describe("news triage prompt", () => {
  it("lists the events already reported and asks the model to weigh the source", async () => {
    const { triagePrompt, TRIAGE_SYSTEM } = await import("../src/prompts");
    const { trip } = await import("@trip/shared/private");
    const text = triagePrompt(trip, "2026-11-24", [{ url: "https://x/1", title: "Mae Sai water cut", domain: "unknown.example", seendate: "" }], ["מים במאה סאי"]);
    expect(text).toContain("Already reported:\n- מים במאה סאי");
    expect(text).toContain("[unknown.example, ] Mae Sai water cut");
    expect(TRIAGE_SYSTEM).toMatch(/established news outlet or an official body/);
  });
});
