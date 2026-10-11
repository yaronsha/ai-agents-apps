// The KV calls the simulator and worker/src/env.ts need, without pulling Workers types into a Node project.
type KVNamespace = {
  get(key: string, type?: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts: { prefix: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
};
