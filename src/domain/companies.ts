/**
 * 公司：清單（篩選／搜尋）、詳情、開新、改。
 *
 * 清單讀 `company_overview` view（打過幾多次、最後結果、R／D 都喺度計好）。
 * 篩選結果頂會出「共 N 間 · 當中 R x 間 · D y 間」—— Kevin 要嘅「有幾多個 R 幾多個 D」。
 */

import { listRemarks } from "./remarks.js";
import { toJson, type Sql } from "../db/client.js";
import { COMPANY_STATUSES, type CompanyStatus } from "./outcomes.js";
import { blankToNull, escapeLike, nameKey, nospace } from "../lib/text.js";
import { parsePhoneCell, type PhoneLabel } from "../lib/phone.js";
import { assertDay } from "../lib/time.js";
import type { CallRow } from "./calls.js";

export interface CompanyFilters {
  q?: string;
  status?: string[];
  industry?: string;
  r?: "yes" | "no";
  d?: "yes" | "no";
  lastOutcome?: string;
  productId?: string;
  mis?: "yes" | "no";
  called?: "yes" | "no";
  /** 冷電名單：未打／跟進中、冇同事跟開 */
  cold?: boolean;
  /** 合約喺呢日或之前到期（D 資料） */
  contractEndBy?: string;
  sort?: "recent" | "name" | "code" | "created" | "contract_end" | "never_called";
  /** 淨係攞一間（清單記完電話／改完狀態，重畫嗰一行用） */
  id?: string;
}

export interface CompanyListRow {
  id: string;
  code: string;
  name_zh: string | null;
  name_en: string | null;
  industry: string | null;
  status: CompanyStatus;
  followed_by: string | null;
  mis_checked: boolean;
  phones: string;
  emails: string;
  address_zh: string | null;
  address_en: string | null;
  call_count: number;
  last_call_at: Date | null;
  last_outcome: string | null;
  ever_r: boolean;
  ever_d: boolean;
  d_contract_end: string | null;
  d_provider: string | null;
  d_price: string | null;
  d_plan: string | null;
  open_tasks: number;
  product_ids: string[];
  notes: string | null;
  source: string | null;
  customer_type: string;
  br_no: string | null;
  website: string | null;
  /** 清單「備註欄」：最新一條（備註或者有內容嘅電話；名單匯入嘅排最後，冇日期） */
  last_note?: LastNote | null;
  /** 清單「備註欄」顯示晒（Kevin 2026-10-16「顯示所有備註」）：備註＋每次電話，新嘅行先，名單匯入最尾 */
  history?: LastNote[];
  /** 清單「R 負責人」格（Kevin 2026-10-16「要有位置輸入R資料」）：負責人行先，之後先到其他聯絡人 */
  contacts?: ListContact[];
}

export interface ListContact {
  id: string;
  name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  is_decision_maker: boolean;
}

export interface LastNote {
  kind: "remark" | "call" | "import";
  text: string;
  at: Date | null;
  author: string | null;
  outcome: string | null;
  attempt_no?: number | null | undefined;
}

