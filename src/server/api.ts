/**
 * /app/api/* —— 網頁用嘅 JSON API（要登入 cookie，http.ts 先驗）。
 *
 * 規矩：
 *   · 寫入一律行 domain 層（transaction ＋ audit），呢度淨係拆參數、驗格式。
 *   · 錯誤回 { error: "人睇得明嘅中文" }，網頁照出。
 *   · 回應有 meta.today（香港日子）—— 網頁唔使自己估今日係幾號。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import {
  cancelAppointment, companyAppointments, completeAppointment, createAppointment, listAppointments,
  noShowAppointment, rescheduleAppointment, updateAppointment, type AppointmentRow,
} from "../domain/appointments.js";
import { deleteCall, logCall, updateCall } from "../domain/calls.js";
import {
  addContact, createCompany, deleteCompany, deleteContact, emailsFromText, getCompany, listCompanies, listIndustries,
  phonesFromText, updateCompany, updateContact, type CompanyFilters, type CompanyInput,
} from "../domain/companies.js";
import { companiesXlsx } from "../domain/export.js";
import { commitImport, loadExisting, planImport, readTable, type ImportPlan } from "../domain/importer.js";
import { COMPANY_STATUSES, OUTCOMES, RULES } from "../domain/outcomes.js";
import { createProduct, listProducts, updateProduct } from "../domain/products.js";
import { addRemark, deleteRemark } from "../domain/remarks.js";
import { dismissRenewal, renewalsDue } from "../domain/renewals.js";
import { dailyStats, DETAIL_KINDS, periodTotals, statsDetail, todayStats, type DetailKind } from "../domain/stats.js";
import { callbacksDue, callbacksUpcoming, cancelTask, completeTask, rescheduleTask } from "../domain/tasks.js";
import { addDays, assertDay, hkToday, parseHkDateTime } from "../lib/time.js";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const MAX_JSON = 1_000_000;
const MAX_UPLOAD = 15_000_000;

function readBuf(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) { reject(new ApiError(413, `太大（上限 ${Math.round(max / 1e6)}MB）`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const ct = String(req.headers["content-type"] ?? "");
  // ❗唔收 form／text：跨站表單送唔到 application/json（要 preflight），呢度順便擋 CSRF
  if (!ct.startsWith("application/json")) throw new ApiError(415, "要 application/json");
  const raw = (await readBuf(req, MAX_JSON)).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new ApiError(400, "body 唔係合法 JSON"); }
}

/** 剝走 undefined 嘅 key（exactOptionalPropertyTypes：「冇畀」同「畀咗 undefined」係兩回事）。 */
type NoUndef<T> = T extends object ? { [K in keyof T]: Exclude<T[K], undefined> } : T;

