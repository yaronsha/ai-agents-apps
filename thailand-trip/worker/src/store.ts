import type { TripState } from "@trip/shared";
import type { PushSubscriptionJSON } from "./push";

// KV free tier allows 1,000 writes a day, so every writer here skips the write when nothing changed.
export class Store {
  constructor(private kv: KVNamespace) {}

  async json<T>(key: string, fallback: T): Promise<T> {
    return ((await this.kv.get(key, "json")) as T | null) ?? fallback;
  }

  async putIfChanged(key: string, value: unknown, previous?: unknown): Promise<void> {
    if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(value)) return;
    await this.kv.put(key, JSON.stringify(value));
  }

  // One key per device, so two phones subscribing at once can't overwrite each other.
  // The old single "subs" list is still read (and only ever shrinks) so devices subscribed
  // before the change keep getting pushes.
  async subs(): Promise<PushSubscriptionJSON[]> {
    const legacy = await this.json<PushSubscriptionJSON[]>("subs", []);
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kv.list({ prefix: "sub:", cursor });
      keys.push(...page.keys.map((k) => k.name));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    const keyed = (await Promise.all(keys.map((k) => this.kv.get(k, "json")))) as (PushSubscriptionJSON | null)[];
    // A fresh per-device registration wins over an older entry for the same device in the old list.
    const all = [...keyed.filter((s): s is PushSubscriptionJSON => Boolean(s)), ...legacy];
    return all.filter((s, i) => all.findIndex((x) => x.endpoint === s.endpoint) === i);
  }
  async addSub(sub: PushSubscriptionJSON) {
    await this.kv.put(await subKey(sub.endpoint), JSON.stringify(sub));
  }
  async removeSubs(endpoints: string[]) {
    if (!endpoints.length) return;
    await Promise.all(endpoints.map(async (e) => this.kv.delete(await subKey(e))));
    const legacy = await this.json<PushSubscriptionJSON[]>("subs", []);
    const kept = legacy.filter((s) => !endpoints.includes(s.endpoint));
    if (kept.length !== legacy.length) await this.kv.put("subs", JSON.stringify(kept));
  }

  state() {
    return this.json<TripState | null>("state", null);
  }
}

async function subKey(endpoint: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
  return "sub:" + Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
