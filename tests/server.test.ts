/**
 * 成個 server 開真 port、打真 HTTP request、寫真 Postgres（真 migration）。
 * 驗嘅係「底下真係寫咗乜」，唔係淨係 status code。
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { makeCompany, useTestDb } from "./helpers/db.js";

const t = useTestDb();
const PASSWORD = "correct-horse-battery";
const SECRET = "s".repeat(40);
// 時鐘釘死：2026-10-14（三）香港時間朝早 10 點
let clock = new Date("2026-10-14T10:00:00+08:00");
let server: Server;
let base = "";

beforeAll(async () => {
  const handler = createApp({
    sql: () => t.sql, password: PASSWORD, secret: SECRET,
    publicDir: join(import.meta.dirname, "..", "public"), build: "abc1234def5678", now: () => clock,
  });
  server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function login(): Promise<string> {
  const r = await fetch(`${base}/app/login`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: PASSWORD }),
  });
  expect(r.status).toBe(302);
  const c = r.headers.get("set-cookie")!;
  expect(c).toMatch(/HttpOnly/);
  return c.split(";")[0]!;
}

async function api(cookie: string, path: string, body?: unknown) {
  const r = await fetch(`${base}/app/api${path}`, body === undefined ? { headers: { cookie } } : {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const j = (await r.json()) as Record<string, unknown>;
  return { status: r.status, j };
}

describe("開機同登入", () => {
  it("/health 報 build，唔使登入", async () => {
    const j = await (await fetch(`${base}/health`)).json();
    expect(j).toMatchObject({ ok: true, build: "abc1234def56" });
  });

  it("未登入：/app 轉去登入頁；API 回 401", async () => {
    const r = await fetch(`${base}/app`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/app/login");
    expect((await fetch(`${base}/app/api/today`)).status).toBe(401);
  });

  it("密碼錯回 401；cookie 竄改過、過咗期都唔認", async () => {
    const bad = await fetch(`${base}/app/login`, {
      method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", "fly-client-ip": "9.9.9.1" },
      body: "password=wrong",
    });
    expect(bad.status).toBe(401);
    const cookie = await login();
    expect((await api(cookie, "/today")).status).toBe(200);
    // 改一個字
    const [k, v] = cookie.split("=");
    const tampered = `${k}=${v!.slice(0, -2)}${v!.endsWith("A") ? "B" : "A"}${v!.slice(-1)}`;
    expect((await api(tampered, "/today")).status).toBe(401);
    // 61 日後過期
    const saved = clock;
    clock = new Date(clock.getTime() + 61 * 24 * 3600_000);
    expect((await api(cookie, "/today")).status).toBe(401);
    clock = saved;
  });

  it("❗同一個 IP 錯 10 次之後鎖住，連啱嘅密碼都唔收", async () => {
    const h = { "content-type": "application/x-www-form-urlencoded", "fly-client-ip": "9.9.9.2" };
    for (let i = 0; i < 10; i++) {
      await fetch(`${base}/app/login`, { method: "POST", redirect: "manual", headers: h, body: "password=x" });
    }
    const r = await fetch(`${base}/app/login`, { method: "POST", redirect: "manual", headers: h, body: `password=${PASSWORD}` });
    expect(r.status).toBe(429);
  });

  it("登入頁有 logo；加到主畫面嘅 manifest 同每個 icon 都攞得到（唔使登入）", async () => {
    const page = await (await fetch(`${base}/app/login`)).text();
    for (const src of ["/app/logo.png", "/app/favicon.png", "/app/apple-touch-icon.png"]) {
      expect(page).toContain(src);
      const r = await fetch(`${base}${src}`);
      expect([r.status, r.headers.get("content-type")]).toEqual([200, "image/png"]);
    }
    const mr = await fetch(`${base}/app/manifest.webmanifest`);
    expect(mr.headers.get("content-type")).toBe("application/manifest+json");
    const m = (await mr.json()) as { start_url: string; icons: { src: string; sizes: string }[] };
    expect(m.start_url).toBe("/app");
    for (const ic of m.icons) {
      const r = await fetch(`${base}${ic.src}`);
      expect(r.status).toBe(200);
      // PNG 個闊高喺 byte 16–23：要同 manifest 講嘅 sizes 一樣
      const b = Buffer.from(await r.arrayBuffer());
      expect(`${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`).toBe(ic.sizes);
    }
  });

  it("API 寫入：唔係 JSON 唔收（擋 CSRF）；Origin 係第三方唔收", async () => {
    const cookie = await login();
    const form = await fetch(`${base}/app/api/companies`, {
      method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: "name_zh=x",
    });
    expect(form.status).toBe(415);
    const xs = await fetch(`${base}/app/api/companies`, {
      method: "POST", headers: { cookie, "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ name_zh: "壞人公司" }),
    });
    expect(xs.status).toBe(403);
    const rows = await t.sql`select 1 from public.companies where name_zh = '壞人公司'`;
    expect(rows.length).toBe(0);
  });
});

describe("冷電成條路（經 API）", () => {
  it("開公司（一格兩個號＋傳真）→ 查重 → 記電話 → 回撥 → 今日數 → 篩 R → 導出 Excel", async () => {
    const cookie = await login();
    const c1 = await api(cookie, "/companies", {
      name_zh: "大發物流有限公司", name_en: "Tai Fat Logistics Ltd", industry: "物流",
      phonesText: "2345 6789 / 傳真 2345 6790", emailsText: "info@taifat.hk",
    });
    expect(c1.status).toBe(200);
    const created = (c1.j.created as { id: string; code: string });
    expect(created.code).toMatch(/^GC-\d{5}$/);

    // 同一個電話再開 → 唔開，回撞咗邊間
    const dup = await api(cookie, "/companies", { name_zh: "大發運輸", phonesText: "23456789" });
    expect(dup.j.created).toBeNull();
    expect((dup.j.duplicates as { code: string }[])[0]!.code).toBe(created.code);

    // 電話認唔到 → 拒絕講原因，唔靜靜雞丟
    const badPhone = await api(cookie, "/companies", { name_zh: "錯號公司", phonesText: "1234 5678" });
    expect(badPhone.status).toBe(400);
    expect(badPhone.j.error).toMatch(/1234 5678/);

    // 記電話：幾點鐘再打（香港時間 10/20 15:00）、R、D
    const call = await api(cookie, "/calls", {
      companyId: created.id, outcome: "幾點鐘再打", callbackAt: "2026-10-20T15:00",
      content: "IT 經理 Peter，CSL 30 條 SIM", reachedR: true, dContractEnd: "2027-03-31", dProvider: "CSL",
    });
    expect(call.status).toBe(200);
    expect(call.j).toMatchObject({ statusBefore: "未打", statusAfter: "跟進中", connected: true });
    const [row] = await t.sql`select k.attempt_no, k.reached_r, k.got_d, k.called_at, cc.provider from public.calls k
                                left join public.call_carriers cc on cc.call_id = k.id where k.company_id = ${created.id}`;
    expect(row).toMatchObject({ attempt_no: 1, reached_r: true, got_d: true, provider: "CSL" });
    expect((row!.called_at as Date).toISOString()).toBe("2026-10-14T02:00:00.000Z");
    const [task] = await t.sql`select kind, due_at from public.tasks where company_id = ${created.id} and status = '待辦'`;
    expect(task!.kind).toBe("回撥");
    expect((task!.due_at as Date).toISOString()).toBe("2026-10-20T07:00:00.000Z"); // 香港 15:00

    // 「幾點鐘再打」冇時間 → 400，DB 冇多一行
    const noTime = await api(cookie, "/calls", { companyId: created.id, outcome: "幾點鐘再打" });
    expect(noTime.status).toBe(400);
    expect((await t.sql`select 1 from public.calls where company_id = ${created.id}`).length).toBe(1);

    const today = await api(cookie, "/today");
    expect(today.j.today).toBe("2026-10-14");
    expect(today.j.stats).toMatchObject({ calls: 1, connected: 1, r: 1, d: 1 });

    // 篩 R：計到呢間；公司詳情下次係第 2 次
    const listR = await api(cookie, "/companies?r=yes");
    expect(listR.j.totalR).toBeGreaterThanOrEqual(1);
    expect((listR.j.rows as { id: string }[]).some((r) => r.id === created.id)).toBe(true);
    const detail = await api(cookie, `/companies/${created.id}`);
    expect(detail.j.nextAttempt).toBe(2);

    // 導出 Excel：真係開得返、電話欄傳真有標、篩選 sheet 有 R 數
    const x = await fetch(`${base}/app/api/companies.xlsx?r=yes`, { headers: { cookie } });
    expect(x.headers.get("content-type")).toMatch(/spreadsheetml/);
    expect(x.headers.get("content-disposition")).toMatch(/filename\*=UTF-8''/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await x.arrayBuffer());
    const ws = wb.getWorksheet("公司")!;
    expect(ws.getRow(1).getCell(1).value).toBe("編號");
    const hit = ws.getRows(2, ws.rowCount - 1)!.find((r) => r.getCell(1).value === created.code)!;
    expect(hit.getCell(6).value).toBe("23456789 / 23456790（傳真）");
    expect(hit.getCell(13).value).toBe("✓");
    expect(hit.getCell(15).value).toBe("2027-03-31");
    const info = wb.getWorksheet("篩選")!;
    const vals = info.getSheetValues().filter(Boolean).map((r) => (r as unknown[]).slice(1).join("|"));
    expect(vals).toContain("篩選|R：有");
  });

  it("回撥清單：撳完成就收；再記一次電話自動收舊回撥", async () => {
    const cookie = await login();
    const id = await makeCompany(t.sql, { name_zh: "回撥測試公司", phones: ["27771234"] });
    await api(cookie, "/calls", { companyId: id, outcome: "稍後再撥打" });
    let due = (await api(cookie, "/today")).j.due as { id: string; company_id: string }[];
    const task = due.find((x) => x.company_id === id)!;
    expect(task).toBeTruthy();
    expect((await api(cookie, `/tasks/${task.id}/done`, {})).status).toBe(200);
    due = (await api(cookie, "/today")).j.due as { id: string; company_id: string }[];
    expect(due.some((x) => x.company_id === id)).toBe(false);

    await api(cookie, "/calls", { companyId: id, outcome: "需要跟進" });
    await api(cookie, "/calls", { companyId: id, outcome: "不需要" });
    const open = await t.sql`select 1 from public.tasks where company_id = ${id} and status = '待辦'`;
    expect(open.length).toBe(0);
  });

  it("匯入：preview 唔寫；commit 先寫，而且對返當刻 CRM", async () => {
    const cookie = await login();
    const file = "﻿中文名,英文名,總機,傳真\n匯入甲公司,Import A Ltd,2811 0001,2811 0002\n回撥測試公司,,2811 0003,\n";
    const pre = await fetch(`${base}/app/api/import/preview?filename=list.csv`, {
      method: "POST", headers: { cookie, "content-type": "text/csv" }, body: file,
    });
    const pj = (await pre.json()) as { counts: Record<string, number>; issues: { reason: string }[] };
    expect(pj.counts).toMatchObject({ total: 2, new: 1, existingName: 1 });
    expect((await t.sql`select 1 from public.companies where name_zh = '匯入甲公司'`).length).toBe(0);
    const com = await fetch(`${base}/app/api/import/commit?filename=list.csv`, {
      method: "POST", headers: { cookie, "content-type": "text/csv" }, body: file,
    });
    expect(((await com.json()) as { created: number }).created).toBe(1);
    const [c] = await t.sql`select id, source from public.companies where name_zh = '匯入甲公司'`;
    expect(c!.source).toBe("list.csv（2026-10-14 匯入）");
    const ph = await t.sql`select phone, label from public.company_phones where company_id = ${c!.id} order by sort`;
    expect(ph).toEqual([{ phone: "28110001", label: "總機" }, { phone: "28110002", label: "傳真" }]);
  });

  it("產品：加、改名撞名擋住、剔落公司做興趣", async () => {
    const cookie = await login();
    const p = await api(cookie, "/products", { name: "測試產品 X", category: "測試" });
    const pid = p.j.id as string;
    const clash = await api(cookie, "/products", { name: "測試產品x" });
    expect(clash.status).toBe(400);
    const id = await makeCompany(t.sql, { name_zh: "興趣測試公司" });
    await api(cookie, `/companies/${id}`, { productIds: [pid] });
    const list = await api(cookie, `/companies?productId=${pid}`);
    expect(list.j.total).toBe(1);
  });
});

// ── claude.ai connector：OAuth → /mcp ─────────────────────────────────────

async function oauthToken(): Promise<string> {
  const reg = await (await fetch(`${base}/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], client_name: "claude" }),
  })).json() as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = {
    client_id: reg.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    code_challenge: challenge, code_challenge_method: "S256", state: "st",
  };
  const page = await fetch(`${base}/authorize?${new URLSearchParams(params)}`);
  expect(await page.text()).toMatch(/批准連接/);
  const wrong = await fetch(`${base}/authorize`, {
    method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", "fly-client-ip": "8.8.8.1" },
    body: new URLSearchParams({ ...params, password: "nope" }),
  });
  expect(wrong.status).toBe(401);
  const ok = await fetch(`${base}/authorize`, {
    method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, password: PASSWORD }),
  });
  expect(ok.status).toBe(302);
  const loc = new URL(ok.headers.get("location")!);
  expect(loc.searchParams.get("state")).toBe("st");
  const tok = await (await fetch(`${base}/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code: loc.searchParams.get("code")!,
      redirect_uri: params.redirect_uri, code_verifier: verifier,
    }),
  })).json() as { access_token: string };
  return tok.access_token;
}

let rpcId = 1;
async function mcp(token: string, method: string, params: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
  });
  expect(r.status).toBe(200);
  const text = await r.text();
  const data = text.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(data ? data.slice(6) : text) as Record<string, unknown>;
}

async function tool(token: string, name: string, args: Record<string, unknown>) {
  const r = await mcp(token, "tools/call", { name, arguments: args });
  const res = r.result as { content: { text: string }[]; isError?: boolean };
  return { isError: res.isError === true, body: res.isError ? res.content[0]!.text : JSON.parse(res.content[0]!.text) };
}

describe("claude.ai connector", () => {
  it("冇 token／假 token → 401，有指返去 OAuth", async () => {
    const r = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: "Bearer fake.token" } });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/oauth-protected-resource/);
  });

  it("❗PKCE 驗唔過唔發 token", async () => {
    const reg = await (await fetch(`${base}/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://claude.ai/cb"] }),
    })).json() as { client_id: string };
    const challenge = createHash("sha256").update("real-verifier").digest("base64url");
    const ok = await fetch(`${base}/authorize`, {
      method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: reg.client_id, redirect_uri: "https://claude.ai/cb", code_challenge: challenge,
        code_challenge_method: "S256", password: PASSWORD }),
    });
    const code = new URL(ok.headers.get("location")!).searchParams.get("code")!;
    const tok = await fetch(`${base}/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: "https://claude.ai/cb", code_verifier: "wrong" }),
    });
    expect(tok.status).toBe(400);
  });

  it("OAuth 拎 token → tools/list → log_call 一句入齊（R、D、回撥、興趣產品），DB 真係有", async () => {
    const token = await oauthToken();
    const list = await mcp(token, "tools/list", {});
    const names = ((list.result as { tools: { name: string }[] }).tools).map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["log_call", "search_company", "today_stats", "callbacks_today", "create_company"]));

    const c = await tool(token, "create_company", { name_zh: "對話開嘅公司", phones: "3111 2222" });
    expect(c.body.saved).toBe(true);
    const code = c.body.company.code as string;

    const r = await tool(token, "log_call", {
      company: code, outcome: "需要跟進", reachedR: true, dContractEnd: "2027-03-31", dProvider: "CMHK",
      dPrice: "$198/月 × 12 條", callbackAt: "2026-10-20 15:00", content: "老闆陳生，想睇 SME Bundle",
      interestedProducts: ["Business Connect"],
    });
    expect(r.isError).toBe(false);
    expect(r.body).toMatchObject({ saved: true, status: "未打 → 跟進中" });
    expect(r.body.newTask.due).toBe("10/20（二）15:00");
    expect(r.body.interestedProducts).toEqual(["SME Bundle — Business Connect"]);
    const [row] = await t.sql`
      select k.reached_r, k.got_d, cc.price, cc.contract_end::text as contract_end from public.calls k
        join public.companies c on c.id = k.company_id
        join public.call_carriers cc on cc.call_id = k.id where c.code = ${code}`;
    expect(row).toMatchObject({ reached_r: true, got_d: true, price: "$198/月 × 12 條", contract_end: "2027-03-31" });
    const [a] = await t.sql`select actor from public.audit_log where action = 'log_call' order by at desc limit 1`;
    expect(a!.actor).toBe("claude");
  });

  it("❗名搜出幾間 → 唔寫，回候選", async () => {
    const token = await oauthToken();
    await makeCompany(t.sql, { name_zh: "重名科技有限公司" });
    await makeCompany(t.sql, { name_zh: "重名科技（香港）有限公司" });
    const before = (await t.sql`select count(*)::int as n from public.calls`)[0]!.n;
    const r = await tool(token, "log_call", { company: "重名科技", outcome: "沒有人接" });
    expect(r.body).toMatchObject({ saved: false, needChoice: true });
    expect(r.body.candidates.length).toBe(2);
    expect((await t.sql`select count(*)::int as n from public.calls`)[0]!.n).toBe(before);
  });

  it("規則照守：「其他人跟進」冇同事名 → 錯，冇寫", async () => {
    const token = await oauthToken();
    const id = await makeCompany(t.sql, { name_zh: "同事跟公司" });
    const r = await tool(token, "log_call", { company: id, outcome: "其他人跟進" });
    expect(r.isError).toBe(true);
    expect((await t.sql`select 1 from public.calls where company_id = ${id}`).length).toBe(0);
  });

  it("today_stats 回今日日期連星期", async () => {
    const token = await oauthToken();
    const r = await tool(token, "today_stats", {});
    expect(r.body.today).toBe("2026-10-14");
    expect(r.body.today_label).toBe("10/14（三）");
  });
});

// ── 第二期：預約、續約（經 API 同 MCP）─────────────────────────────────────

describe("預約（經 API）", () => {
  it("約見面連新聯絡人 → 時間表出公司名／聯絡人／地址 → 今日見客 → 見完寫備註＋下一步 → 今日數約／見 +1", async () => {
    const cookie = await login();
    const id = await makeCompany(t.sql, { name_zh: "API 約見公司", phones: ["26661234"] });
    await t.sql`update public.companies set address_zh = '荃灣楊屋道 8 號 12 樓' where id = ${id}`;
    const before = (await api(cookie, "/today")).j.stats as { booked: number; met: number };

    // 時鐘 10/14 10:00：約今日 16:00
    const r = await api(cookie, "/appointments", {
      companyId: id, startsAt: "2026-10-14T16:00", purpose: "傾 CloudPhone",
      newContact: { name: "李小姐", title: "行政經理", phone: "9876 5432" },
    });
    expect(r.status).toBe(200);
    const appt = (r.j.appointment as { id: string; address: string; contact_name: string; starts_at: string });
    expect(appt).toMatchObject({ address: "荃灣楊屋道 8 號 12 樓", contact_name: "李小姐" });
    expect(appt.starts_at).toBe("2026-10-14T08:00:00.000Z");

    const list = await api(cookie, "/appointments?from=2026-10-14&to=2026-10-14");
    const row = (list.j.rows as Record<string, unknown>[]).find((x) => x.id === appt.id)!;
    expect(row).toMatchObject({ company_name: "API 約見公司", contact_title: "行政經理", contact_phone: "9876 5432", company_phones: "26661234" });

    let today = await api(cookie, "/today");
    expect((today.j.appointments as { id: string }[]).some((x) => x.id === appt.id)).toBe(true);
    expect((today.j.stats as { booked: number }).booked).toBe(before.booked + 1);

    const done = await api(cookie, `/appointments/${appt.id}/done`, {
      meetingNotes: "用緊 3HK 15 條線，3 月到期", nextStepNote: "寄報價", nextStepAt: "2026-10-14T18:00",
    });
    expect(done.status).toBe(200);
    today = await api(cookie, "/today");
    expect((today.j.stats as { met: number }).met).toBe(before.met + 1);
    expect((today.j.due as { company_id: string; note: string }[]).find((x) => x.company_id === id)!.note).toBe("寄報價");
    const [a] = await t.sql`select status, meeting_notes from public.appointments where id = ${appt.id}`;
    expect(a).toMatchObject({ status: "已見", meeting_notes: "用緊 3HK 15 條線，3 月到期" });

    // 公司頁帶埋呢間公司啲約
    const detail = await api(cookie, `/companies/${id}`);
    expect((detail.j.appointments as { id: string }[]).map((x) => x.id)).toContain(appt.id);
  });

  it("冇揀時間 → 400，乜都冇寫；改期送新時間 → 改咗；取消送原因", async () => {
    const cookie = await login();
    const id = await makeCompany(t.sql, { name_zh: "API 改期公司" });
    const bad = await api(cookie, "/appointments", { companyId: id, startsAt: "" });
    expect(bad.status).toBe(400);
    expect((await t.sql`select 1 from public.appointments where company_id = ${id}`).length).toBe(0);
    const r = await api(cookie, "/appointments", { companyId: id, startsAt: "2026-10-21T10:00", address: null });
    const aid = (r.j.appointment as { id: string }).id;
    const m = await api(cookie, `/appointments/${aid}`, { startsAt: "2026-10-22T11:00", purpose: "改咗目的" });
    expect(m.j.appointment).toMatchObject({ starts_at: "2026-10-22T03:00:00.000Z", purpose: "改咗目的", rescheduled: 1, address: null });
    await api(cookie, `/appointments/${aid}/cancel`, { reason: "佢出咗差" });
    const [x] = await t.sql`select status, meeting_notes from public.appointments where id = ${aid}`;
    expect(x).toMatchObject({ status: "取消", meeting_notes: "取消：佢出咗差" });
  });
});

describe("續約（經 API）", () => {
  it("D 到期 60 日內 → 出；收埋 → 唔出", async () => {
    const cookie = await login();
    const id = await makeCompany(t.sql, { name_zh: "API 續約公司" });
    const [k] = await t.sql<{ id: string }[]>`insert into public.calls (company_id, called_at, attempt_no, outcome, reached_r, got_d)
                values (${id}, '2026-05-01T02:00:00Z', 1, '需要跟進', true, true) returning id`;
    await t.sql`insert into public.call_carriers (call_id, provider, contract_end) values (${k!.id}, 'SmarTone', '2026-12-13')`;
    const r = await api(cookie, "/renewals");
    const hit = (r.j.rows as { company_id: string; stage: number; days_left: number; provider: string }[]).find((x) => x.company_id === id)!;
    expect(hit).toMatchObject({ stage: 1, days_left: 60, provider: "SmarTone" });
    expect(((await api(cookie, "/today")).j.renewals as { company_id: string }[]).some((x) => x.company_id === id)).toBe(true);
    await api(cookie, "/renewals/dismiss", { companyId: id, contractEnd: "2026-12-13", stage: 1 });
    expect(((await api(cookie, "/renewals")).j.rows as { company_id: string }[]).some((x) => x.company_id === id)).toBe(false);
  });
});

describe("claude.ai connector：預約", () => {
  it("book_appointment：同名聯絡人用返現有（空格唔理）、地址預設公司、DB 真係有；appointment_action done 讀返已見", async () => {
    const token = await oauthToken();
    const id = await makeCompany(t.sql, { name_zh: "對話約見公司" });
    await t.sql`update public.companies set address_zh = '九龍灣宏光道 1 號' where id = ${id}`;
    const [k] = await t.sql`insert into public.contacts (company_id, name) values (${id}, 'Peter Chan') returning id`;
    const r = await tool(token, "book_appointment", {
      company: id, startsAt: "2026-10-20 15:00", contact: "peter  chan", purpose: "SME Bundle",
    });
    expect(r.isError).toBe(false);
    expect(r.body).toMatchObject({ saved: true, newContact: false });
    expect(r.body.appointment).toMatchObject({ when: "10/20（二）15:00", address: "九龍灣宏光道 1 號", contact: "Peter Chan" });
    const [row] = await t.sql`select contact_id from public.appointments where id = ${r.body.appointment.appointment_id}`;
    expect(row!.contact_id).toBe(k!.id);

    const d = await tool(token, "appointment_action", {
      appointment_id: r.body.appointment.appointment_id, action: "done", meetingNotes: "有興趣",
      nextStepNote: "寄報價", nextStepAt: "2026-10-21 10:00",
    });
    expect(d.body).toMatchObject({ saved: true, appointment: { status: "已見", meeting_notes: "有興趣" } });
    expect(d.body.followUpTaskId).toBeTruthy();
  });

  it("book_appointment 名搜到幾間 → 唔寫，回候選", async () => {
    const token = await oauthToken();
    await makeCompany(t.sql, { name_zh: "雙胞胎物流有限公司" });
    await makeCompany(t.sql, { name_zh: "雙胞胎物流（香港）有限公司" });
    const before = (await t.sql`select count(*)::int as n from public.appointments`)[0]!.n;
    const r = await tool(token, "book_appointment", { company: "雙胞胎物流", startsAt: "2026-10-20 15:00" });
    expect(r.body).toMatchObject({ saved: false, needChoice: true });
    expect((await t.sql`select count(*)::int as n from public.appointments`)[0]!.n).toBe(before);
  });

  it("add_remark 寫得入、網頁 API 讀得返；get_company 帶埋備註", async () => {
    const token = await oauthToken();
    const c = await tool(token, "create_company", { name_zh: "備註測試公司", phones: "3999 8888" });
    const code = c.body.company.code as string;
    const r = await tool(token, "add_remark", { company: code, text: "Left phone number to reception" });
    expect(r.body).toMatchObject({ saved: true, by: "Claude", text: "Left phone number to reception" });
    const g = await tool(token, "get_company", { company: code });
    expect(g.body.remarks).toEqual([expect.objectContaining({ by: "Claude", text: "Left phone number to reception" })]);
    const cookie = await login();
    const page = await api(cookie, `/companies/${code}`);
    expect(page.status).toBe(200);
    expect((page.j.remarks as { body: string; source: string }[]).map((x) => [x.body, x.source]))
      .toEqual([["Left phone number to reception", "mcp"]]);
  });

  it("today_stats 有今日約；renewals_due 列得出", async () => {
    const token = await oauthToken();
    const r = await tool(token, "today_stats", {});
    expect(Array.isArray(r.body.appointments)).toBe(true);
    expect(r.body.stats).toHaveProperty("booked");
    const rn = await tool(token, "renewals_due", {});
    expect(rn.body).toHaveProperty("rows");
  });
});
