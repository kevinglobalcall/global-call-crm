/**
 * 公司列表匯入（Excel／CSV）—— 兩步：先睇計劃（preview），撳確認先寫（commit）。
 *
 * 規矩（全部係 Equal CRM 撞過嘅）：
 *   · 認唔到嘅欄**唔丟**：值寫落備註「【原欄】欄名：值」，preview 講明邊幾欄冇對到。
 *   · 一格幾個電話／電郵照拆；傳真標返傳真。
 *   · 查重兩條鎖匙：公司名（剝走 Ltd／有限公司／標點後全名一樣）、電話。
 *     ❗名鎖匙剝完係空就唔用（'' = '' 會全部撞中）。
 *     ❗電話撞咗但名唔同 ＝ 可能係同集團共用總機，預設**唔入、列出嚟**畀你睇，
 *       想入就剔「電話撞咗都照入」。
 *   · 檔案入面自己重複（同名）→ 併埋第一行（電話、電郵一齊收）。
 *   · 唔郁現有公司：舊公司有新電話唔會自己補，只會講「可以補」。
 */

import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { toJson, type Sql } from "../db/client.js";
import { parseCsv } from "../lib/csv.js";
import { formatPhone, parsePhoneCell, type PhoneLabel } from "../lib/phone.js";
import { blankToNull, nameKey, nospace } from "../lib/text.js";
import { hkToday } from "../lib/time.js";
import { emailsFromText, type CompanyInput, type PhoneInput } from "./companies.js";
import { classifyResult } from "./contact-result.js";
import type { CompanyStatus } from "./outcomes.js";

export type ImportField =
  | "name" | "name_zh" | "name_en" | "phone" | "fax" | "mobile" | "direct" | "email"
  | "address" | "address_zh" | "address_en" | "industry" | "website" | "br_no" | "notes" | "customer_type"
  | "result" | "followup";

/** 欄名對照（正規化後比：細楷、剝空格標點、剝尾數字 —— 電話1／電話2 都係電話）。 */
const ALIASES: Record<ImportField, string[]> = {
  name: ["公司名稱", "公司名", "名稱", "公司", "name", "company", "companyname", "客戶名稱", "客戶"],
  name_zh: ["中文名", "中文名稱", "公司中文名", "公司中文名稱", "公司名稱中文", "中文公司名", "chinesename", "namezh"],
  name_en: ["英文名", "英文名稱", "英文名／其他名稱", "公司英文名", "公司英文名稱", "公司名稱英文", "英文公司名", "englishname", "nameen"],
  phone: ["電話", "電話號碼", "總機", "聯絡電話", "公司電話", "tel", "telephone", "phone", "phoneno", "phonenumber", "辦公室電話"],
  fax: ["傳真", "傳真號碼", "fax", "faxno"],
  mobile: ["手提", "手提電話", "手機", "mobile", "mobileno", "whatsapp"],
  direct: ["直線", "direct", "directline"],
  // 一般電郵／ESG電郵／已成功Email：Kevin 個整合名單嘅三欄，地址照入電郵欄
  // （Kevin 2026-10-16「已成功Email」當全部冇電郵過 —— 淨係地址，唔加備註、唔改狀態）
  email: ["電郵", "電郵地址", "email", "emailaddress", "電子郵件", "電子郵箱", "郵箱", "一般電郵", "esg電郵", "已成功email"],
  address: ["地址", "公司地址", "address", "中文地址／地址"],
  address_zh: ["中文地址", "地址中文", "chineseaddress", "addresszh"],
  address_en: ["英文地址", "地址英文", "englishaddress", "addressen"],
  industry: ["行業", "行業類別", "類別", "行業桶", "段", "行業段", "industry", "category", "業務", "業務性質", "business"],
  website: ["網站", "網址", "website", "web", "url", "homepage"],
  br_no: ["br", "brno", "brnumber", "商業登記", "商業登記號碼", "商業登記證", "商業登記證號碼"],
  notes: ["備註", "notes", "note", "remark", "remarks", "分類", "黃頁分類", "其他段"],
  customer_type: ["客戶類型", "類型", "type"],
  // 之前打過嘅結果：原文入備註記錄，狀態淨係跟 contact-result.ts 拍板咗嘅規則（認唔到唔郁）
  result: ["聯絡結果", "結果", "通話結果", "contactresult", "callresult", "result"],
  followup: ["聯絡人／補充跟進", "補充跟進", "跟進備註", "followup"],
};

