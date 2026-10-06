// The two KV calls the simulator and worker/src/env.ts need, without pulling Workers types into a Node project.
type KVNamespace = {
  get(key: string, type?: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
};
