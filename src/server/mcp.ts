/**
 * MCP tools —— claude.ai connector：「啱啱打咗畀 XX，搵到負責人，CSL 合約 3 月到期，
 * 下星期二 3 點再打」一句入齊。
 *
 * 規矩（Equal 學返嚟）：
 *   · 公司認唔實就唔寫：名搜出多過一間 → 回候選，叫 Claude 問返 Kevin。唔估。
 *   · 寫完讀返 DB 回應（readback）—— Claude 要見到真係落咗地先好講「記低咗」。
 *   · 日子一律香港時間，回應連星期一齊出（「10/20（二）15:00」），一眼捉到錯日。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import {
  cancelAppointment, completeAppointment, createAppointment, getAppointment, listAppointments,
  noShowAppointment, rescheduleAppointment, updateAppointment, type AppointmentRow,
} from "../domain/appointments.js";
import { logCall } from "../domain/calls.js";
import {
  createCompany, emailsFromText, getCompany, listCompanies, phonesFromText, updateCompany,
  type CompanyInput, type CompanyListRow,
} from "../domain/companies.js";
import { COMPANY_STATUSES, OUTCOMES, RULES } from "../domain/outcomes.js";
import { listProducts } from "../domain/products.js";
import { dismissRenewal, renewalsDue } from "../domain/renewals.js";
import { dailyStats, periodTotals, todayStats } from "../domain/stats.js";
import { callbacksDue, callbacksUpcoming, cancelTask, completeTask, rescheduleTask } from "../domain/tasks.js";
import { formatPhone } from "../lib/phone.js";
import { nospace } from "../lib/text.js";
import { addDays, fmtHk, hkToday, parseHkDateTime } from "../lib/time.js";

const INSTRUCTIONS = [
  "Kevin（Global Call 電訊 B2B 銷售）嘅冷電 CRM。用廣東話覆。",
  "記電話：log_call。結果一定係以下八個之一：" + OUTCOMES.join("、") + "。",
  "「幾點鐘再打」一定要有 callbackAt；「其他人跟進」一定要有 otherFollower（邊個同事）；「不需要」同「其他人跟進」唔可以有 callbackAt。",
  "R ＝ 搵到負責人（reachedR）。D ＝ 攞到詳盡資料：合約到期日、而家價錢、套餐內容、用緊邊個台（dContractEnd／dPrice／dPlan／dProvider，填咗任何一樣就自動算 D）。R、D 分開判斷：前台講咗合約到期日算 D 唔算 R。",
  "時間一律香港時間，寫「2026-10-20 15:00」。相對日子（聽日、下星期二）要由 today_stats 回嘅 today 計，覆 Kevin 嗰陣日期同星期一齊寫。",
  "公司要用 code（GC-00012）或者搜到唯一一間先寫；搜出幾間就列出嚟問 Kevin，唔好估。",
  "寫完睇返回應入面嘅 saved 先講「記低咗」；有錯就照講。",
  "打下一次電話會自動收返舊嘅回撥／跟進提醒，唔使另外收。",
  "約見面：book_appointment（公司、時間、聯絡人名、地址唔講就用公司地址）。見完：appointment_action done 連見面備註，有下一步就畀 nextStepNote／nextStepAt（會開跟進提醒）。",
  "續約：renewals_due 列出對手台合約 90 日內到期（30 日內再提）嘅公司 —— 打一次電話就自動收。",
].join("\n");

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
function fail(e: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] };
}

function brief(r: CompanyListRow) {
  return {
    id: r.id, code: r.code, name_zh: r.name_zh, name_en: r.name_en, industry: r.industry, status: r.status,
    phones: r.phones, emails: r.emails || null, calls: r.call_count,
    last_call: r.last_call_at ? fmtHk(r.last_call_at) : null, last_outcome: r.last_outcome,
    R: r.ever_r, D: r.ever_d, contract_end: r.d_contract_end, provider: r.d_provider,
    followed_by: r.followed_by, open_tasks: r.open_tasks,
  };
}

/** code／id 直接用；名就搜，唯一一間先用，否則回候選。 */
async function resolveCompany(sql: Sql, ref: string): Promise<{ id: string } | { candidates: unknown[] }> {
  const t = ref.trim();
  if (/^[0-9a-f-]{36}$/i.test(t) || /^GC-\d+$/i.test(t)) {
    const c = await getCompany(sql, t);
    if (!c) throw new Error(`搵唔到 ${t}`);
    return { id: c.company.id };
  }
  const r = await listCompanies(sql, { q: t }, 6, 0);
  if (r.total === 1) return { id: r.rows[0]!.id };
  if (r.total === 0) throw new Error(`搵唔到「${t}」—— 試吓用電話或者英文名搜，或者 create_company 開新`);
  return { candidates: r.rows.map(brief) };
}