function headerKey(h: string): string {
  return h.toLowerCase().replace(/[\s()（）\-_:：/.#]+/g, "").replace(/\d+$/, "");
}

const LOOKUP = new Map<string, ImportField>();
for (const [field, names] of Object.entries(ALIASES) as [ImportField, string[]][]) {
  for (const n of names) LOOKUP.set(headerKey(n), field);
}

export function mapHeaders(headers: string[]): { mapping: (ImportField | null)[]; unmapped: string[] } {
  const mapping = headers.map((h) => LOOKUP.get(headerKey(h)) ?? null);
  return { mapping, unmapped: headers.filter((_, i) => mapping[i] === null && headers[i]!.trim() !== "") };
}

const HAS_CJK = /[㐀-鿿]/;
const PHONE_PLACEHOLDER = /^(未核實|未有|無|冇|n\/?a|nil|-+)$/i;

/** 「備註」欄照抄；其他落去備註嘅欄（分類、黃頁分類…）連欄名寫，唔係一堆字唔知邊度嚟。 */
const PLAIN_NOTE_HEADERS = new Set(["備註", "notes", "note", "remark", "remarks"].map(headerKey));

// ── 讀檔 ──────────────────────────────────────────────────────────────────

export interface SourceTable { headers: string[]; rows: string[][]; sheet?: string }

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join("");
    if ("text" in o) return cellText(o.text);
    if ("result" in o) return cellText(o.result);
    if ("hyperlink" in o) return String(o.hyperlink);
    return "";
  }
  return String(v);
}

/** 讀 Excel（第一張有嘢嘅 sheet）或者 CSV。 */
export async function readTable(buf: Buffer, filename: string): Promise<SourceTable> {
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b; // .xlsx 係 zip
  if (isZip || /\.xlsx$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    for (const ws of wb.worksheets) {
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        // ❗row.values 係「有窿」嘅 array（空格係 hole），.map 會跳過 hole 留低 undefined
        //   —— 要 Array.from 填返做 "" 先。1-based，所以 slice(1)。
        const vals = Array.from(row.values as unknown[], (v) => cellText(v).trim());
        rows.push(vals.slice(1));
      });
      const clean = rows.filter((r) => r.some((c) => c !== ""));
      if (clean.length >= 2) {
        const width = Math.max(...clean.map((r) => r.length));
        const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
        return { headers: pad(clean[0]!), rows: clean.slice(1).map(pad), sheet: ws.name };
      }
    }
    throw new Error("個 Excel 入面搵唔到有標題＋資料嘅 sheet");
  }
  if (/\.xls$/i.test(filename)) {
    throw new Error("舊式 .xls 讀唔到 —— 喺 Excel「另存新檔」揀 .xlsx 或者 CSV 再上載");
  }
  const t = parseCsv(buf.toString("utf8"));
  if (!t.headers.length) throw new Error("個檔係空嘅");
  return { headers: t.headers, rows: t.rows };
}

// ── 計劃 ──────────────────────────────────────────────────────────────────

export interface PlannedRow {
  line: number;
  action: "new" | "skip";
  reason?: string;
  company: CompanyInput;
  phones: PhoneInput[];
  emails: string[];
  warnings: string[];
  /** 「聯絡結果」等欄嘅原文 —— 開公司嗰陣寫做備註記錄（source=import，原日期不明） */
  remarks: string[];
  /** 聯絡結果原文同認到嘅規則（null ＝ 認唔到，狀態唔郁） */
  result?: { text: string; status: CompanyStatus | null; rule: string | null };
}

export interface UnknownResult { line: number; name: string; text: string }

export interface ImportPlan {
  sheet?: string;
  headers: string[];
  mapping: (ImportField | null)[];
  unmapped: string[];
  rows: PlannedRow[];
  counts: {
    total: number; new: number; mergedInFile: number;
    existingName: number; existingPhone: number; noName: number;
  };
  /** 會開嘅公司入面，每個狀態幾多間（冇聯絡結果 ＝ 未打） */
  byStatus: Record<string, number>;
  /** 聯絡結果認唔到嘅行 —— 狀態唔郁（未打），要問返 Kevin */
  unknownResults: UnknownResult[];
  /** 同一間公司兩行、兩個唔同結果 —— 狀態留未打，問 Kevin */
  conflicts: UnknownResult[];
}

