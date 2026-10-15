/**
 * 成個 HTTP 程式（唔包開 port）：測試開一個真 server 打真 request，部署由 http.ts 開 port。
 *
 *   /health          —— Fly 探脈；報 build（邊個 commit 行緊）
 *   /app             —— 網頁（要登入）；/app/login 登入
 *   /app/api/*       —— 網頁 API（cookie）
 *   /mcp             —— claude.ai connector（OAuth Bearer）
 *   OAuth 幾條路     —— 見 oauth.ts
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Sql } from "../db/client.js";
import { ApiError, createApi, sendJson } from "./api.js";
import { buildMcpServer } from "./mcp.js";
import { createOAuth } from "./oauth.js";
import {
  AUTH_LOGO, AUTH_PAGE_HEAD, baseUrlOf, clientIp, constantEq, COOKIE, createSigner, createThrottle, esc, readCookie,
  sessionCookie, SESSION_TTL_MS,
} from "./security.js";

export interface AppConfig {
  sql: () => Sql;
  password: string;
  secret: string;
  publicDir: string;
  build?: string;
  now?: () => Date;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

interface Asset { body: Buffer; type: string; etag: string }

function loadAssets(dir: string): Map<string, Asset> {
  const out = new Map<string, Asset>();
  for (const f of readdirSync(dir)) {
    const ext = f.slice(f.lastIndexOf("."));
    const type = TYPES[ext];
    if (!type) continue;
    const body = readFileSync(join(dir, f));
    out.set(f, { body, type, etag: `"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"` });
  }
  return out;
}

function loginPage(error?: string): string {
  return `<!doctype html>
<html lang="zh-HK"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Global Call CRM</title>
${AUTH_PAGE_HEAD}</head>
<body><form method="post" action="/app/login">
  ${AUTH_LOGO}
  ${error ? `<div class="err">${esc(error)}</div>` : ""}
  <input type="password" name="password" placeholder="密碼" autocomplete="current-password" autofocus required>
  <button type="submit">登入</button>
</form></body></html>`;
}

function readSmall(req: IncomingMessage, max = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c: Buffer) => {
      s += c.toString("utf8");
      if (s.length > max) { reject(new ApiError(413, "太大")); req.destroy(); }
    });
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

function readJsonBody(req: IncomingMessage, max = 1_000_000): Promise<unknown> {
  return readSmall(req, max).then((raw) => {
    if (!raw) return undefined;
    try { return JSON.parse(raw); } catch { throw new ApiError(400, "body 唔係合法 JSON"); }
  });
}

export function createApp(cfg: AppConfig) {
  const signer = createSigner(cfg.secret);
  const throttle = createThrottle();
  const oauth = createOAuth({ password: cfg.password, signer, throttle });
  const api = createApi({ sql: cfg.sql, ...(cfg.now ? { now: cfg.now } : {}) });
  const assets = loadAssets(cfg.publicDir);
  const now = cfg.now ?? (() => new Date());

  const loggedIn = (req: IncomingMessage) => {
    const t = readCookie(req, COOKIE);
    return t !== null && signer.verify(t, "session", now().getTime()) !== null;
  };

  function bearerOk(req: IncomingMessage): boolean {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
    return m !== null && oauth.verifyAccessToken(m[1]!.trim());
  }

  /** 跨站 POST：有 Origin 就一定要係自己。SameSite=Lax cookie 已經擋咗，呢個係第二層。 */
  function sameOrigin(req: IncomingMessage): boolean {
    const o = req.headers.origin;
    return !o || o === baseUrlOf(req);
  }

  function serveAsset(req: IncomingMessage, res: ServerResponse, name: string): boolean {
    const a = assets.get(name);
    if (!a) return false;
    if (req.headers["if-none-match"] === a.etag) { res.writeHead(304, { etag: a.etag }); res.end(); return true; }
    res.writeHead(200, { "content-type": a.type, etag: a.etag, "cache-control": "no-cache" });
    res.end(a.body);
    return true;
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    const m = req.method ?? "GET";

    if (path === "/health") {
      sendJson(res, 200, { ok: true, service: "global-call-crm", build: (cfg.build || "dev").slice(0, 12), ts: now().toISOString() });
      return;
    }
    if (path === "/" ) { res.writeHead(302, { location: "/app" }); res.end(); return; }
    if (path === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); res.end("User-agent: *\nDisallow: /\n"); return; }

    if (await oauth.handle(req, res, url)) return;

    if (path === "/app/login") {
      if (m === "GET") {
        if (loggedIn(req)) { res.writeHead(302, { location: "/app" }); res.end(); return; }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(loginPage());
        return;
      }
      if (m === "POST") {
        const ip = clientIp(req);
        const html = (status: number, msg: string) => {
          res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          res.end(loginPage(msg));
        };
        if (!sameOrigin(req)) return html(403, "唔係由呢個網頁送嘅登入");
        if (throttle.blocked(ip)) return html(429, "錯咗太多次，等 15 分鐘再試。");
        const pw = new URLSearchParams(await readSmall(req)).get("password") ?? "";
        if (!constantEq(pw, cfg.password)) { throttle.fail(ip); return html(401, "密碼唔啱"); }
        const token = signer.sign({ t: "session", exp: now().getTime() + SESSION_TTL_MS });
        res.writeHead(302, { location: "/app", "set-cookie": sessionCookie(req, token), "cache-control": "no-store" });
        res.end();
        return;
      }
    }
    if (path === "/app/logout" && m === "POST") {
      res.writeHead(302, { location: "/app/login", "set-cookie": sessionCookie(req, null) });
      res.end();
      return;
    }

    if (path.startsWith("/app/api/")) {
      if (!loggedIn(req)) { sendJson(res, 401, { error: "未登入（或者登入過咗期）", login: "/app/login" }); return; }
      if (m !== "GET" && !sameOrigin(req)) { sendJson(res, 403, { error: "跨站請求唔收" }); return; }
      await api.handle(req, res, url);
      return;
    }

    if (path === "/app" || path === "/app/") {
      if (!loggedIn(req)) { res.writeHead(302, { location: "/app/login" }); res.end(); return; }
      serveAsset(req, res, "index.html");
      return;
    }
    // 靜態檔（js／css）冇資料，唔使登入
    if (path.startsWith("/app/") && serveAsset(req, res, path.slice(5))) return;

    if (path === "/mcp") {
      if (!bearerOk(req)) {
        res.setHeader("www-authenticate",
          `Bearer realm="global-call-crm", resource_metadata="${baseUrlOf(req)}/.well-known/oauth-protected-resource"`);
        sendJson(res, 401, { error: "要 Authorization: Bearer <token>" });
        return;
      }
      // 無狀態：每個請求一套新 server + transport —— 部機重啟唔會斷
      const transport = new StreamableHTTPServerTransport({});
      const server = buildMcpServer(cfg.sql, now);
      res.on("close", () => { void transport.close(); void server.close(); });
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(req, res, await readJsonBody(req));
      return;
    }

    sendJson(res, 404, { error: "呢條路冇嘢 —— CRM 喺 /app" });
  }

  return (req: IncomingMessage, res: ServerResponse) => {
    route(req, res).catch((e: unknown) => {
      const status = e instanceof ApiError ? e.status : 400;
      const msg = e instanceof Error ? e.message : String(e);
      if (!(e instanceof ApiError)) console.error(`[global-call-crm] ${req.method} ${req.url}: ${msg}`);
      if (!res.headersSent) sendJson(res, status, { error: msg });
      else res.end();
    });
  };
}