function where(sql: Sql, f: CompanyFilters) {
  const parts = [sql`true`];
  const q = (f.q ?? "").trim();
  if (q) {
    const key = `%${escapeLike(nospace(q))}%`;
    const digits = q.replace(/\D/g, "");
    parts.push(sql`(
         public.nospace(o.name_zh) like ${key}
      or public.nospace(o.name_en) like ${key}
      or public.nospace(o.code)    like ${key}
      or public.nospace(o.emails)  like ${key}
      or exists (select 1 from public.contacts ct where ct.company_id = o.id
                    and (public.nospace(ct.name) like ${key} or public.nospace(ct.email) like ${key}
                         ${digits.length >= 4 ? sql`or regexp_replace(coalesce(ct.phone, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}` : sql``}))
      ${digits.length >= 4
        ? sql`or exists (select 1 from public.company_phones p
                          where p.company_id = o.id and p.phone like ${`%${digits}%`})`
        : sql``}
    )`);
  }
  const statuses = (f.status ?? []).filter((s) => (COMPANY_STATUSES as readonly string[]).includes(s));
  if (statuses.length) parts.push(sql`o.status in ${sql(statuses)}`);
  if (f.industry) parts.push(sql`o.industry = ${f.industry}`);
  if (f.r === "yes") parts.push(sql`o.ever_r`);
  if (f.r === "no") parts.push(sql`not o.ever_r`);
  if (f.d === "yes") parts.push(sql`o.ever_d`);
  if (f.d === "no") parts.push(sql`not o.ever_d`);
  if (f.lastOutcome) parts.push(sql`o.last_outcome = ${f.lastOutcome}`);
  if (f.productId) parts.push(sql`${f.productId}::uuid = any(o.product_ids)`);
  if (f.mis === "yes") parts.push(sql`o.mis_checked`);
  if (f.mis === "no") parts.push(sql`not o.mis_checked`);
  if (f.called === "yes") parts.push(sql`o.call_count > 0`);
  if (f.called === "no") parts.push(sql`o.call_count = 0`);
  if (f.id) parts.push(sql`o.id = ${f.id}`);
  if (f.cold) {
    parts.push(sql`o.status in ('未打', '跟進中') and nullif(btrim(o.followed_by), '') is null`);
  }
  if (f.contractEndBy) {
    assertDay(f.contractEndBy);
    parts.push(sql`o.d_contract_end is not null and o.d_contract_end <= ${f.contractEndBy}::date`);
  }
  return parts.reduce((acc, p) => sql`${acc} and ${p}`);
}

function orderBy(sql: Sql, s: CompanyFilters["sort"]) {
  switch (s) {
    case "name": return sql`coalesce(nullif(btrim(o.name_zh), ''), o.name_en), o.id`;
    case "code": return sql`o.code`;
    case "created": return sql`o.created_at desc, o.id`;
    case "contract_end": return sql`o.d_contract_end nulls last, o.id`;
    // 未打嘅行先：名單匯入嗰啲「跟進中」冇電話記錄（call_count 0），唔加呢句會同真未打撈埋
    case "never_called": return sql`(o.status <> '未打'), o.call_count, o.code`;
    case "recent":
    default: return sql`o.last_call_at desc nulls last, o.code`;
  }
}

export interface CompanyListResult {
  rows: CompanyListRow[];
  total: number;
  /** 篩選結果入面幾多間 R 過、D 過 */
  totalR: number;
  totalD: number;
}

export async function listCompanies(
  sql: Sql, f: CompanyFilters, limit = 50, offset = 0,
): Promise<CompanyListResult> {
  const lim = Math.min(Math.max(1, Math.trunc(limit)), 20_000);
  const off = Math.max(0, Math.trunc(offset));
  const w = where(sql, f);
  const [summary] = await sql<{ total: number; total_r: number; total_d: number }[]>`
    select count(*)::int as total,
           count(*) filter (where o.ever_r)::int as total_r,
           count(*) filter (where o.ever_d)::int as total_d
      from public.company_overview o where ${w}`;
  const rows = await sql<CompanyListRow[]>`
    select o.* from public.company_overview o
     where ${w}
     order by ${orderBy(sql, f.sort ?? (f.cold ? "never_called" : "recent"))}
     limit ${lim} offset ${off}`;
  await attachLastNotes(sql, rows);
  await attachAllNotes(sql, rows);
  await attachContacts(sql, rows);
  return { rows, total: summary!.total, totalR: summary!.total_r, totalD: summary!.total_d };
}

/**
 * 清單每行嘅「最新一條」：一句 query 攞晒呢頁幾十間（唔加落 view —— 11,800 間 count 已經 0.36 秒）。
 * 有日期嘅（手寫備註、有內容嘅電話）邊個新出邊個；都冇先用名單匯入嗰幾條（冇日期，合埋一句）。
 */
async function attachLastNotes(sql: Sql, rows: CompanyListRow[]): Promise<void> {
  if (!rows.length) return;
  const ids = rows.map((r) => r.id);
  const notes = await sql<(LastNote & { company_id: string })[]>`
    select distinct on (company_id) company_id, kind, text, at, author, outcome from (
      select r.company_id, 'remark' as kind, r.body as text, r.created_at as at, r.author, null::text as outcome, 2 as pri
        from public.company_remarks r where r.company_id = any(${ids}::uuid[]) and r.source <> 'import'
      union all
      select k.company_id, 'call', k.content, k.called_at, null, k.outcome, 2
        from public.calls k where k.company_id = any(${ids}::uuid[]) and nullif(btrim(k.content), '') is not null
      union all
      select r.company_id, 'import', string_agg(r.body, ' · ' order by (r.body ~ '^[^：]{1,12}：'), r.body), null, '名單匯入', null, 1
        from public.company_remarks r where r.company_id = any(${ids}::uuid[]) and r.source = 'import'
       group by r.company_id
    ) u
    order by company_id, pri desc, at desc nulls last`;
  const byId = new Map(notes.map((n) => [n.company_id, n]));
  for (const r of rows) {
    const n = byId.get(r.id);
    r.last_note = n ? { kind: n.kind, text: n.text, at: n.at, author: n.author, outcome: n.outcome } : null;
  }
}

/** 清單每行嘅聯絡人：負責人（R）行先，同級舊嘅行先 —— 一頁幾十間一句 query。 */
async function attachContacts(sql: Sql, rows: CompanyListRow[]): Promise<void> {
  if (!rows.length) return;
  const ids = rows.map((r) => r.id);
  const all = await sql<(ListContact & { company_id: string })[]>`
    select company_id, id, name, title, phone, email, is_decision_maker from public.contacts
     where company_id = any(${ids}::uuid[])
     order by company_id, is_decision_maker desc, created_at, id`;
  const by = new Map<string, ListContact[]>();
  for (const k of all) {
    const list = by.get(k.company_id) ?? [];
    list.push({ id: k.id, name: k.name, title: k.title, phone: k.phone, email: k.email, is_decision_maker: k.is_decision_maker });
    by.set(k.company_id, list);
  }
  for (const r of rows) r.contacts = by.get(r.id) ?? [];
}

/** 篩選選項：行業有邊幾個（由資料數出嚟，唔係寫死）。 */
export async function listIndustries(sql: Sql): Promise<{ industry: string; n: number }[]> {
  return sql<{ industry: string; n: number }[]>`
    select industry, count(*)::int as n from public.companies
     where nullif(btrim(industry), '') is not null
     group by industry order by n desc, industry`;
}

// ── 詳情 ──────────────────────────────────────────────────────────────────

export async function getCompany(sql: Sql, idOrCode: string) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrCode);
  const [company] = isUuid
    ? await sql<CompanyListRow[]>`select * from public.company_overview where id = ${idOrCode}`
    : await sql<CompanyListRow[]>`select * from public.company_overview where upper(code) = ${idOrCode.trim().toUpperCase()}`;
  if (!company) return null;
  const id = company.id;
  const [phones, emails, contacts, products, calls, tasks, remarks] = await Promise.all([
    sql<{ id: string; phone: string; label: PhoneLabel; raw: string | null; sort: number }[]>`
      select id, phone, label, raw, sort from public.company_phones where company_id = ${id} order by sort, created_at`,
    sql<{ id: string; email: string; sort: number }[]>`
      select id, email, sort from public.company_emails where company_id = ${id} order by sort, created_at`,
    sql<{ id: string; name: string; title: string | null; phone: string | null; email: string | null;
          is_decision_maker: boolean; notes: string | null }[]>`
      select id, name, title, phone, email, is_decision_maker, notes from public.contacts
       where company_id = ${id} order by is_decision_maker desc, created_at`,
    sql<{ id: string; name: string; category: string | null }[]>`
      select p.id, p.name, p.category from public.company_products cp
        join public.products p on p.id = cp.product_id
       where cp.company_id = ${id} order by p.sort, p.name`,
    sql<CallRow[]>`select * from public.calls where company_id = ${id} order by called_at desc limit 200`,
    sql<{ id: string; kind: string; due_at: Date | null; status: string; note: string | null;
          source_call_id: string | null; created_at: Date }[]>`
      select id, kind, due_at, status, note, source_call_id, created_at from public.tasks
       where company_id = ${id} and status = '待辦' order by (due_at is null), due_at`,
    listRemarks(sql, id),
  ]);
  return { company, phones, emails, contacts, products, calls, tasks, remarks };
}

