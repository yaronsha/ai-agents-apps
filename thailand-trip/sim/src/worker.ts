// Runs the real worker (worker/src) in workerd, Cloudflare's own runtime, through Miniflare.
// Only two things differ from production: every outgoing request goes to the simulated world,
// and the itinerary uses trip-private.sim.json (made-up hotels and flight numbers).
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import type { World } from "./world";

const ROOT = new URL("../../", import.meta.url).pathname;
const SIM_PRIVATE = new URL("../trip-private.sim.json", import.meta.url).pathname;
export const SIM_TOKEN = "sim-token";

async function bundle(): Promise<string> {
  const toml = readFileSync(ROOT + "worker/wrangler.toml", "utf8");
  const out = await build({
    entryPoints: [ROOT + "worker/src/index.ts"],
    bundle: true,
    write: false,
    format: "esm",
    target: "es2022",
    platform: "browser",
    conditions: ["workerd", "worker", "browser"],
    mainFields: ["browser", "module", "main"],
    logLevel: "silent",
    plugins: [
      {
        name: "sim-private",
        setup(b) {
          b.onResolve({ filter: /trip-private\.json$/ }, () => ({ path: SIM_PRIVATE }));
        },
      },
    ],
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!/main = "src\/index.ts"/.test(toml)) throw new Error("worker/wrangler.toml no longer points at src/index.ts");
  return out.outputFiles[0].text;
}

async function vapidKeys() {
  const pair = (await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = Buffer.from(await webcrypto.subtle.exportKey("raw", pair.publicKey));
  return { privateJwk: JSON.stringify(jwk), publicKey: raw.toString("base64url") };
}

export interface SimWorker {
  mf: Miniflare;
  url: URL;
  tick(at: Date): Promise<void>;
  api<T>(path: string, init?: RequestInit): Promise<T>;
  kv(): Promise<KVNamespace>;
  dispose(): Promise<void>;
}

export async function startWorker(world: World, opts: { port?: number } = {}): Promise<SimWorker> {
  const compatibilityDate = readFileSync(ROOT + "worker/wrangler.toml", "utf8").match(/compatibility_date = "([^"]+)"/)![1];
  const vapid = await vapidKeys();
  const mf = new Miniflare({
    modules: [{ type: "ESModule", path: "index.js", contents: await bundle() }],
    compatibilityDate,
    kvNamespaces: ["TRIP_KV"],
    host: "127.0.0.1",
    port: opts.port ?? 0,
    bindings: {
      APP_TOKEN: SIM_TOKEN,
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_JWK: vapid.privateJwk,
      VAPID_CONTACT: "mailto:sim@example.com",
      CLAUDE_TRIAGE_MODEL: "claude-haiku-4-5",
      CLAUDE_REPLAN_MODEL: "claude-sonnet-5-5",
      // Fake keys switch on the paid sources; their requests never leave the simulator.
      ANTHROPIC_API_KEY: "sim-anthropic-key",
      GOOGLE_MAPS_KEY: "sim-google-key",
      RAPIDAPI_KEY: "sim-rapidapi-key",
      // News shadow mode calls Google News, which the simulated world doesn't answer.
      SHADOW_NEWS: "off",
    },
    outboundService: (req: unknown) => world.handle(req as Request) as never,
  });
  const url = await mf.ready;
  const worker = await mf.getWorker();
  return {
    mf,
    url,
    async tick(at) {
      const res = await worker.scheduled({ scheduledTime: at, cron: "*/15 * * * *" });
      if (res.outcome !== "ok") throw new Error(`cron run at ${at.toISOString()} ended with ${res.outcome}`);
    },
    async api<T>(path: string, init?: RequestInit) {
      const res = await mf.dispatchFetch(new URL(path, url), { ...(init as object), headers: { "X-Trip-Token": SIM_TOKEN, "Content-Type": "application/json" } } as never);
      if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
      return (await res.json()) as T;
    },
    kv: () => mf.getKVNamespace("TRIP_KV") as unknown as Promise<KVNamespace>,
    dispose: () => mf.dispose(),
  };
}