export interface NameHit { code: string; name: string; name_zh: string | null; name_en: string | null }

/**
 * 兩個名對到同一條鎖匙，係咪真係同一間？
 * ❗中文名一樣、英文名唔同 ＝ 兩間公司（建輝工程公司 Kin Fai ≠ 建輝工程有限公司 Kingford，
 *   Kevin 個 2026-10-15 名單就有七對噉嘅）。剝走「公司／有限公司」之後中文名撞，唔等於同一間。
 *   兩邊都有先比；一邊冇就唔算矛盾。
 */
export function namesConflict(
  a: { name_zh?: string | null; name_en?: string | null }, b: { name_zh?: string | null; name_en?: string | null },
): boolean {
  const diff = (x?: string | null, y?: string | null) => {
    const kx = nameKey(x), ky = nameKey(y);
    return kx.length >= 2 && ky.length >= 2 && kx !== ky;
  };
  return diff(a.name_en, b.name_en) || diff(a.name_zh, b.name_zh);
}

/**
 * 檔案入面兩行名對得上（而且唔矛盾），幾時先當同一間併埋：
 *   · 有共同電話；或者
 *   · 其中一行冇電話（冇嘢可以對，名一樣就當同一間）；或者
 *   · 中文名一個係另一個加「有限公司」（上市公司簡稱：信和置業 ／ 信和置業有限公司）
 * 「XX公司」對「XX有限公司」唔算 —— 好多時係兩個唔同嘅法人。
 */
function sameInFile(first: PlannedRow, c: CompanyInput, phones: PhoneInput[]): boolean {
  if (!first.phones.length || !phones.length) return true;
  if (phones.some((p) => first.phones.some((q) => q.phone === p.phone))) return true;
  const z = (x?: string | null) => String(x ?? "").normalize("NFKC").replace(/[\s　]+/g, "");
  const a = z(first.company.name_zh), b = z(c.name_zh);
  if (a !== "" && b !== "" && (a + "有限公司" === b || b + "有限公司" === a || a === b)) return true;
  // 英文全名一樣（淨係 Ltd／Limited、大細楷、空格標點唔同）都算；Co. 對 Limited 唔算（可以係兩個法人）
  const e = (x?: string | null) => String(x ?? "").normalize("NFKC").toLowerCase()
    .replace(/\bltd\b/g, "limited").replace(/[^0-9a-z]+/g, "");
  const ea = e(first.company.name_en), eb = e(c.name_en);
  return ea.length >= 4 && ea === eb;
}

export interface ExistingIndex {
  /** 一條名鎖匙可以對幾間（同中文名、唔同英文名 ＝ 唔同公司） */
  byName: Map<string, NameHit[]>;
  byPhone: Map<string, { code: string; name: string; keys: string[] }>;
}

export async function loadExisting(sql: Sql): Promise<ExistingIndex> {
  const companies = await sql<{ id: string; code: string; name_zh: string | null; name_en: string | null }[]>`
    select id, code, name_zh, name_en from public.companies`;
  const byName = new Map<string, NameHit[]>();
  const keysById = new Map<string, string[]>();
  for (const c of companies) {
    const name = c.name_zh || c.name_en || "";
    for (const k of keysOf(c)) {
      const list = byName.get(k) ?? [];
      list.push({ code: c.code, name, name_zh: c.name_zh, name_en: c.name_en });
      byName.set(k, list);
    }
    keysById.set(c.id, keysOf(c));
  }
  const phones = await sql<{ phone: string; company_id: string; code: string; name: string }[]>`
    select p.phone, p.company_id, c.code, coalesce(nullif(btrim(c.name_zh), ''), c.name_en) as name
      from public.company_phones p join public.companies c on c.id = p.company_id`;
  const byPhone = new Map<string, { code: string; name: string; keys: string[] }>();
  for (const p of phones) {
    if (!byPhone.has(p.phone)) byPhone.set(p.phone, { code: p.code, name: p.name, keys: keysById.get(p.company_id) ?? [] });
  }
  return { byName, byPhone };
}

function keysOf(c: { name_zh?: string | null; name_en?: string | null }): string[] {
  return [...new Set([nameKey(c.name_zh), nameKey(c.name_en)])].filter((k) => k.length >= 2);
}