// ── 開新／改 ──────────────────────────────────────────────────────────────

export interface PhoneInput { phone: string; label?: PhoneLabel; raw?: string | null }

/** 一格文字（「2345 6789 / 傳真 2345 6790」）→ 號碼清單。認唔到嘅講返原因。 */
export function phonesFromText(text: string): { ok: PhoneInput[]; bad: { raw: string; reason: string }[] } {
  const ok: PhoneInput[] = [];
  const bad: { raw: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const p of parsePhoneCell(text)) {
    if (!p.phone) { bad.push({ raw: p.raw, reason: p.reason ?? "認唔到" }); continue; }
    if (seen.has(p.phone)) continue;
    seen.add(p.phone);
    ok.push({ phone: p.phone, label: p.label, raw: p.raw });
  }
  return { ok, bad };
}

export function emailsFromText(text: string): { ok: string[]; bad: string[] } {
  const ok: string[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const raw of String(text ?? "").split(/[\s,;/|、，；]+/)) {
    let e = raw.trim().replace(/^mailto:/i, "");
    try { e = decodeURIComponent(e); } catch { /* 唔係 URL-encode 就照用 */ }
    e = e.trim().toLowerCase();
    if (!e) continue;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { bad.push(raw); continue; }
    if (seen.has(e)) continue;
    seen.add(e);
    ok.push(e);
  }
  return { ok, bad };
}

