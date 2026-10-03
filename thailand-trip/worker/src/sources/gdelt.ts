// GDELT news search: free, no key. Returns raw headlines; Claude decides which matter.
import { getJson } from "./http";

export interface Article {
  url: string;
  title: string;
  domain: string;
  seendate: string;
}

const PLACES = '("Chiang Mai" OR "Chiang Rai" OR "Mae Hong Son" OR "Chiang Dao" OR "Doi Inthanon" OR "Phu Chi Fa" OR "Pai district")';
const TROUBLE = "(protest OR closed OR closure OR flood OR landslide OR accident OR strike OR cancelled OR evacuation OR wildfire OR outbreak OR border)";

export async function fetchArticles(): Promise<Article[]> {
  const q = encodeURIComponent(`${PLACES} ${TROUBLE}`);
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&format=json&timespan=24h&maxrecords=50&sort=DateDesc`;
  const res = await getJson<{ articles?: Article[] }>(url);
  return res.articles ?? [];
}