export function planImport(
  table: SourceTable, existing: ExistingIndex, opts: { allowPhoneClash?: boolean } = {},
): ImportPlan {
  const { mapping, unmapped } = mapHeaders(table.headers);
  const rows: PlannedRow[] = [];
  const firstByKey = new Map<string, PlannedRow[]>();
  /** 檔案入面同一間公司兩行都有聯絡結果、而且結果唔同 —— 唔揀，問返 Kevin */
  const conflicts: { line: number; name: string; text: string }[] = [];

  table.rows.forEach((cells, i) => {
    const line = i + 2; // Excel 行號（標題係第 1 行）
    const c: CompanyInput = {};
    const phones: PhoneInput[] = [];
    const emails: string[] = [];
    const notes: string[] = [];
    const warnings: string[] = [];
    const remarks: string[] = [];
    let result: PlannedRow["result"];
    let genericName: string | null = null;

    const addPhones = (text: string, label: PhoneLabel) => {
      // 「未核實」「N/A」「-」係「冇號碼」，唔係認唔到嘅號碼（Kevin 名單有 96 格「未核實」）
      if (PHONE_PLACEHOLDER.test(text.trim())) return;
      for (const p of parsePhoneCell(text, label)) {
        if (p.phone) {
          if (!phones.some((x) => x.phone === p.phone)) phones.push({ phone: p.phone, label: p.label, raw: p.raw });
        } else {
          // 澳門／內地號、位數唔啱：入唔到電話欄，但原文落備註，唔可以就噉冇咗
          warnings.push(`電話「${p.raw}」認唔到：${p.reason}（原文寫咗落備註）`);
          notes.push(`【認唔到嘅電話】${p.raw}`);
        }
      }
    };

    cells.forEach((raw, col) => {
      const v = (raw ?? "").trim();
      if (!v) return;
      const f = mapping[col];
      switch (f) {
        case "name": genericName = v; break;
        case "name_zh": c.name_zh = v; break;
        case "name_en": c.name_en = v; break;
        case "phone": addPhones(v, "總機"); break;
        case "fax": addPhones(v, "傳真"); break;
        case "mobile": addPhones(v, "手提"); break;
        case "direct": addPhones(v, "直線"); break;
        case "email": {
          const e = emailsFromText(v);
          for (const x of e.ok) if (!emails.includes(x)) emails.push(x);
          for (const b of e.bad) warnings.push(`電郵「${b}」唔似電郵`);
          break;
        }
        case "address": if (HAS_CJK.test(v)) c.address_zh ??= v; else c.address_en ??= v; break;
        case "address_zh": c.address_zh = v; break;
        case "address_en": c.address_en = v; break;
        case "industry": c.industry = v; break;
        case "website": c.website = v; break;
        case "br_no": c.br_no = v; break;
        case "notes":
          notes.push(PLAIN_NOTE_HEADERS.has(headerKey(table.headers[col] ?? "")) ? v : `${table.headers[col]}：${v}`);
          break;
        case "result": {
          const hit = classifyResult(v);
          result = { text: v, status: hit?.status ?? null, rule: hit?.rule ?? null };
          remarks.unshift(v);
          break;
        }
        case "followup": remarks.push(`${table.headers[col]}：${v}`); break;
        case "customer_type":
          if (v === "個人" || v === "公司") c.customer_type = v;
          else notes.push(`【原欄】${table.headers[col]}：${v}`);
          break;
        default: notes.push(`【原欄】${table.headers[col]}：${v}`);
      }
    });
    // 「公司名稱」一欄 —— 有中文當中文名，冇就當英文名（專門嘅中／英欄贏）
    if (genericName) {
      if (HAS_CJK.test(genericName)) c.name_zh ??= genericName;
      else c.name_en ??= genericName;
    }
    // 「中文名」欄入面其實係英文名（名單冇中文名嗰陣好常見）：搬去英文名，唔好兩個名一樣出兩次
    if (c.name_zh && !HAS_CJK.test(c.name_zh)) {
      if (!blankToNull(c.name_en)) { c.name_en = c.name_zh; delete c.name_zh; }
      else if (nospace(c.name_en) === nospace(c.name_zh)) delete c.name_zh;
    }
    // 反過嚟：「英文名」欄抄咗中文名 —— 唔係英文名，唔留
    if (c.name_zh && c.name_en && nospace(c.name_en) === nospace(c.name_zh)) delete c.name_en;
    if (notes.length) c.notes = notes.join("\n");

    if (result?.status) c.status = result.status;
    const row: PlannedRow = { line, action: "new", company: c, phones, emails, warnings, remarks, ...(result ? { result } : {}) };
    rows.push(row);

    if (!blankToNull(c.name_zh) && !blankToNull(c.name_en)) {
      row.action = "skip"; row.reason = "冇公司名"; return;
    }
    // ❗中文名、英文名兩條鎖匙都要試：檔案有中英文、CRM 嗰間淨係得英文，
    //   淨用中文鎖匙就夾唔中，靜靜雞開多張孖生。剝完短過 2 個字唔做鎖匙。
    const keys = keysOf(c);
    const near = keys.flatMap((k) => firstByKey.get(k) ?? []).filter((x) => !namesConflict(x.company, c));
    const first = near.find((x) => sameInFile(x, c, phones));
    if (!first && near[0]) {
      // 名似但冇共同電話：當兩間（祥興工程公司 ≠ 祥興工程有限公司 都可以），寧願兩張卡等 Kevin 合併，
      // 都唔好將兩間公司靜靜雞撈埋（打錯間公司個電話）
      warnings.push(`同第 ${near[0].line} 行名似但冇共同電話，當兩間公司入（係同一間就喺 CRM 合併）`);
    }
    if (first) {
      for (const p of phones) if (!first.phones.some((x) => x.phone === p.phone)) first.phones.push(p);
      for (const e of emails) if (!first.emails.includes(e)) first.emails.push(e);
      for (const m of remarks) if (!first.remarks.includes(m)) first.remarks.push(m);
      if (result) {
        if (!first.result) {
          // 第一行未打過、呢行先有結果 → 用呢行嘅（唔係就靜靜雞變返「未打」）
          first.result = result;
          if (result.status) first.company.status = result.status;
        } else if (first.result.status !== result.status) {
          // 兩行都打過、結果唔同 —— 唔揀，狀態留未打，問返 Kevin
          conflicts.push({ line: first.line, name: first.company.name_zh || first.company.name_en || "",
            text: `「${first.result.text}」（第 ${first.line} 行）vs「${result.text}」（第 ${line} 行）` });
          first.result = { text: `${first.result.text} ／ ${result.text}`, status: null, rule: null };
          delete first.company.status;
        }
      }
      row.action = "skip"; row.reason = `檔案入面重複，併入第 ${first.line} 行`; return;
    }
    for (const k of keys) firstByKey.set(k, [...(firstByKey.get(k) ?? []), row]);
    const hitName = keys.flatMap((k) => existing.byName.get(k) ?? []).find((x) => !namesConflict(x, c));
    if (hitName) {
      row.action = "skip"; row.reason = `已經有：${hitName.code} ${hitName.name}`;
    }
  });

  // 電話對 CRM —— 喺併埋檔案入面孖生**之後**先做：第二行帶嚟嘅電話一樣要查。
  for (const r of rows) {
    if (r.action !== "new") continue;
    if (!r.phones.length && !r.emails.length) r.warnings.push("冇電話又冇電郵");
    if (opts.allowPhoneClash) continue;
    const keys = keysOf(r.company);
    const clash = r.phones.map((p) => existing.byPhone.get(p.phone))
      .find((x) => x !== undefined && !x.keys.some((k) => keys.includes(k)));
    if (clash) {
      r.action = "skip";
      r.reason = `電話撞咗 ${clash.code} ${clash.name}（同集團共用總機？想照入就剔「電話撞咗都照入」）`;
    }
  }

  // 檔案入面唔同名、同電話 → 照入，但提一提
  const seenPhone = new Map<string, number>();
  for (const r of rows) {
    if (r.action !== "new") continue;
    for (const p of r.phones) {
      const prev = seenPhone.get(p.phone);
      if (prev !== undefined) r.warnings.push(`電話 ${formatPhone(p.phone)} 同第 ${prev} 行一樣（共用總機？）`);
      else seenPhone.set(p.phone, r.line);
    }
  }

  const count = (pred: (r: PlannedRow) => boolean) => rows.filter(pred).length;
  const byStatus: Record<string, number> = {};
  const unknownResults: UnknownResult[] = [];
  for (const r of rows) {
    if (r.action !== "new") continue;
    const st = r.company.status ?? "未打";
    byStatus[st] = (byStatus[st] ?? 0) + 1;
    if (r.result && !r.result.status && !conflicts.some((x) => x.line === r.line)) {
      unknownResults.push({ line: r.line, name: r.company.name_zh || r.company.name_en || "", text: r.result.text });
    }
  }
  return {
    ...(table.sheet ? { sheet: table.sheet } : {}),
    headers: table.headers, mapping, unmapped, rows,
    counts: {
      total: rows.length,
      new: count((r) => r.action === "new"),
      mergedInFile: count((r) => r.reason?.startsWith("檔案入面重複") ?? false),
      existingName: count((r) => r.reason?.startsWith("已經有") ?? false),
      existingPhone: count((r) => r.reason?.startsWith("電話撞咗") ?? false),
      noName: count((r) => r.reason === "冇公司名"),
    },
    byStatus, unknownResults, conflicts,
  };
}

