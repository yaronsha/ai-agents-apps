import { describe, expect, it } from "vitest";
import { DailyBudget, Store } from "../src/store";
import { FakeKV } from "./fakes";

const caps = { routes: 2, claude: 1 };

describe("DailyBudget", () => {
  it("counts calls up to each cap and saves the day's record once", async () => {
    const kv = new FakeKV();
    const budget = await DailyBudget.load(new Store(kv as unknown as KVNamespace), "2026-11-25", caps);
    expect([budget.spend("routes"), budget.spend("routes"), budget.spend("routes")]).toEqual([true, true, false]);
    expect(budget.spend("claude")).toBe(true);
    expect(budget.spend("claude")).toBe(false);
    await budget.save();
    expect(JSON.parse(kv.data.get("budget:2026-11-25")!)).toEqual({ routes: 2, claude: 1 });
    expect(kv.writes).toBe(1);
  });

  it("keeps counters saved by another caller and treats missing ones as 0", async () => {
    const kv = new FakeKV();
    kv.data.set("budget:2026-11-25", JSON.stringify({ claude: 1 }));
    const budget = await DailyBudget.load(new Store(kv as unknown as KVNamespace), "2026-11-25", caps);
    expect(budget.spend("claude")).toBe(false);
    expect(budget.spend("routes")).toBe(true);
    await budget.save();
    expect(JSON.parse(kv.data.get("budget:2026-11-25")!)).toEqual({ claude: 1, routes: 1 });
  });

  it("skips the KV write when nothing was spent", async () => {
    const kv = new FakeKV();
    kv.data.set("budget:2026-11-25", JSON.stringify({ claude: 1 }));
    const budget = await DailyBudget.load(new Store(kv as unknown as KVNamespace), "2026-11-25", caps);
    budget.spend("claude");
    await budget.save();
    expect(kv.writes).toBe(0);
  });
});
