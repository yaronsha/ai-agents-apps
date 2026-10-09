import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";
import { FakeKV, makeEnv } from "./fakes";

afterEach(() => vi.unstubAllGlobals());

const TEAM = "trip-team.cloudflareaccess.com";
const AUD = "aud-tag-123";
let keys: CryptoKeyPair;
let otherKeys: CryptoKeyPair;

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function jwt(claims: Record<string, unknown>, key = keys.privateKey, kid = "k1") {
  const head = `${enc({ alg: "RS256", kid, typ: "JWT" })}.${enc(claims)}`;
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head)));
  return `${head}.${b64url(sig)}`;
}

const good = () => ({ aud: [AUD], iss: `https://${TEAM}`, email: "friend@example.com", exp: Date.now() / 1000 + 3600 });

async function accessEnv(): Promise<Env> {
  return { ...(await makeEnv(new FakeKV())), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
}

function stubCerts() {
  vi.stubGlobal("fetch", async (url: string) => {
    if (url !== `https://${TEAM}/cdn-cgi/access/certs`) return new Response("no", { status: 404 });
    const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
    return Response.json({ keys: [{ ...jwk, kid: "k1" }] });
  });
}

const get = (env: Env, token?: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request("https://w/api/trip-private", { headers: { ...(token ? { "Cf-Access-Jwt-Assertion": token } : {}), ...headers } }), env);

beforeAll(async () => {
  const params = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  keys = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
  otherKeys = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
});

describe("cloudflare access", () => {
  it("serves private data to a request signed in through Access", async () => {
    stubCerts();
    expect((await get(await accessEnv(), await jwt(good()))).status).toBe(200);
  });

  it("refuses a missing, forged, expired or foreign token", async () => {
    stubCerts();
    const env = await accessEnv();
    expect((await get(env)).status).toBe(401);
    expect((await get(env, await jwt(good(), otherKeys.privateKey))).status).toBe(401);
    expect((await get(env, await jwt({ ...good(), exp: Date.now() / 1000 - 10 }))).status).toBe(401);
    expect((await get(env, await jwt({ ...good(), aud: ["another-app"] }))).status).toBe(401);
    expect((await get(env, await jwt({ ...good(), iss: "https://evil.cloudflareaccess.com" }))).status).toBe(401);
    expect((await get(env, "not.a.jwt")).status).toBe(401);
    const { exp: _, ...noExp } = good();
    expect((await get(env, await jwt(noExp))).status).toBe(401);
  });

  it("refetches the signing keys for an unknown kid at most once a minute", async () => {
    let calls = 0;
    const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
    vi.stubGlobal("fetch", async () => {
      calls++;
      return Response.json({ keys: [{ ...jwk, kid: "k1" }] });
    });
    const env = await accessEnv();
    expect((await get(env, await jwt(good()))).status).toBe(200);
    const before = calls;
    for (let i = 0; i < 5; i++) expect((await get(env, await jwt(good(), keys.privateKey, `junk-${i}`))).status).toBe(401);
    expect(calls - before).toBeLessThanOrEqual(1);
  });

  it("stops accepting the old access code once Access is on", async () => {
    stubCerts();
    expect((await get(await accessEnv(), undefined, { "X-Trip-Token": "secret" })).status).toBe(401);
  });

  it("still lets the access code read the news shadow log, for the terminal report", async () => {
    stubCerts();
    const res = await worker.fetch(new Request("https://w/api/shadow", { headers: { "X-Trip-Token": "secret" } }), await accessEnv());
    expect(res.status).toBe(200);
  });

  it("tells the app which kind of sign-in the server uses", async () => {
    const config = async (env: Env) => ((await (await worker.fetch(new Request("https://w/api/config"), env)).json()) as { auth: string }).auth;
    expect(await config(await accessEnv())).toBe("access");
    expect(await config(await makeEnv(new FakeKV()))).toBe("token");
  });
});
