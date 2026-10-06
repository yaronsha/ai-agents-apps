// A stand-in for the browser vendors' push service (FCM, Mozilla, Apple). It owns a real
// subscription key pair, so it can decrypt what the worker sends (RFC 8291, aes128gcm) and
// check the notification text, exactly as a phone would see it. Both encodings are accepted:
// Chrome and Firefox take either; the report says which one the worker used.
import { createDecipheriv, createECDH, createHmac, randomBytes } from "node:crypto";

export interface ReceivedPush {
  at: Date;
  endpoint: string;
  title: string;
  body: string;
  url?: string;
  tag?: string;
  /** "aes128gcm" (RFC 8291) or the older "aesgcm" draft. */
  encoding: string;
  /** The decrypted payload, so the browser check can hand the very same push to the app. */
  raw: { title?: string; body?: string; url?: string; tag?: string };
}

const b64u = (b: Buffer) => b.toString("base64url");
const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

export class FakePushService {
  readonly received: ReceivedPush[] = [];
  private ecdh = createECDH("prime256v1");
  private auth = randomBytes(16);
  readonly subscription: { endpoint: string; keys: { p256dh: string; auth: string } };

  constructor(private clock: () => Date) {
    this.ecdh.generateKeys();
    this.subscription = {
      endpoint: "https://push.sim/send/phone-1",
      keys: { p256dh: b64u(this.ecdh.getPublicKey()), auth: b64u(this.auth) },
    };
  }

  async receive(req: Request): Promise<Response> {
    if (req.method !== "POST") return new Response(null, { status: 405 });
    if (!req.headers.get("authorization")?.startsWith("vapid t=")) return new Response("missing VAPID", { status: 401 });
    const body = Buffer.from(await req.arrayBuffer());
    const encoding = req.headers.get("content-encoding");
    let text: string;
    try {
      text = encoding === "aes128gcm" ? this.aes128gcm(body) : encoding === "aesgcm" ? this.aesgcm(body, req.headers) : "";
    } catch (err) {
      return new Response(`cannot decrypt: ${err}`, { status: 400 });
    }
    if (!text) return new Response(`unsupported Content-Encoding ${encoding}`, { status: 415 });
    const payload = JSON.parse(text) as ReceivedPush["raw"];
    this.received.push({ at: this.clock(), endpoint: req.url, encoding: encoding!, title: payload.title ?? "", body: payload.body ?? "", url: payload.url, tag: payload.tag, raw: payload });
    return new Response(null, { status: 201 });
  }

  private gcm(cek: Buffer, nonce: Buffer, cipher: Buffer): Buffer {
    const d = createDecipheriv("aes-128-gcm", cek, nonce);
    d.setAuthTag(cipher.subarray(cipher.length - 16));
    return Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  }

  /** RFC 8291, the current standard: keys and salt travel in the body header. */
  private aes128gcm(buf: Buffer): string {
    const salt = buf.subarray(0, 16);
    const idLen = buf[20];
    const serverKey = buf.subarray(21, 21 + idLen);
    const shared = this.ecdh.computeSecret(serverKey);
    const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), this.ecdh.getPublicKey(), serverKey]);
    const ikm = hmac(hmac(this.auth, shared), Buffer.concat([keyInfo, Buffer.from([1])]));
    const prk = hmac(salt, ikm);
    const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
    const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
    const plain = this.gcm(cek, nonce, buf.subarray(21 + idLen));
    let end = plain.length - 1;
    while (end > 0 && plain[end] === 0) end--;
    if (plain[end] !== 2) throw new Error("no last-record delimiter");
    return plain.subarray(0, end).toString("utf8");
  }

  /** The older draft (what @pushforge/builder sends): salt and key in the Encryption and Crypto-Key headers. */
  private aesgcm(buf: Buffer, headers: Headers): string {
    const param = (h: string, k: string) => headers.get(h)?.match(new RegExp(`${k}=([^;,]+)`))?.[1];
    const salt = Buffer.from(param("encryption", "salt") ?? "", "base64url");
    const serverKey = Buffer.from(param("crypto-key", "dh") ?? "", "base64url");
    const shared = this.ecdh.computeSecret(serverKey);
    const ikm = hmac(hmac(this.auth, shared), Buffer.from("Content-Encoding: auth\0\x01"));
    const len = (b: Buffer) => Buffer.from([0, b.length]);
    const context = Buffer.concat([Buffer.from("P-256\0"), len(this.ecdh.getPublicKey()), this.ecdh.getPublicKey(), len(serverKey), serverKey]);
    const prk = hmac(salt, ikm);
    const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aesgcm\0"), context, Buffer.from([1])])).subarray(0, 16);
    const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), context, Buffer.from([1])])).subarray(0, 12);
    const plain = this.gcm(cek, nonce, buf);
    return plain.subarray(2 + plain.readUInt16BE(0)).toString("utf8");
  }
}
