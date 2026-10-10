// Pages Function: map tiles with English place names. CARTO Voyager draws OpenStreetMap in English,
// but since September 2026 CARTO stamps "API KEY REQUIRED" on every tile fetched without a key. The
// key is a Pages secret (CARTO_KEY) and this function adds it, so it never ships in the app. Without
// the secret the map falls back to the standard OpenStreetMap tiles (Thai labels, but a real map).

interface Env {
  CARTO_KEY?: string;
}

/** /tiles/{z}/{x}/{y}.png or /tiles/{z}/{x}/{y}@2x.png; anything else is refused, so this is no open proxy. */
const TILE = /^\/tiles\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})(@2x)?\.png$/;

export function upstreamTileUrl(pathname: string, key: string | undefined): string | null {
  const m = TILE.exec(pathname);
  if (!m) return null;
  const [, z, x, y, retina = ""] = m;
  if (Number(z) > 20) return null;
  if (!key) return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  const sub = "abcd"[(Number(x) + Number(y)) % 4];
  return `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}${retina}.png?key=${encodeURIComponent(key)}`;
}

export const onRequest = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  const upstream = upstreamTileUrl(new URL(request.url).pathname, env.CARTO_KEY?.trim());
  if (!upstream) return new Response("Not found", { status: 404 });
  const res = await fetch(upstream, {
    headers: { "User-Agent": "thailand-trip-app (https://thailand-trip-app.pages.dev)", Referer: "https://thailand-trip-app.pages.dev/" },
    cf: { cacheEverything: true, cacheTtl: 30 * 24 * 3600 },
  } as RequestInit);
  if (!res.ok) return new Response("Tile unavailable", { status: 502 });
  return new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "image/png",
      // Fallback tiles stay out of the browser and service worker caches, so English tiles replace
      // them as soon as the key is set.
      "Cache-Control": env.CARTO_KEY?.trim() ? "private, max-age=604800" : "no-store",
    },
  });
};
