/**
 * 登入：一個密碼（APP_PASSWORD）＋ 自己簽自己驗嘅 token（SESSION_SECRET）。
 *
 * 唔使資料庫：cookie、OAuth code、access token 全部 HMAC 簽名，內容擺喺 token 入面。
 *   · 部機重啟／換機唔使重新登入（冇 in-memory session 會丟）
 *   · 換 SESSION_SECRET ＝ 所有 cookie、所有 claude.ai 授權即刻作廢（洩漏咗就係咁補救）
 *   · 換 APP_PASSWORD 唔會踢走已登入嘅裝置（要踢就換 SESSION_SECRET）
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export interface Payload {
  t: string;
  exp: number;
  [k: string]: unknown;
}

export function constantEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createSigner(secret: string) {
  // 由 secret 推一條獨立 key，唔直接攞 secret 做 key（日後另一個用途要另一條 key 就改 label）
  const key = createHmac("sha256", secret).update("global-call-crm/v1").digest();

  function sign(payload: Payload): string {
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = createHmac("sha256", key).update(body).digest("base64url");
    return `${body}.${sig}`;
  }

  /** 簽名啱、類型啱、未過期先回 payload；任何一樣唔啱都回 null（唔講原因，唔幫人試）。 */
  function verify(token: string, type: string, now = Date.now()): Payload | null {
    const i = token.lastIndexOf(".");
    if (i <= 0) return null;
    const body = token.slice(0, i);
    const expect = createHmac("sha256", key).update(body).digest("base64url");
    if (!constantEq(token.slice(i + 1), expect)) return null;
    try {
      const p: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (typeof p !== "object" || p === null) return null;
      const q = p as Payload;
      if (q.t !== type) return null;
      if (typeof q.exp !== "number" || now > q.exp) return null;
      return q;
    } catch {
      return null;
    }
  }

  return { sign, verify };
}

export type Signer = ReturnType<typeof createSigner>;

// ── cookie ────────────────────────────────────────────────────────────────

export const COOKIE = "gc_session";
export const SESSION_TTL_MS = 60 * 24 * 3600_000; // 60 日：手機唔使成日重新登入

export function readCookie(req: IncomingMessage, name: string): string | null {
  const h = req.headers.cookie ?? "";
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

/** Fly 喺前面做 TLS，真 scheme 喺 x-forwarded-proto；冇就係本機（明文 http）。 */
export function isHttps(req: IncomingMessage): boolean {
  const fwd = req.headers["x-forwarded-proto"];
  return fwd ? String(fwd).split(",")[0]!.trim() === "https" : false;
}

export function baseUrlOf(req: IncomingMessage): string {
  return `${isHttps(req) ? "https" : "http"}://${req.headers.host ?? "localhost"}`;
}

export function sessionCookie(req: IncomingMessage, token: string | null): string {
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax"];
  if (isHttps(req)) attrs.push("Secure");
  if (token === null) return `${COOKIE}=; Max-Age=0; ${attrs.join("; ")}`;
  return `${COOKIE}=${encodeURIComponent(token)}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; ${attrs.join("; ")}`;
}

// ── 打錯密碼限速 ──────────────────────────────────────────────────────────

/**
 * 每個 IP 15 分鐘內最多錯 10 次，之後鎖到個窗過咗。
 * ❗淨係計「錯」：打啱唔扣數，Kevin 自己唔會俾自己鎖住。
 * ❗記憶體入面：部機重啟會清零 —— 夠擋亂試，擋唔到要另外搵 WAF。
 */
export function createThrottle(max = 10, windowMs = 15 * 60_000) {
  const hits = new Map<string, number[]>();
  const fresh = (ip: string, now: number) => (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  return {
    blocked(ip: string, now = Date.now()): boolean {
      return fresh(ip, now).length >= max;
    },
    fail(ip: string, now = Date.now()): void {
      const list = fresh(ip, now);
      list.push(now);
      hits.set(ip, list);
      if (hits.size > 5000) for (const k of [...hits.keys()].slice(0, 1000)) hits.delete(k);
    },
  };
}

export type Throttle = ReturnType<typeof createThrottle>;

/** Fly 會喺 Fly-Client-IP 畀真 IP；冇就用 socket 嘅。 */
export function clientIp(req: IncomingMessage): string {
  const f = req.headers["fly-client-ip"];
  if (typeof f === "string" && f) return f;
  return req.socket.remoteAddress ?? "?";
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
