// GDELT news search: free, no key. Returns raw headlines; Claude decides which matter.
import { getJson } from "./http";

export interface Article {
  url: string;
  title: string;
  domain: string;
  seendate: string;
}

// GDELT rejects long queries ("Your query was too short or too long"; the earlier 252-character
// version was refused), so the places are the three provinces: every stop is in one of them.
const PLACES = '("Chiang Mai" OR "Chiang Rai" OR "Mae Hong Son")';
const TROUBLE = "(protest OR closed OR flood OR landslide OR accident OR cancelled OR evacuation OR wildfire OR border)";

/** Headlines from the past `timespan` (GDELT syntax: 24h, 3d, ...), newest first. */
export async function fetchArticles(timespan = "24h"): Promise<Article[]> {
  const q = encodeURIComponent(`${PLACES} ${TROUBLE}`);
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&format=json&timespan=${timespan}&maxrecords=50&sort=DateDesc`;
  const res = await getJson<{ articles?: Article[] }>(url);
  return res.articles ?? [];
}