async function productIdsByName(sql: Sql, names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const all = await listProducts(sql, { includeInactive: true });
  const norm = (s: string) => s.toLowerCase().replace(/[\s　]+/g, "");
  return names.map((n) => {
    const hit = all.filter((p) => norm(p.name).includes(norm(n)));
    if (hit.length === 1) return hit[0]!.id;
    if (!hit.length) throw new Error(`冇呢個產品：「${n}」。有：${all.map((p) => p.name).join("、")}`);
    throw new Error(`「${n}」夾中幾個產品：${hit.map((p) => p.name).join("、")} —— 講清楚啲`);
  });
}

const optStr = z.string().optional();

function apptBrief(a: AppointmentRow) {
  return {
    appointment_id: a.id, when: fmtHk(a.starts_at), until: a.ends_at ? fmtHk(a.ends_at).slice(-5) : null,
    company: `${a.company_code} ${a.company_name}`, contact: [a.contact_name, a.contact_title].filter(Boolean).join(" ") || null,
    contact_phone: a.contact_phone, company_phones: a.company_phones, address: a.address, purpose: a.purpose,
    status: a.status, meeting_notes: a.meeting_notes, rescheduled: a.rescheduled,
  };
}

export function buildMcpServer(getSql: () => Sql, now: () => Date = () => new Date()): McpServer {
  const server = new McpServer({ name: "global-call-crm", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  const run = (fn: (sql: Sql) => Promise<unknown>) => async () => {
    try { return ok(await fn(getSql())); } catch (e) { return fail(e); }
  };

  server.registerTool("today_stats", {
    title: "今日數",
    description: "今日（或指定日子）打咗幾多通、接通幾多、R 幾多間、D 幾多間；另外回今日日期同星期。",
    inputSchema: { date: z.string().optional().describe("YYYY-MM-DD，香港日子；唔畀就今日") },
  }, async (a) => run(async (sql) => {
    const today = hkToday(now());
    const day = a.date || today;
    const [stats, week, appts] = await Promise.all([
      todayStats(sql, day), periodTotals(sql, addDays(day, -6), day), listAppointments(sql, day, day),
    ]);
    return {
      today, today_label: fmtHk(`${today}T12:00:00+08:00`, false), stats, last7days: week,
      appointments: appts.map(apptBrief),
    };
  })());

  server.registerTool("stats_range", {
    title: "一段時間嘅數",
    description: "由 from 到 to 每日通數、接通、R、D，同埋總數。",
    inputSchema: { from: z.string(), to: z.string() },
  }, async (a) => run(async (sql) => ({
    days: await dailyStats(sql, a.from, a.to), totals: await periodTotals(sql, a.from, a.to),
  }))());

  server.registerTool("callbacks_today", {
    title: "今日要回撥",
    description: "過咗期＋今日到期＋冇指定時間嘅回撥／跟進／寄電郵（電話唔包傳真）；另外列之後 7 日。",
    inputSchema: { date: z.string().optional() },
  }, async (a) => run(async (sql) => {
    const day = a.date || hkToday(now());
    const fmt = (t: Awaited<ReturnType<typeof callbacksDue>>[number]) => ({
      task_id: t.id, company: `${t.company_code} ${t.company_name}`, phones: t.phones.split(" / ").map(formatPhone).join(" / "),
      kind: t.kind, due: t.due_at ? fmtHk(t.due_at) : "（冇指定時間）", overdue: t.overdue, note: t.note,
    });
    return { day, due: (await callbacksDue(sql, day)).map(fmt), next7days: (await callbacksUpcoming(sql, day, 7)).map(fmt) };
  })());

  server.registerTool("search_company", {
    title: "搵公司",
    description: "用名（中英文都得，無視空格）、電話、電郵、編號搵公司。cold=true 淨係出冷電名單（未打／跟進中、冇同事跟開）。",
    inputSchema: {
      q: z.string().optional(), cold: z.boolean().optional(),
      status: z.array(z.enum(COMPANY_STATUSES)).optional(),
      industry: z.string().optional(), limit: z.number().int().min(1).max(50).optional(),
    },
  }, async (a) => run(async (sql) => {
    const f: Parameters<typeof listCompanies>[1] = {};
    if (a.q) f.q = a.q;
    if (a.cold) f.cold = true;
    if (a.status?.length) f.status = a.status;
    if (a.industry) f.industry = a.industry;
    const r = await listCompanies(sql, f, a.limit ?? 10, 0);
    return { total: r.total, R: r.totalR, D: r.totalD, rows: r.rows.map(brief) };
  })());

  server.registerTool("get_company", {
    title: "公司詳情",
    description: "一間公司：電話、電郵、聯絡人、興趣產品、最近電話記錄、未完成待辦。下次撥打係第幾次（nextAttempt）。",
    inputSchema: { company: z.string().describe("GC-00012、id 或者名") },
  }, async (a) => run(async (sql) => {
    const r = await resolveCompany(sql, a.company);
    if ("candidates" in r) return { needChoice: true, candidates: r.candidates };
    const c = (await getCompany(sql, r.id))!;
    return {
      company: brief(c.company), address_zh: c.company.address_zh, address_en: c.company.address_en,
      notes: c.company.notes, contacts: c.contacts, products: c.products,
      calls: c.calls.slice(0, 15).map((k) => ({
        when: fmtHk(k.called_at), attempt: k.attempt_no, outcome: k.outcome, R: k.reached_r, D: k.got_d,
        content: k.content, contract_end: k.d_contract_end, price: k.d_price, plan: k.d_plan, provider: k.d_provider,
        callback: k.callback_at ? fmtHk(k.callback_at) : null,
      })),
      tasks: c.tasks.map((t) => ({ ...t, due: t.due_at ? fmtHk(t.due_at) : null })),
      nextAttempt: c.company.call_count + 1,
    };
  })());

  server.registerTool("log_call", {
    title: "記低一次電話",
    description: "打完一次電話記低：結果（八揀一）、內容、R／D、D 資料、回撥時間。會自動收舊回撥、按規則開新回撥、改公司狀態。",
    inputSchema: {
      company: z.string().describe("GC-00012、id 或者名（名要搜到唯一一間）"),
      outcome: z.enum(OUTCOMES),
      callbackAt: optStr.describe("香港時間「2026-10-20 15:00」"),
      content: optStr,
      reachedR: z.boolean().optional().describe("搵到負責人"),
      gotD: z.boolean().optional(),
      dContractEnd: optStr.describe("合約到期日 YYYY-MM-DD"),
      dPrice: optStr.describe("而家價錢（照講法寫，例如「$298/月 × 5 條」）"),
      dPlan: optStr.describe("而家套餐內容"),
      dProvider: optStr.describe("用緊邊個台（CSL／CMHK／3HK／SmarTone…）"),
      otherFollower: optStr.describe("「其他人跟進」：邊個同事"),
      attemptNo: z.number().int().min(1).optional().describe("第幾次致電；唔畀就自動 ＝ 打過幾多次 +1"),
      calledAt: optStr.describe("唔係啱啱打嘅先畀，香港時間"),
      interestedProducts: z.array(z.string()).optional().describe("佢有興趣嘅產品名（加入，唔會剷舊嘅）"),
    },
  }, async (a) => run(async (sql) => {
    const r = await resolveCompany(sql, a.company);
    if ("candidates" in r) return { saved: false, needChoice: true, message: "搵到幾間，問返 Kevin 係邊間", candidates: r.candidates };
    const res = await logCall(sql, {
      companyId: r.id, outcome: a.outcome,
      callbackAt: a.callbackAt ? parseHkDateTime(a.callbackAt) : null,
      calledAt: a.calledAt ? parseHkDateTime(a.calledAt) : now(),
      content: a.content ?? null, reachedR: a.reachedR ?? false, gotD: a.gotD ?? false,
      dContractEnd: a.dContractEnd ?? null, dPrice: a.dPrice ?? null, dPlan: a.dPlan ?? null,
      dProvider: a.dProvider ?? null, otherFollower: a.otherFollower ?? null, attemptNo: a.attemptNo ?? null,
    }, "claude");
    let products: string[] | undefined;
    if (a.interestedProducts?.length) {
      const add = await productIdsByName(sql, a.interestedProducts);
      const cur = await getCompany(sql, r.id);
      const ids = [...new Set([...(cur!.company.product_ids ?? []), ...add])];
      await updateCompany(sql, r.id, { productIds: ids }, "claude");
    }
    // readback：由 DB 讀返，唔係照抄自己寫咗乜
    const back = (await getCompany(sql, r.id))!;
    const saved = back.calls.some((k) => k.id === res.call.id);
    products = back.products.map((p) => p.name);
    return {
      saved,
      company: `${back.company.code} ${back.company.name_zh || back.company.name_en}`,
      call: {
        when: fmtHk(res.call.called_at), attempt: res.call.attempt_no, outcome: res.call.outcome,
        connected: res.connected, R: res.call.reached_r, D: res.call.got_d,
        contract_end: res.call.d_contract_end, provider: res.call.d_provider,
      },
      status: res.statusBefore === res.statusAfter ? res.statusAfter : `${res.statusBefore} → ${res.statusAfter}`,
      closedOldTasks: res.closedTasks,
      newTask: res.task ? { kind: res.task.kind, due: res.task.due_at ? fmtHk(res.task.due_at) : "（冇指定時間，今日回撥清單會出）" } : null,
      interestedProducts: products,
      rule: RULES[a.outcome],
    };
  })());

  server.registerTool("create_company", {
    title: "開新公司",
    description: "開新公司。會先查重（電話、中文名、英文名）；撞到就唔開、回撞咗邊間 —— 問返 Kevin，確定係另一間先 force=true。",
    inputSchema: {
      name_zh: optStr, name_en: optStr, phones: optStr.describe("「2345 6789 / 傳真 2345 6790」"),
      emails: optStr, industry: optStr, address_zh: optStr, address_en: optStr, website: optStr,
      br_no: optStr, notes: optStr, customer_type: z.enum(["公司", "個人"]).optional(), force: z.boolean().optional(),
    },
  }, async (a) => run(async (sql) => {
    const { phones, emails, force, ...rest } = a;
    const input: CompanyInput = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) (input as Record<string, unknown>)[k] = v;
    if (phones) {
      const p = phonesFromText(phones);
      if (p.bad.length) throw new Error(`電話認唔到：${p.bad.map((x) => `「${x.raw}」${x.reason}`).join("；")}`);
      input.phones = p.ok;
    }
    if (emails) {
      const e = emailsFromText(emails);
      if (e.bad.length) throw new Error(`電郵唔似電郵：${e.bad.join("、")}`);
      input.emails = e.ok;
    }
    input.source = "Claude 對話";
    const r = await createCompany(sql, input, { force: force ?? false, actor: "claude" });
    if (!r.created) return { saved: false, duplicates: r.duplicates, message: "撞咗現有公司，未開。問返 Kevin。" };
    const back = await getCompany(sql, r.created.id);
    return { saved: Boolean(back), company: back ? brief(back.company) : null };
  })());

  server.registerTool("update_company", {
    title: "改公司資料",
    description: "改公司資料、狀態、MIS 已查、興趣產品（addProducts／removeProducts 用產品名）。電話／電郵畀咗就成格換。",
    inputSchema: {
      company: z.string(),
      name_zh: optStr, name_en: optStr, industry: optStr, address_zh: optStr, address_en: optStr,
      website: optStr, br_no: optStr, notes: optStr, followed_by: optStr,
      status: z.enum(COMPANY_STATUSES).optional(), mis_checked: z.boolean().optional(),
      phones: optStr, emails: optStr,
      addProducts: z.array(z.string()).optional(), removeProducts: z.array(z.string()).optional(),
    },
  }, async (a) => run(async (sql) => {
    const r = await resolveCompany(sql, a.company);
    if ("candidates" in r) return { saved: false, needChoice: true, candidates: r.candidates };
    const { company: _c, phones, emails, addProducts, removeProducts, ...rest } = a;
    const patch: CompanyInput = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
    if (phones !== undefined) {
      const p = phonesFromText(phones);
      if (p.bad.length) throw new Error(`電話認唔到：${p.bad.map((x) => `「${x.raw}」${x.reason}`).join("；")}`);
      patch.phones = p.ok;
    }
    if (emails !== undefined) {
      const e = emailsFromText(emails);
      if (e.bad.length) throw new Error(`電郵唔似電郵：${e.bad.join("、")}`);
      patch.emails = e.ok;
    }
    if (addProducts?.length || removeProducts?.length) {
      const cur = (await getCompany(sql, r.id))!;
      const add = await productIdsByName(sql, addProducts ?? []);
      const rm = new Set(await productIdsByName(sql, removeProducts ?? []));
      patch.productIds = [...new Set([...(cur.company.product_ids ?? []), ...add])].filter((id) => !rm.has(id));
    }
    await updateCompany(sql, r.id, patch, "claude");
    const back = (await getCompany(sql, r.id))!;
    return { saved: true, company: brief(back.company), products: back.products.map((p) => p.name) };
  })());

  server.registerTool("task_action", {
    title: "收／改回撥",
    description: "回撥／跟進待辦：done（做完）、cancel（取消）、reschedule（改時間，dueAt 空 ＝ 冇指定時間）。task_id 由 callbacks_today 或 get_company 攞。",
    inputSchema: {
      task_id: z.string(), action: z.enum(["done", "cancel", "reschedule"]),
      dueAt: optStr.describe("香港時間「2026-10-20 15:00」"), note: optStr,
    },
  }, async (a) => run(async (sql) => {
    if (a.action === "done") await completeTask(sql, a.task_id, a.note ?? null, "claude");
    else if (a.action === "cancel") await cancelTask(sql, a.task_id, a.note ?? null, "claude");
    else await rescheduleTask(sql, a.task_id, a.dueAt ? parseHkDateTime(a.dueAt) : null, "claude");
    const [t] = await sql<{ status: string; due_at: Date | null }[]>`select status, due_at from public.tasks where id = ${a.task_id}`;
    return { saved: Boolean(t), status: t?.status, due: t?.due_at ? fmtHk(t.due_at) : null };
  })());

  server.registerTool("book_appointment", {
    title: "約見面",
    description: "約客見面。聯絡人講個名：呢間公司有同名（空格唔理）就用佢，冇就開新聯絡人。地址唔講就用公司地址。會講撞唔撞時段（前後 60 分鐘有冇其他約）。",
    inputSchema: {
      company: z.string().describe("GC-00012、id 或者名"),
      startsAt: z.string().describe("香港時間「2026-10-20 15:00」"),
      minutes: z.number().int().min(5).max(1440).optional().describe("見幾耐，預設 60"),
      contact: optStr.describe("聯絡人名"), contactTitle: optStr, contactPhone: optStr,
      address: optStr.describe("唔講就用公司地址"), purpose: optStr,
    },
  }, async (a) => run(async (sql) => {
    const r = await resolveCompany(sql, a.company);
    if ("candidates" in r) return { saved: false, needChoice: true, message: "搵到幾間，問返 Kevin 係邊間", candidates: r.candidates };
    let contactId: string | null = null;
    let newContact: { name: string; title: string | null; phone: string | null } | null = null;
    if (a.contact?.trim()) {
      const [hit] = await sql<{ id: string }[]>`
        select id from public.contacts where company_id = ${r.id} and public.nospace(name) = ${nospace(a.contact)} limit 1`;
      if (hit) contactId = hit.id;
      else newContact = { name: a.contact.trim(), title: a.contactTitle ?? null, phone: a.contactPhone ?? null };
    }
    const res = await createAppointment(sql, {
      companyId: r.id, startsAt: parseHkDateTime(a.startsAt), minutes: a.minutes ?? null, contactId, newContact,
      ...(a.address !== undefined ? { address: a.address } : {}), purpose: a.purpose ?? null, createdAt: now(),
    }, "claude");
    const back = await getAppointment(sql, res.appointment.id);
    return {
      saved: back !== null, appointment: back ? apptBrief(back) : null,
      newContact: res.newContactId !== null,
      clashes: res.clashes.map(apptBrief),
    };
  })());

  server.registerTool("appointments", {
    title: "已約客戶時間表",
    description: "一段日子嘅約（預設今日起 14 日）：時間、公司、聯絡人、地址、狀態、見面備註。",
    inputSchema: { from: optStr.describe("YYYY-MM-DD"), to: optStr, status: z.array(z.enum(["已約", "已見", "取消", "冇出現"])).optional() },
  }, async (a) => run(async (sql) => {
    const from = a.from || hkToday(now());
    const to = a.to || addDays(from, 13);
    const rows = await listAppointments(sql, from, to, { statuses: a.status ?? [] });
    return { from, to, count: rows.length, rows: rows.map(apptBrief) };
  })());

  server.registerTool("appointment_action", {
    title: "見完／改期／取消／冇出現",
    description: "done：見咗，寫 meetingNotes；有下一步畀 nextStepNote／nextStepAt（開跟進提醒）。reschedule：startsAt 新時間。cancel／noshow：reason。notes：淨係補見面備註。",
    inputSchema: {
      appointment_id: z.string(), action: z.enum(["done", "reschedule", "cancel", "noshow", "notes"]),
      meetingNotes: optStr, nextStepNote: optStr, nextStepAt: optStr.describe("香港時間「2026-10-20 15:00」"),
      startsAt: optStr, reason: optStr,
    },
  }, async (a) => run(async (sql) => {
    let taskId: string | null = null;
    let clashes: AppointmentRow[] = [];
    if (a.action === "done") {
      taskId = (await completeAppointment(sql, a.appointment_id, {
        meetingNotes: a.meetingNotes ?? null, nextStepNote: a.nextStepNote ?? null,
        nextStepAt: a.nextStepAt ? parseHkDateTime(a.nextStepAt) : null,
      }, "claude")).taskId;
    } else if (a.action === "reschedule") {
      if (!a.startsAt) throw new Error("改期要畀 startsAt");
      clashes = (await rescheduleAppointment(sql, a.appointment_id, parseHkDateTime(a.startsAt), null, "claude")).clashes;
    } else if (a.action === "cancel") await cancelAppointment(sql, a.appointment_id, a.reason ?? null, "claude");
    else if (a.action === "noshow") await noShowAppointment(sql, a.appointment_id, a.reason ?? null, "claude");
    else await updateAppointment(sql, a.appointment_id, { meetingNotes: a.meetingNotes ?? null }, "claude");
    const back = await getAppointment(sql, a.appointment_id);
    return { saved: back !== null, appointment: back ? apptBrief(back) : null, followUpTaskId: taskId, clashes: clashes.map(apptBrief) };
  })());

  server.registerTool("renewals_due", {
    title: "續約提醒",
    description: "對手台合約快到期（90 日內，30 日內再提）而且個窗開咗之後未打過嘅公司。dismiss 畀 company_id＋contract_end＋stage 就收埋（新到期日會再出）。",
    inputSchema: {
      date: optStr, dismiss: z.object({ company_id: z.string(), contract_end: z.string(), stage: z.union([z.literal(1), z.literal(2)]) }).optional(),
    },
  }, async (a) => run(async (sql) => {
    if (a.dismiss) await dismissRenewal(sql, a.dismiss.company_id, a.dismiss.contract_end, a.dismiss.stage, "claude");
    const day = a.date || hkToday(now());
    const rows = await renewalsDue(sql, day);
    return {
      day, count: rows.length,
      rows: rows.map((x) => ({
        company_id: x.company_id, company: `${x.company_code} ${x.company_name}`, phones: x.phones,
        contract_end: x.contract_end, days_left: x.days_left, stage: x.stage, provider: x.provider,
        price: x.price, plan: x.plan, status: x.status, last_call: x.last_call_at ? fmtHk(x.last_call_at) : null,
      })),
    };
  })());

  return server;
}