export interface CompanyInput {
  name_zh?: string | null;
  name_en?: string | null;
  customer_type?: string;
  industry?: string | null;
  address_zh?: string | null;
  address_en?: string | null;
  br_no?: string | null;
  website?: string | null;
  status?: string;
  followed_by?: string | null;
  mis_checked?: boolean;
  notes?: string | null;
  source?: string | null;
  phones?: PhoneInput[];
  emails?: string[];
  productIds?: string[];
}

const TEXT_FIELDS = [
  "name_zh", "name_en", "industry", "address_zh", "address_en", "br_no",
  "website", "followed_by", "notes", "source",
] as const;

export interface DuplicateHit { id: string; code: string; name: string; why: string }

/**
 * 開新公司之前查重：電話（任何一個號）、中文名、英文名（正規化後全名一樣）。
 * ❗Equal 教訓：「先查重後動筆」；名鎖匙剝完係空就唔用（'' = '' 會全部撞中）。
 */
export async function findDuplicates(sql: Sql, input: { name_zh?: string | null; name_en?: string | null; phones?: PhoneInput[] }, excludeId?: string): Promise<DuplicateHit[]> {
  const hits = new Map<string, DuplicateHit>();
  const phones = (input.phones ?? []).map((p) => p.phone).filter(Boolean);
  if (phones.length) {
    const rows = await sql<{ id: string; code: string; name: string; phone: string }[]>`
      select c.id, c.code, coalesce(nullif(btrim(c.name_zh), ''), c.name_en) as name, p.phone
        from public.company_phones p join public.companies c on c.id = p.company_id
       where p.phone in ${sql(phones)}`;
    for (const r of rows) {
      if (r.id === excludeId) continue;
      hits.set(r.id, { id: r.id, code: r.code, name: r.name, why: `電話 ${r.phone} 一樣（可以係同集團共用總機，睇清楚先）` });
    }
  }
  const keys = [nameKey(input.name_zh), nameKey(input.name_en)].filter((k) => k.length >= 2);
  if (keys.length) {
    // ❗唔用 SQL like 揀候選：「A.B.C. Engineering Ltd」嘅 nospace 仲有點，
    //   「%abcengineering%」夾唔中，真孖生會漏。幾千間公司，攞晒個名喺度對最穩陣。
    const rows = await sql<{ id: string; code: string; name_zh: string | null; name_en: string | null }[]>`
      select id, code, name_zh, name_en from public.companies`;
    for (const r of rows) {
      if (r.id === excludeId) continue;
      const theirs = [nameKey(r.name_zh), nameKey(r.name_en)];
      if (keys.some((k) => theirs.includes(k)) && !hits.has(r.id)) {
        hits.set(r.id, { id: r.id, code: r.code, name: r.name_zh || r.name_en || "", why: "公司名一樣" });
      }
    }
  }
  return [...hits.values()];
}

