/**
 * OAuth 2.1 —— 專為 claude.ai Custom Connector（「同 Claude 講一句就入記錄」）。
 *
 * claude.ai 網頁版**淨係識 OAuth**（個 connector 對話框冇位填 Bearer token）。
 * 做法搬自 Equal CRM（用咗兩個月冇出事）：
 *   · 動態註冊（DCR）：claude.ai 自己註冊，唔使填 Client ID／Secret
 *   · PKCE（S256）
 *   · 全部 token 自己簽自己驗，server 唔記嘢（見 security.ts）
 *
 * 真正把關嘅係 /authorize 嗰版：要打啱 APP_PASSWORD 先發 code。
 * 註冊唔算認證 —— 冇呢道門，任何人加個 connector 就入到成個客戶名單。
 */

import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { baseUrlOf, clientIp, constantEq, esc, type Signer, type Throttle } from "./security.js";

const CODE_TTL_MS = 5 * 60_000;
const ACCESS_TTL_MS = 30 * 24 * 3600_000;
const REFRESH_TTL_MS = 180 * 24 * 3600_000;
const MAX_BODY_BYTES = 100_000;

function readRaw(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error("body 太大")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

export function authorizePage(params: Record<string, string>, error?: string): string {
  const hidden = Object.entries(params)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("\n    ");
  return `<!doctype html>
<html lang="zh-HK"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Global Call CRM —— 授權</title>
<link rel="icon" href="data:,">
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "PingFang HK", "Noto Sans HK", sans-serif;
         display: grid; place-items: center; min-height: 100vh; margin: 0; background: #f4f5f7; color: #1b1d21; }
  @media (prefers-color-scheme: dark) { body { background: #16181c; color: #eceef1; } }
  form { width: min(92vw, 26rem); padding: 2rem; border-radius: 14px; background: Canvas;
         box-shadow: 0 1px 3px rgba(0,0,0,.14), 0 8px 28px rgba(0,0,0,.10); }
  h1 { font-size: 1.15rem; margin: 0 0 .35rem; }
  p { font-size: .875rem; opacity: .75; margin: 0 0 1.25rem; line-height: 1.5; }
  label { display: block; font-size: .8rem; font-weight: 600; margin-bottom: .4rem; }
  input[type=password] { width: 100%; box-sizing: border-box; padding: .6rem .7rem; font-size: 1rem;
         border: 1px solid #8884; border-radius: 8px; background: Canvas; color: CanvasText; }
  button { width: 100%; margin-top: 1rem; padding: .65rem; font-size: .95rem; font-weight: 600; border: 0;
           border-radius: 8px; background: #1f5fbf; color: #fff; cursor: pointer; }
  .err { background: #d7263d18; border: 1px solid #d7263d55; color: #b3172f; padding: .55rem .7rem;
         border-radius: 8px; font-size: .85rem; margin-bottom: 1rem; }
</style></head>
<body>
  <form method="post" action="/authorize">
    <h1>Global Call CRM</h1>
    <p>claude.ai 想連接你個 CRM（之後可以喺對話入面記電話、查公司）。<br>入你登入 CRM 嗰個密碼批准。</p>
    ${error ? `<div class="err">${esc(error)}</div>` : ""}
    <label for="pw">密碼</label>
    <input id="pw" type="password" name="password" autocomplete="current-password" autofocus required>
    ${hidden}
    <button type="submit">批准連接</button>
  </form>
</body></html>`;
}

export function createOAuth(cfg: { password: string; signer: Signer; throttle: Throttle }) {
  const { sign, verify } = cfg.signer;

  function verifyAccessToken(token: string): boolean {
    return verify(token, "access") !== null;
  }

  function errorPage(res: ServerResponse, status: number, msg: string): void {
    html(res, status, `<!doctype html><meta charset="utf-8"><title>接唔到</title>` +
      `<body style="font-family:system-ui;padding:2rem;max-width:34rem;margin:auto">` +
      `<h1 style="font-size:1.1rem">接唔到</h1><p>${esc(msg)}</p></body>`);
  }

  function tokens(aud: unknown) {
    return {
      access_token: sign({ t: "access", exp: Date.now() + ACCESS_TTL_MS, aud }),
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TTL_MS / 1000),
      refresh_token: sign({ t: "refresh", exp: Date.now() + REFRESH_TTL_MS, aud }),
      scope: "crm",
    };
  }

  /** 處理咗回 true；唔關 OAuth 事回 false。 */
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname;
    const base = baseUrlOf(req);

    if (req.method === "OPTIONS" && (path.startsWith("/.well-known/") || path === "/register" || path === "/token")) {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, authorization, mcp-protocol-version",
        "access-control-max-age": "86400",
      });
      res.end();
      return true;
    }

    // RFC 9728：呢個 resource 由邊個 authorization server 睇住
    if (path.startsWith("/.well-known/oauth-protected-resource")) {
      json(res, 200, {
        resource: `${base}/mcp`, authorization_servers: [base],
        bearer_methods_supported: ["header"], scopes_supported: ["crm"],
      });
      return true;
    }

    // RFC 8414
    if (path.startsWith("/.well-known/oauth-authorization-server") || path.startsWith("/.well-known/openid-configuration")) {
      json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: ["crm"],
      });
      return true;
    }

    // RFC 7591 動態註冊：redirect_uris 簽落 client_id 入面，唔使查表
    if (path === "/register" && req.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        const raw = await readRaw(req);
        if (raw) body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        json(res, 400, { error: "invalid_client_metadata" });
        return true;
      }
      const uris = Array.isArray(body["redirect_uris"])
        ? (body["redirect_uris"] as unknown[]).filter((u): u is string => typeof u === "string")
        : [];
      if (!uris.length) {
        json(res, 400, { error: "invalid_redirect_uri", error_description: "要有 redirect_uris" });
        return true;
      }
      const clientId = sign({ t: "client", exp: Date.now() + 10 * 365 * 24 * 3600_000, u: uris });
      json(res, 201, {
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        client_name: typeof body["client_name"] === "string" ? body["client_name"] : "claude",
      });
      return true;
    }

    if (path === "/authorize" && (req.method === "GET" || req.method === "POST")) {
      let q: URLSearchParams;
      let password = "";
      if (req.method === "GET") q = url.searchParams;
      else {
        q = new URLSearchParams(await readRaw(req));
        password = q.get("password") ?? "";
      }
      const clientId = q.get("client_id") ?? "";
      const redirectUri = q.get("redirect_uri") ?? "";
      const challenge = q.get("code_challenge") ?? "";
      const method = q.get("code_challenge_method") ?? "";
      const state = q.get("state") ?? "";
      const resource = q.get("resource") ?? "";
      const scope = q.get("scope") ?? "";

      const client = verify(clientId, "client");
      if (!client) {
        errorPage(res, 400, "client_id 認唔到。喺 claude.ai 剷咗個 connector 再加過。");
        return true;
      }
      const allowed = Array.isArray(client["u"]) ? (client["u"] as string[]) : [];
      // redirect_uri 未驗到就唔可以 redirect —— 唔係就變成開放轉址器
      if (!allowed.includes(redirectUri)) {
        errorPage(res, 400, "redirect_uri 同註冊嗰陣唔夾。");
        return true;
      }
      if (method !== "S256" || challenge === "") {
        errorPage(res, 400, "要用 PKCE（S256）。");
        return true;
      }
      const carry = {
        client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge,
        code_challenge_method: method, state, resource, scope,
      };
      if (req.method === "GET") {
        html(res, 200, authorizePage(carry));
        return true;
      }
      const ip = clientIp(req);
      if (cfg.throttle.blocked(ip)) {
        html(res, 429, authorizePage(carry, "錯咗太多次，等 15 分鐘再試。"));
        return true;
      }
      if (!constantEq(password, cfg.password)) {
        cfg.throttle.fail(ip);
        html(res, 401, authorizePage(carry, "密碼唔啱。"));
        return true;
      }
      const code = sign({ t: "code", exp: Date.now() + CODE_TTL_MS, c: clientId, r: redirectUri, cc: challenge, aud: resource });
      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      if (state) back.searchParams.set("state", state);
      res.writeHead(302, { location: back.toString(), "cache-control": "no-store" });
      res.end();
      return true;
    }

    if (path === "/token" && req.method === "POST") {
      const form = new URLSearchParams(await readRaw(req));
      const grant = form.get("grant_type") ?? "";
      if (grant === "authorization_code") {
        const code = verify(form.get("code") ?? "", "code");
        if (!code) {
          json(res, 400, { error: "invalid_grant", error_description: "授權碼過期或者唔啱" });
          return true;
        }
        if (code["r"] !== (form.get("redirect_uri") ?? "")) {
          json(res, 400, { error: "invalid_grant", error_description: "redirect_uri 唔夾" });
          return true;
        }
        const verifier = form.get("code_verifier") ?? "";
        const got = createHash("sha256").update(verifier).digest("base64url");
        if (verifier === "" || !constantEq(got, String(code["cc"]))) {
          json(res, 400, { error: "invalid_grant", error_description: "PKCE 驗唔過" });
          return true;
        }
        json(res, 200, tokens(code["aud"]));
        return true;
      }
      if (grant === "refresh_token") {
        const rt = verify(form.get("refresh_token") ?? "", "refresh");
        if (!rt) {
          json(res, 400, { error: "invalid_grant", error_description: "refresh token 過期或者唔啱" });
          return true;
        }
        json(res, 200, tokens(rt["aud"]));
        return true;
      }
      json(res, 400, { error: "unsupported_grant_type" });
      return true;
    }
    return false;
  }

  return { handle, verifyAccessToken };
}

export type OAuth = ReturnType<typeof createOAuth>;