/**
 * 寫入。一個 transaction：一行出事成批唔入（唔會留低半批）。
 *
 * ❗成批 insert（每 500 間一句），唔好逐行：Fly 去 Supabase 每句都係一轉網絡來回，
 *   5,000 間逐行入 ≈ 兩萬轉，會撞 HTTP timeout。id 喺呢度出（randomUUID），
 *   電話／電郵先對得返邊間公司，唔靠 RETURNING 嘅次序。
 */
export async function commitImport(
  sql: Sql, plan: ImportPlan, filename: string, actor = "web", today = hkToday(),
): Promise<{ created: number; firstCode: string | null; lastCode: string | null }> {
  const todo = plan.rows.filter((r) => r.action === "new");
  if (!todo.length) return { created: 0, firstCode: null, lastCode: null };
  const source = `${filename}（${today} 匯入）`;
  const CHUNK = 500;
  return sql.begin(async (tx) => {
    const ids: string[] = [];
    for (let i = 0; i < todo.length; i += CHUNK) {
      const part = todo.slice(i, i + CHUNK).map((r) => ({ r, id: randomUUID() }));
      const companies = part.map(({ r, id }) => {
        const c = r.company;
        return {
          id, name_zh: blankToNull(c.name_zh), name_en: blankToNull(c.name_en), customer_type: c.customer_type ?? "公司",
          industry: blankToNull(c.industry), address_zh: blankToNull(c.address_zh), address_en: blankToNull(c.address_en),
          br_no: blankToNull(c.br_no), website: blankToNull(c.website), notes: blankToNull(c.notes), source,
          status: c.status ?? "未打",
        };
      });
      // 逐行 insert 一樣會用 sequence 出 code，次序跟 values 次序 —— 同逐行入一樣
      await tx`insert into public.companies ${tx(companies)}`;
      const phones = part.flatMap(({ r, id }) => r.phones.map((p, k) => ({
        company_id: id, phone: p.phone, label: p.label ?? "總機", raw: p.raw ?? null, sort: k,
      })));
      if (phones.length) await tx`insert into public.company_phones ${tx(phones)} on conflict (company_id, phone) do nothing`;
      const emails = part.flatMap(({ r, id }) => r.emails.map((e, k) => ({ company_id: id, email: e, sort: k })));
      if (emails.length) await tx`insert into public.company_emails ${tx(emails)} on conflict (company_id, email) do nothing`;
      // 舊聯絡結果 → 備註記錄（source=import：冇真日期，網頁寫「原日期不明」）
      const remarks = part.flatMap(({ r, id }) => r.remarks.map((body) => ({
        company_id: id, body, author: "名單匯入", source: "import",
      })));
      if (remarks.length) await tx`insert into public.company_remarks ${tx(remarks)}`;
      ids.push(...part.map((x) => x.id));
    }
    const [range] = await tx<{ n: number; first: string; last: string }[]>`
      select count(*)::int as n, min(code) as first, max(code) as last from public.companies where id = any(${ids}::uuid[])`;
    if (!range || range.n !== todo.length) throw new Error(`寫咗 ${range?.n ?? 0} 間，應該係 ${todo.length} 間 —— 成批唔入`);
    await tx`insert into public.audit_log (actor, action, table_name, record_id, after)
             values (${actor}, 'import', 'companies', ${source},
                     ${tx.json(toJson({ counts: plan.counts, byStatus: plan.byStatus, unknownResults: plan.unknownResults.length, created: range.n, first: range.first, last: range.last }))})`;
    return { created: range.n, firstCode: range.first, lastCode: range.last };
  });
}
