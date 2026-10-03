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

  subs() {
    return this.json<PushSubscriptionJSON[]>("subs", []);
  }
  async saveSubs(subs: PushSubscriptionJSON[]) {
    await this.kv.put("subs", JSON.stringify(subs));
  }

  state() {
    return this.json<TripState | null>("state", null);
  }
}