export async function createCompany(
  sql: Sql, input: CompanyInput, opts: { force?: boolean; actor?: string } = {},
): Promise<{ created: { id: string; code: string } | null; duplicates: DuplicateHit[] }> {
  if (!blankToNull(input.name_zh) && !blankToNull(input.name_en)) {
    throw new Error("要有公司名（中文或者英文）");
  }
  const duplicates = await findDuplicates(sql, input);
  if (duplicates.length && !opts.force) return { created: null, duplicates };
  const created = await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string; code: string }[]>`
      insert into public.companies (
        name_zh, name_en, customer_type, industry, address_zh, address_en, br_no, website,
        followed_by, mis_checked, notes, source
      ) values (
        ${blankToNull(input.name_zh)}, ${blankToNull(input.name_en)}, ${input.customer_type ?? "公司"},
        ${blankToNull(input.industry)}, ${blankToNull(input.address_zh)}, ${blankToNull(input.address_en)},
        ${blankToNull(input.br_no)}, ${blankToNull(input.website)}, ${blankToNull(input.followed_by)},
        ${input.mis_checked ?? false}, ${blankToNull(input.notes)}, ${blankToNull(input.source) ?? "手動"}
      ) returning id, code`;
    await writeChildren(tx as unknown as Sql, row!.id, input);
    await tx`insert into public.audit_log (actor, action, table_name, record_id, after)
             values (${opts.actor ?? "web"}, 'create_company', 'companies', ${row!.id}, ${tx.json(toJson(input))})`;
    return row!;
  });
  return { created, duplicates };
}

async function writeChildren(tx: Sql, id: string, input: CompanyInput): Promise<void> {
  if (input.phones) {
    await tx`delete from public.company_phones where company_id = ${id}`;
    for (const [i, p] of input.phones.entries()) {
      await tx`insert into public.company_phones (company_id, phone, label, raw, sort)
               values (${id}, ${p.phone}, ${p.label ?? "總機"}, ${p.raw ?? null}, ${i})
               on conflict (company_id, phone) do nothing`;
    }
  }
  if (input.emails) {
    await tx`delete from public.company_emails where company_id = ${id}`;
    for (const [i, e] of input.emails.entries()) {
      await tx`insert into public.company_emails (company_id, email, sort) values (${id}, ${e}, ${i})
               on conflict (company_id, email) do nothing`;
    }
  }
  if (input.productIds) {
    await tx`delete from public.company_products where company_id = ${id}`;
    if (input.productIds.length) {
      await tx`insert into public.company_products (company_id, product_id)
               select ${id}, unnest(${input.productIds}::uuid[]) on conflict do nothing`;
    }
  }
}

