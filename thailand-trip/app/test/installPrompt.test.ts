import { describe, expect, it } from "vitest";
import { INSTALL_SNOOZE_MS, isAndroid, showInstallCard } from "../src/installPrompt";

const now = Date.parse("2026-11-22T08:00:00Z");

describe("install card", () => {
  it("shows once Chrome offers the install", () => {
    expect(showInstallCard({ available: true, dismissedAt: null, now })).toBe(true);
  });

  it("shows nothing when the browser has no install offer (iPhone, Firefox, already installed)", () => {
    expect(showInstallCard({ available: false, dismissedAt: null, now })).toBe(false);
  });

  it("stays away for a week after 'not now'", () => {
    expect(showInstallCard({ available: true, dismissedAt: now - 1000, now })).toBe(false);
    expect(showInstallCard({ available: true, dismissedAt: now - INSTALL_SNOOZE_MS, now })).toBe(true);
  });

  it("only listens on Android", () => {
    expect(isAndroid("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile")).toBe(true);
    expect(isAndroid("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130")).toBe(false);
    expect(isAndroid("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(false);
  });
});
