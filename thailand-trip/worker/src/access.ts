import type { Env } from "./env";

// Cloudflare Access (Zero Trust) puts the sign-in in front of the app: only emails on the
// allow list in the Zero Trust dashboard get past it, and each request then carries a JWT
// signed by Access. The worker checks that JWT too, as a second lock behind the sign-in.

interface Jwk extends JsonWebKey {
  kid: string;
}

let certs: { team: string; keys: Jwk[]; at: number } | null = null;
const CERTS_TTL_MS = 60 * 60_000;
/** An unknown kid refetches at most this often, so junk tokens can't make every call a subrequest. */
const CERTS_REFRESH_MS = 60_000;

async function signingKeys(team: string, refresh: boolean): Promise<Jwk[]> {
  const age = certs?.team === team ? Date.now() - certs.at : Infinity;
  if (age < (refresh ? CERTS_REFRESH_MS : CERTS_TTL_MS)) return certs!.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs ${res.status}`);
  certs = { team, keys: ((await res.json()) as { keys: Jwk[] }).keys, at: Date.now() };
  return certs.keys;
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** Access is on once both values are set (as worker secrets or vars). */
export const accessEnabled = (env: Env) => Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);

/** The signed-in email, or null when the request has no valid Access token for this app. */
export async function accessEmail(req: Request, env: Env): Promise<string | null> {
  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  const team = env.ACCESS_TEAM_DOMAIN?.replace(/^https:\/\//, "").replace(/\/$/, "");
  if (!token || !team || !env.ACCESS_AUD) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64url(parts[0]))) as { alg: string; kid: string };
    const claims = JSON.parse(new TextDecoder().decode(b64url(parts[1]))) as { aud: string | string[]; iss: string; exp?: number; nbf?: number; email?: string };
    if (header.alg !== "RS256") return null;
    // Access rotates its keys; an unknown kid means our cached copy is old.
    let jwk = (await signingKeys(team, false)).find((k) => k.kid === header.kid);
    jwk ??= (await signingKeys(team, true)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), signed))) return null;
    const now = Date.now() / 1000;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(env.ACCESS_AUD) || claims.iss !== `https://${team}` || typeof claims.exp !== "number" || claims.exp < now || (claims.nbf ?? 0) > now + 60) return null;
    return claims.email ?? "service";
  } catch {
    return null;
  }
}