/** 改公司：電話／電郵／興趣產品畀咗就成格換（重建時補返嘅註釋）。 */
export async function updateCompany(sql: Sql, id: string, patch: CompanyInput, actor = "web"): Promise<void> {
  if (patch.status !== undefined && !(COMPANY_STATUSES as readonly string[]).includes(patch.status)) {
    throw new Error(`狀態要係：${COMPANY_STATUSES.join("／")}`);
  }
  if (patch.customer_type !== undefined && !["公司", "個人"].includes(patch.customer_type)) {
    throw new Error("客戶類型要係 公司 或 個人");
  }
  await sql.begin(async (tx) => {
    const [before] = await tx`select * from public.companies where id = ${id} for update`;
    if (!before) throw new Error("搵唔到呢間公司");
    const set: Record<string, unknown> = {};
    for (const k of TEXT_FIELDS) if (patch[k] !== undefined) set[k] = blankToNull(patch[k]);
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.customer_type !== undefined) set.customer_type = patch.customer_type;
    if (patch.mis_checked !== undefined) set.mis_checked = Boolean(patch.mis_checked);
    const nameZh = "name_zh" in set ? set.name_zh : before.name_zh;
    const nameEn = "name_en" in set ? set.name_en : before.name_en;
    if (!nameZh && !nameEn) throw new Error("唔可以兩個名都清晒");
    if (Object.keys(set).length) {
      await tx`update public.companies set ${tx(set)} where id = ${id}`;
    }
    await writeChildren(tx as unknown as Sql, id, patch);
    await tx`insert into public.audit_log (actor, action, table_name, record_id, before, after)
             values (${actor}, 'update_company', 'companies', ${id},
                     ${tx.json(toJson(before))}, ${tx.json(toJson(patch))})`;
  });
}

// ── 聯絡人 ────────────────────────────────────────────────────────────────

export interface ContactInput {
  name?: string;
  title?: string | null;
  phone?: string | null;
  email?: string | null;
  is_decision_maker?: boolean;
  notes?: string | null;
}

