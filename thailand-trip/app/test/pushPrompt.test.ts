import { describe, expect, it } from "vitest";
import { PUSH_PROMPT_SNOOZE_MS, pushPromptMode } from "../src/pushPrompt";

const now = Date.parse("2026-11-22T08:00:00Z");
const base = { support: "ok" as const, permission: "default" as NotificationPermission, enabled: false, dismissedAt: null, now };

describe("pushPromptMode", () => {
  it("offers the enable button to a new unsubscribed device", () => {
    expect(pushPromptMode(base)).toBe("enable");
  });

  it("hides once this device is subscribed", () => {
    expect(pushPromptMode({ ...base, enabled: true })).toBeNull();
  });

  it("shows install steps on iPhone Safari that is not installed", () => {
    expect(pushPromptMode({ ...base, support: "ios-not-installed", permission: null })).toBe("install");
  });

  it("shows nothing where push can't work", () => {
    expect(pushPromptMode({ ...base, support: "unsupported" })).toBeNull();
    expect(pushPromptMode({ ...base, support: "no-sw" })).toBeNull();
  });

  it("explains how to unblock instead of a button when permission was denied", () => {
    expect(pushPromptMode({ ...base, permission: "denied" })).toBe("blocked");
  });

  it("stays away for a week after a dismiss, then asks again", () => {
    expect(pushPromptMode({ ...base, dismissedAt: now - 60_000 })).toBeNull();
    expect(pushPromptMode({ ...base, dismissedAt: now - PUSH_PROMPT_SNOOZE_MS - 1 })).toBe("enable");
  });
});
