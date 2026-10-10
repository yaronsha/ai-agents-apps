import { describe, expect, it } from "vitest";
import { upstreamTileUrl } from "../functions/tiles/[[path]]";

describe("upstreamTileUrl", () => {
  it("asks CARTO Voyager with the key, keeping retina tiles", () => {
    expect(upstreamTileUrl("/tiles/12/3195/1879@2x.png", "k1")).toBe(
      "https://c.basemaps.cartocdn.com/rastertiles/voyager/12/3195/1879@2x.png?key=k1",
    );
  });

  it("falls back to OpenStreetMap without a key", () => {
    expect(upstreamTileUrl("/tiles/8/199/119.png", undefined)).toBe("https://tile.openstreetmap.org/8/199/119.png");
  });

  it("refuses anything that is not a tile", () => {
    for (const p of ["/tiles/../api/trip", "/tiles/8/1/2.png?x", "/tiles/30/1/2.png", "/tiles/0/1/0.png", "/tiles/8/256/3.png", "/tiles/a/b/c.png", "/tiles/"])
      expect(upstreamTileUrl(p, "k")).toBeNull();
  });
});