function parse<T>(schema: z.ZodType<T>, v: unknown): NoUndef<T> {
  const r = schema.safeParse(v);
  if (r.success) {
    const d = r.data as unknown;
    if (d && typeof d === "object" && !Array.isArray(d) && !(d instanceof Date)) {
      for (const [k, x] of Object.entries(d)) if (x === undefined) delete (d as Record<string, unknown>)[k];
    }
    return d as NoUndef<T>;
  }
  const i = r.error.issues[0]!;
  throw new ApiError(400, `「${i.path.join(".") || "資料"}」唔啱：${i.message}`);
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

// ── 參數格式 ──────────────────────────────────────────────────────────────

const optText = z.string().max(5000).nullable().optional();
const uuid = z.string().regex(/^[0-9a-f-]{36}$/i, "唔係 id");
/** 「2026-10-20T15:00」（香港時間）→ Date；空 ＝ null */
const hkTime = z.string().nullable().optional().transform((s, ctx) => {
  if (s === null || s === undefined || s.trim() === "") return null;
  try { return parseHkDateTime(s); } catch (e) {
    ctx.addIssue({ code: "custom", message: e instanceof Error ? e.message : String(e) });
    return z.NEVER;
  }
});

/** 一定要有嘅香港時間 */
const hkTimeRequired = z.string().min(1, "要揀時間").transform((s, ctx) => {
  try { return parseHkDateTime(s); } catch (e) {
    ctx.addIssue({ code: "custom", message: e instanceof Error ? e.message : String(e) });
    return z.NEVER;
  }
});

const ApptBody = z.object({
  companyId: uuid,
  startsAt: hkTimeRequired,
  minutes: z.number().int().min(5).max(1440).optional(),
  contactId: uuid.nullable().optional(),
  newContact: z.object({ name: z.string().max(200), title: optText, phone: optText }).nullable().optional(),
  /** 唔畀 ＝ 用公司地址；null ＝ 唔填 */
  address: optText,
  purpose: optText,
});

const ApptPatch = z.object({
  startsAt: hkTimeRequired.optional(),
  minutes: z.number().int().min(5).max(1440).optional(),
  address: optText,
  purpose: optText,
  meetingNotes: optText,
  contactId: uuid.nullable().optional(),
});

const CarrierBody = z.object({ provider: optText, contractEnd: optText, price: optText, plan: optText });

const CallBody = z.object({
  companyId: uuid,
  outcome: z.enum(OUTCOMES),
  callbackAt: hkTime,
  content: optText,
  reachedR: z.boolean().optional(),
  gotD: z.boolean().optional(),
  carriers: z.array(CarrierBody).max(20).nullable().optional(),
  dContractEnd: optText,
  dPrice: optText,
  dPlan: optText,
  dProvider: optText,
  otherFollower: optText,
  attemptNo: z.number().int().min(1).nullable().optional(),
  phoneDialed: optText,
  contactId: uuid.nullable().optional(),
});

const CallPatch = z.object({
  content: optText,
  reachedR: z.boolean().optional(),
  gotD: z.boolean().optional(),
  carriers: z.array(CarrierBody).max(20).nullable().optional(),
  attemptNo: z.number().int().min(1).optional(),
});

const CompanyBody = z.object({
  name_zh: optText, name_en: optText,
  customer_type: z.enum(["公司", "個人"]).optional(),
  industry: optText, address_zh: optText, address_en: optText, br_no: optText, website: optText,
  status: z.enum(COMPANY_STATUSES).optional(),
  followed_by: optText, mis_checked: z.boolean().optional(), notes: optText,
  /** 一格文字（「2345 6789 / 傳真 2345 6790」），server 拆 */
  phonesText: z.string().max(2000).optional(),
  emailsText: z.string().max(2000).optional(),
  productIds: z.array(uuid).optional(),
  force: z.boolean().optional(),
});

const ContactBody = z.object({
  name: z.string().max(200).optional(), title: optText, phone: optText, email: optText,
  is_decision_maker: z.boolean().optional(), notes: optText,
});

const ProductBody = z.object({
  name: z.string().max(200).optional(), category: optText, active: z.boolean().optional(),
  sort: z.number().int().optional(),
  default_monthly_fee: z.union([z.number(), z.string()]).nullable().optional(),
  default_cost: z.union([z.number(), z.string()]).nullable().optional(),
  default_term_months: z.union([z.number(), z.string()]).nullable().optional(),
  notes: optText,
});

/** 一格電話／電郵文字 → 清單；認唔到嘅唔靜靜雞丟，直接拒絕講返邊個。 */
function companyInput(b: z.infer<typeof CompanyBody>): CompanyInput {
  const { phonesText, emailsText, force: _f, ...rest } = b;
  const out: CompanyInput = {};
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  if (phonesText !== undefined) {
    const p = phonesFromText(phonesText);
    if (p.bad.length) throw new ApiError(400, `電話認唔到：${p.bad.map((x) => `「${x.raw}」${x.reason}`).join("；")}`);
    out.phones = p.ok;
  }
  if (emailsText !== undefined) {
    const e = emailsFromText(emailsText);
    if (e.bad.length) throw new ApiError(400, `電郵唔似電郵：${e.bad.join("、")}`);
    out.emails = e.ok;
  }
  return out;
}

export function filtersFrom(q: URLSearchParams): CompanyFilters {
  const f: CompanyFilters = {};
  const s = (k: string) => (q.get(k) ?? "").trim();
  const yn = (k: string) => (s(k) === "yes" || s(k) === "no" ? (s(k) as "yes" | "no") : undefined);
  if (s("q")) f.q = s("q");
  const st = q.getAll("status").flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);
  if (st.length) f.status = st;
  if (s("industry")) f.industry = s("industry");
  for (const k of ["r", "d", "mis", "called"] as const) { const v = yn(k); if (v) f[k] = v; }
  if (s("lastOutcome")) f.lastOutcome = s("lastOutcome");
  if (s("productId")) f.productId = parse(uuid, s("productId"));
  if (s("cold") === "1") f.cold = true;
  if (s("id")) f.id = parse(uuid, s("id"));
  if (s("contractEndBy")) { assertDay(s("contractEndBy")); f.contractEndBy = s("contractEndBy"); }
  const sort = s("sort");
  if (["recent", "name", "code", "created", "contract_end", "never_called"].includes(sort)) {
    f.sort = sort as NonNullable<CompanyFilters["sort"]>;
  }
  return f;
}