export async function addContact(sql: Sql, companyId: string, c: ContactInput, actor = "web"): Promise<string> {
  const name = blankToNull(c.name);
  if (!name) throw new Error("聯絡人要有名");
  return sql.begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into public.contacts (company_id, name, title, phone, email, is_decision_maker, notes)
      values (${companyId}, ${name}, ${blankToNull(c.title)}, ${blankToNull(c.phone)},
              ${blankToNull(c.email)}, ${c.is_decision_maker ?? false}, ${blankToNull(c.notes)})
      returning id`;
    await tx`insert into public.audit_log (actor, action, table_name, record_id, after)
             values (${actor}, 'add_contact', 'contacts', ${row!.id}, ${tx.json(toJson({ ...c, companyId }))})`;
    return row!.id;
  });
}

export async function updateContact(sql: Sql, id: string, c: ContactInput, actor = "web"): Promise<void> {
  const set: Record<string, unknown> = {};
  if (c.name !== undefined) {
    const n = blankToNull(c.name);
    if (!n) throw new Error("聯絡人要有名");
    set.name = n;
  }
  for (const k of ["title", "phone", "email", "notes"] as const) if (c[k] !== undefined) set[k] = blankToNull(c[k]);
  if (c.is_decision_maker !== undefined) set.is_decision_maker = Boolean(c.is_decision_maker);
  if (!Object.keys(set).length) return;
  await sql.begin(async (tx) => {
    const [before] = await tx`select * from public.contacts where id = ${id} for update`;
    if (!before) throw new Error("搵唔到呢個聯絡人");
    await tx`update public.contacts set ${tx(set)} where id = ${id}`;
    await tx`insert into public.audit_log (actor, action, table_name, record_id, before, after)
             values (${actor}, 'update_contact', 'contacts', ${id},
                     ${tx.json(toJson(before))}, ${tx.json(toJson(set))})`;
  });
}

export async function deleteContact(sql: Sql, id: string, actor = "web"): Promise<void> {
  await sql.begin(async (tx) => {
    const [before] = await tx`select * from public.contacts where id = ${id} for update`;
    if (!before) throw new Error("搵唔到呢個聯絡人");
    await tx`delete from public.contacts where id = ${id}`;
    await tx`insert into public.audit_log (actor, action, table_name, record_id, before)
             values (${actor}, 'delete_contact', 'contacts', ${id}, ${tx.json(toJson(before))})`;
  });
}

// ── 刪除（Kevin 2026-10-16「加個刪除」—— 匯入名單有孖生，同一個電話幾張卡）──────────────
/**
 * 真刪除，但**有電話記錄或者約見面嘅唔准刪**：所有子表都係 on delete cascade，
 * 刪咗佢啲 calls 會靜靜雞令以前嗰幾日嘅每日數變細。嗰啲改狀態（不需要／已結業）就得。
 * 刪之前成張卡（連電話、電郵、聯絡人、備註）寫落 audit_log，唔小心刪錯仲搵得返。
 */
export async function deleteCompany(sql: Sql, id: string, actor = "web"): Promise<{ code: string; name: string }> {
  return sql.begin(async (tx) => {
    const [c] = await tx<{ id: string; code: string; name_zh: string | null; name_en: string | null }[]>`
      select * from public.companies where id = ${id} for update`;
    if (!c) throw new Error("搵唔到呢間公司（可能已經刪咗）");
    const [n] = await tx<{ calls: number; appts: number }[]>`
      select (select count(*)::int from public.calls where company_id = ${id}) as calls,
             (select count(*)::int from public.appointments where company_id = ${id}) as appts`;
    if (n!.calls || n!.appts) {
      const bits = [n!.calls ? `${n!.calls} 次電話記錄` : "", n!.appts ? `${n!.appts} 個約見面` : ""].filter(Boolean).join("、");
      throw new Error(`${c.code} 有 ${bits}，刪咗連以前嘅每日數都會變 —— 唔刪得。唔想再見佢就改狀態做「不需要」或者「已結業」。`);
    }
    const [phones, emails, contacts, remarks, tasks] = await Promise.all([
      tx`select phone, label, raw from public.company_phones where company_id = ${id}`,
      tx`select email from public.company_emails where company_id = ${id}`,
      tx`select name, title, phone, email, notes from public.contacts where company_id = ${id}`,
      tx`select body, author, source, created_at from public.company_remarks where company_id = ${id}`,
      tx`select kind, status, note, due_at from public.tasks where company_id = ${id}`,
    ]);
    await tx`delete from public.companies where id = ${id}`;
    await tx`insert into public.audit_log (actor, action, table_name, record_id, before)
             values (${actor}, 'delete_company', 'companies', ${id},
                     ${tx.json(toJson({ company: c, phones, emails, contacts, remarks, tasks }))})`;
    return { code: c.code, name: c.name_zh || c.name_en || "" };
  });
}

/**
 * 清單每行嘅全部備註（Kevin 2026-10-16「顯示所有備註」）：手寫備註＋每一次電話（冇內容都出「第 N 次 · 結果」），
 * 有日期嘅新嘅行先；名單匯入嗰啲冇日期，排最尾。一頁幾十間一句 query。
 */
async function attachAllNotes(sql: Sql, rows: CompanyListRow[]): Promise<void> {
  if (!rows.length) return;
  const ids = rows.map((r) => r.id);
  const all = await sql<(LastNote & { company_id: string })[]>`
    select company_id, kind, text, at, author, outcome, attempt_no from (
      select r.company_id, (case when r.source = 'import' then 'import' else 'remark' end) as kind, r.body as text,
             case when r.source = 'import' then null else r.created_at end as at,
             r.author, null::text as outcome, null::int as attempt_no,
             case when r.source = 'import' then 1 else 2 end as pri, r.created_at as tie
        from public.company_remarks r where r.company_id = any(${ids}::uuid[])
      union all
      select k.company_id, 'call', k.content, k.called_at, null, k.outcome, k.attempt_no, 2, k.called_at
        from public.calls k where k.company_id = any(${ids}::uuid[])
    ) u
    order by company_id, pri desc, at desc nulls last, (text ~ '^[^：]{1,12}：'), tie`;
  const by = new Map<string, LastNote[]>();
  for (const n of all) {
    const list = by.get(n.company_id) ?? [];
    list.push({ kind: n.kind, text: n.text, at: n.at, author: n.author, outcome: n.outcome, attempt_no: n.attempt_no ?? null });
    by.set(n.company_id, list);
  }
  for (const r of rows) r.history = by.get(r.id) ?? [];
}

