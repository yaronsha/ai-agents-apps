import { describe, expect, it } from "vitest";
import type { TripAlert } from "@trip/shared";
import { worstOf } from "../src/categories";

const alert = (id: string, category: TripAlert["category"], severity: TripAlert["severity"]): TripAlert => ({
  id,
  category,
  severity,
  date: "2026-11-24",
  titleHe: id,
  bodyHe: "",
  pushAt: [],
  digest: true,
});

describe("worstOf", () => {
  it("shows an info alert rather than all clear", () => {
    expect(worstOf([alert("air:lantern", "air", "info")], ["air"])?.id).toBe("air:lantern");
  });

  it("prefers the most severe alert of the group", () => {
    const alerts = [alert("cold:x", "cold", "info"), alert("weather:x", "weather", "warning"), alert("air:y", "air", "urgent")];
    expect(worstOf(alerts, ["weather", "cold", "clouds"])?.id).toBe("weather:x");
  });

  it("is all clear without alerts in the group", () => {
    expect(worstOf([alert("air:y", "air", "urgent")], ["road", "flight"])).toBeUndefined();
  });
});