/** 匯入 preview：行數可以幾千，畫面淨係要「唔入嗰啲」同「有警告嗰啲」。 */
function planSummary(plan: ImportPlan) {
  const interesting = plan.rows.filter((r) => r.action === "skip" || r.warnings.length);
  return {
    sheet: plan.sheet ?? null,
    headers: plan.headers,
    mapping: plan.mapping,
    unmapped: plan.unmapped,
    counts: plan.counts,
    byStatus: plan.byStatus,
    unknownResults: plan.unknownResults,
    conflicts: plan.conflicts,
    sample: plan.rows.filter((r) => r.action === "new").slice(0, 5).map((r) => ({
      line: r.line, name_zh: r.company.name_zh ?? null, name_en: r.company.name_en ?? null,
      phones: r.phones.map((p) => `${p.phone}${p.label === "傳真" ? "（傳真）" : ""}`), emails: r.emails,
      industry: r.company.industry ?? null,
    })),
    issues: interesting.slice(0, 500).map((r) => ({
      line: r.line, action: r.action, reason: r.reason ?? null, warnings: r.warnings,
      name: r.company.name_zh || r.company.name_en || "",
    })),
    issuesTotal: interesting.length,
  };
}

// ── 路由 ──────────────────────────────────────────────────────────────────

export function createApi(deps: { sql: () => Sql; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());

  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname;
    if (!path.startsWith("/app/api/")) return false;
    const sql = deps.sql();
    const today = hkToday(now());
    const m = req.method ?? "GET";
    const seg = path.slice("/app/api/".length).split("/");
    const ok = (body: unknown) => sendJson(res, 200, body);

    // GET /today —— 首頁：今日數 ＋ 回撥 ＋ 近 14 日
    if (m === "GET" && path === "/app/api/today") {
      const [stats, history, due, upcoming, appointments, renewals] = await Promise.all([
        todayStats(sql, today), dailyStats(sql, addDays(today, -13), today),
        callbacksDue(sql, today), callbacksUpcoming(sql, today, 7),
        listAppointments(sql, today, today, { statuses: ["已約", "已見", "冇出現"] }), renewalsDue(sql, today),
      ]);
      ok({ today, stats, history, due, upcoming, appointments, renewals });
      return true;
    }

    if (m === "GET" && path === "/app/api/stats") {
      const to = url.searchParams.get("to") || today;
      const from = url.searchParams.get("from") || addDays(to, -29);
      // 本星期：星期一至今日（香港）
      const weekStart = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
      const [days, totals, week] = await Promise.all([
        dailyStats(sql, from, to), periodTotals(sql, from, to), periodTotals(sql, weekStart, today),
      ]);
      ok({ from, to, days, totals, week: { from: weekStart, to: today, ...week } });
      return true;
    }

    // GET /stats/detail?kind=calls&from=&to= —— 撳個數睇係邊幾間
    if (m === "GET" && path === "/app/api/stats/detail") {
      const kind = url.searchParams.get("kind") ?? "";
      if (!(DETAIL_KINDS as readonly string[]).includes(kind)) throw new ApiError(400, `kind 要係：${DETAIL_KINDS.join("／")}`);
      const from = url.searchParams.get("from") || today;
      const to = url.searchParams.get("to") || from;
      ok({ kind, from, to, rows: await statsDetail(sql, kind as DetailKind, from, to) });
      return true;
    }

    // GET /meta —— 撳掣規則、狀態、產品、行業（網頁開機攞一次）
    if (m === "GET" && path === "/app/api/meta") {
      const [products, industries] = await Promise.all([listProducts(sql), listIndustries(sql)]);
      ok({
        today, outcomes: OUTCOMES.map((o) => ({ outcome: o, ...RULES[o] })),
        statuses: COMPANY_STATUSES, products, industries,
      });
      return true;
    }

    if (m === "GET" && path === "/app/api/companies") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 500);
      const offset = Number(url.searchParams.get("offset") ?? 0) || 0;
      ok(await listCompanies(sql, filtersFrom(url.searchParams), limit, offset));
      return true;
    }

    if (m === "GET" && path === "/app/api/companies.xlsx") {
      const { buf, total } = await companiesXlsx(sql, filtersFrom(url.searchParams), now());
      const name = `GlobalCall-公司-${today}-${total}間.xlsx`;
      res.writeHead(200, {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="companies-${today}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "no-store",
      });
      res.end(buf);
      return true;
    }

    if (m === "POST" && path === "/app/api/companies") {
      const b = parse(CompanyBody, await readJson(req));
      const r = await createCompany(sql, companyInput(b), { force: b.force ?? false });
      ok(r);
      return true;
    }

    if (seg[0] === "companies" && seg[1] && seg.length === 2) {
      if (m === "GET") {
        const c = await getCompany(sql, seg[1]);
        if (!c) throw new ApiError(404, "搵唔到呢間公司");
        ok({ ...c, appointments: await companyAppointments(sql, c.company.id), nextAttempt: c.company.call_count + 1 });
        return true;
      }
      if (m === "POST") {
        const id = parse(uuid, seg[1]);
        await updateCompany(sql, id, companyInput(parse(CompanyBody, await readJson(req))));
        ok({ ok: true });
        return true;
      }
    }

    if (m === "POST" && seg[0] === "companies" && seg[2] === "delete" && seg.length === 3) {
      ok({ deleted: await deleteCompany(sql, parse(uuid, seg[1])) });
      return true;
    }

    if (m === "POST" && seg[0] === "companies" && seg[2] === "remarks" && seg.length === 3) {
      const b = parse(z.object({ body: z.string().max(5000) }), await readJson(req));
      ok({ remark: await addRemark(sql, parse(uuid, seg[1]), b.body) });
      return true;
    }

    if (m === "POST" && seg[0] === "remarks" && seg[1] && seg[2] === "delete") {
      await deleteRemark(sql, parse(uuid, seg[1]));
      ok({ ok: true });
      return true;
    }

    if (m === "POST" && seg[0] === "companies" && seg[2] === "contacts" && seg.length === 3) {
      const id = await addContact(sql, parse(uuid, seg[1]), parse(ContactBody, await readJson(req)));
      ok({ id });
      return true;
    }

    if (m === "POST" && seg[0] === "contacts" && seg[1]) {
      const id = parse(uuid, seg[1]);
      if (seg[2] === "delete") await deleteContact(sql, id);
      else await updateContact(sql, id, parse(ContactBody, await readJson(req)));
      ok({ ok: true });
      return true;
    }

    if (m === "POST" && path === "/app/api/calls") {
      const b = parse(CallBody, await readJson(req));
      ok(await logCall(sql, { ...b, calledAt: now() }));
      return true;
    }

    if (m === "POST" && seg[0] === "calls" && seg[1]) {
      const id = parse(uuid, seg[1]);
      if (seg[2] === "delete") ok(await deleteCall(sql, id));
      else {
        ok(await updateCall(sql, id, parse(CallPatch, await readJson(req))));
      }
      return true;
    }

    if (m === "POST" && seg[0] === "tasks" && seg[1] && seg[2]) {
      const id = parse(uuid, seg[1]);
      const b = parse(z.object({ note: optText, dueAt: hkTime }), await readJson(req));
      if (seg[2] === "done") await completeTask(sql, id, b.note ?? null);
      else if (seg[2] === "cancel") await cancelTask(sql, id, b.note ?? null);
      else if (seg[2] === "reschedule") await rescheduleTask(sql, id, b.dueAt ?? null);
      else throw new ApiError(404, "冇呢個動作");
      ok({ ok: true });
      return true;
    }

    // ── 預約 ──
    if (m === "GET" && path === "/app/api/appointments") {
      const from = url.searchParams.get("from") || today;
      const to = url.searchParams.get("to") || addDays(from, 30);
      const statuses = (url.searchParams.get("status") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      ok({ today, from, to, rows: await listAppointments(sql, from, to, { statuses }) });
      return true;
    }
    if (m === "POST" && path === "/app/api/appointments") {
      const b = parse(ApptBody, await readJson(req));
      const r = await createAppointment(sql, {
        companyId: b.companyId, startsAt: b.startsAt, minutes: b.minutes ?? null,
        contactId: b.contactId ?? null,
        newContact: b.newContact?.name?.trim()
          ? { name: b.newContact.name, title: b.newContact.title ?? null, phone: b.newContact.phone ?? null } : null,
        ...("address" in b ? { address: b.address ?? null } : {}), purpose: b.purpose ?? null, createdAt: now(),
      });
      ok(r);
      return true;
    }
    if (m === "POST" && seg[0] === "appointments" && seg[1]) {
      const id = parse(uuid, seg[1]);
      const act = seg[2];
      if (act === "done") {
        const b = parse(z.object({ meetingNotes: optText, nextStepNote: optText, nextStepAt: hkTime }), await readJson(req));
        ok(await completeAppointment(sql, id, { meetingNotes: b.meetingNotes ?? null, nextStepNote: b.nextStepNote ?? null, nextStepAt: b.nextStepAt ?? null }));
      } else if (act === "cancel" || act === "noshow") {
        const b = parse(z.object({ reason: optText }), await readJson(req));
        ok({ appointment: await (act === "cancel" ? cancelAppointment : noShowAppointment)(sql, id, b.reason ?? null) });
      } else if (act === undefined) {
        const b = parse(ApptPatch, await readJson(req));
        let clashes: AppointmentRow[] = [];
        if (b.startsAt) {
          const end = b.minutes ? new Date(b.startsAt.getTime() + b.minutes * 60_000) : null;
          clashes = (await rescheduleAppointment(sql, id, b.startsAt, end)).clashes;
        }
        const { startsAt: _s, minutes: _m, ...rest } = b;
        const appointment = await updateAppointment(sql, id, rest);
        ok({ appointment, clashes });
      } else throw new ApiError(404, "冇呢個動作");
      return true;
    }

    // ── 續約提醒 ──
    if (m === "GET" && path === "/app/api/renewals") {
      ok({ today, rows: await renewalsDue(sql, today) });
      return true;
    }
    if (m === "POST" && path === "/app/api/renewals/dismiss") {
      const b = parse(z.object({ companyId: uuid, contractEnd: z.string(), stage: z.union([z.literal(1), z.literal(2)]) }), await readJson(req));
      await dismissRenewal(sql, b.companyId, b.contractEnd, b.stage);
      ok({ ok: true });
      return true;
    }

    if (m === "GET" && path === "/app/api/products") {
      ok(await listProducts(sql, { includeInactive: url.searchParams.get("all") === "1" }));
      return true;
    }
    if (m === "POST" && path === "/app/api/products") {
      ok({ id: await createProduct(sql, parse(ProductBody, await readJson(req))) });
      return true;
    }
    if (m === "POST" && seg[0] === "products" && seg[1]) {
      await updateProduct(sql, parse(uuid, seg[1]), parse(ProductBody, await readJson(req)));
      ok({ ok: true });
      return true;
    }

    // 匯入：preview 同 commit 都上載同一個檔 —— commit 嗰陣對返**當刻**嘅 CRM 再計一次，
    // 唔會用到 preview 之後先入嘅公司（Equal 教訓：snapshot 同寫入之間資料會變）。
    if (m === "POST" && (path === "/app/api/import/preview" || path === "/app/api/import/commit")) {
      const filename = (url.searchParams.get("filename") ?? "upload.csv").slice(0, 200);
      const buf = await readBuf(req, MAX_UPLOAD);
      if (!buf.length) throw new ApiError(400, "個檔係空嘅");
      const table = await readTable(buf, filename);
      const plan = planImport(table, await loadExisting(sql), { allowPhoneClash: url.searchParams.get("allowPhoneClash") === "1" });
      if (path.endsWith("/preview")) ok(planSummary(plan));
      else ok({ ...(await commitImport(sql, plan, filename, "web", today)), counts: plan.counts });
      return true;
    }

    throw new ApiError(404, "冇呢個 API");
  }

  return { handle };
}
