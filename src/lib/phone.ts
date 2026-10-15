/**
 * 香港電話：正規化、一格拆幾個號、認傳真。
 *
 * 存法：8 位數字，冇空格冇 +852（`company_phones.phone`）。原文另外留喺 `raw`。
 *
 * ❗字頭收 2–9：香港號碼冇 0／1 字頭。Equal CRM 舊版淨收 2/3/5/6/9，
 *   上次整 call list 就係噉丟咗 72 個真號（8 字頭個人號碼服務、4 字頭新手機號）。
 * ❗認唔到就回 null 連原因，唔估。
 */

export type PhoneLabel = "總機" | "直線" | "手提" | "傳真" | "其他";

export interface ParsedPhone {
  phone: string | null;
  raw: string;
  label: PhoneLabel;
  reason?: string;
}

const FULLWIDTH = /[０-９＋（）－]/g;

function halfWidth(s: string): string {
  return s.replace(FULLWIDTH, (ch) => {
    if (ch === "＋") return "+";
    if (ch === "（") return "(";
    if (ch === "）") return ")";
    if (ch === "－") return "-";
    return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
  });
}

/** 一個號 → 8 位。認唔到回 null ＋ 原因。 */
export function normalizePhone(raw: string): { phone: string | null; reason?: string } {
  if (typeof raw !== "string" || raw.trim() === "") return { phone: null, reason: "空白" };
  const digits = halfWidth(raw).replace(/\D/g, "");
  if (digits === "") return { phone: null, reason: "冇數字" };
  let local: string;
  if (digits.length === 8) local = digits;
  else if (digits.length === 11 && digits.startsWith("852")) local = digits.slice(3);
  else if (digits.length === 13 && digits.startsWith("00852")) local = digits.slice(5);
  else {
    return {
      phone: null,
      reason: digits.length > 8
        ? `${digits.length} 位數 —— 唔似香港號碼（外地號？一格兩個號冇分隔？）`
        : `得 ${digits.length} 位數，香港號碼要 8 位`,
    };
  }
  if (local[0] === "0" || local[0] === "1") {
    return { phone: null, reason: `香港號碼唔會 ${local[0]} 字頭` };
  }
  return { phone: local };
}

/** 由標籤字眼估呢個號係乜（傳真最緊要：打極接唔到人嘅號多數係傳真）。 */
export function labelFromText(text: string, fallback: PhoneLabel = "總機"): PhoneLabel {
  const t = text.toLowerCase();
  if (/fax|傳真|传真|圖文/.test(t)) return "傳真";
  if (/mobile|手提|手機|whatsapp|cell/.test(t)) return "手提";
  if (/direct|直線|dl\b/.test(t)) return "直線";
  if (/tel|電話|總機|office|main|hotline|熱線/.test(t)) return "總機";
  return fallback;
}

/**
 * 一格入面可能有幾個號（「2345 6789 / 9876 5432」「2345 6789|2345 6790」係常態）。
 * 拆開逐個正規化。標籤（Fax：、手提：）貼喺號碼前面嘅會跟埋嗰個號。
 *
 * ❗唔可以剝晒非數字再切 8 位一份：「2345 6789 9876 5432」會啱，但
 *   「2345-6789 ext 12」就會將內線當咗下一個號嘅頭。先按分隔符拆。
 */
export function parsePhoneCell(cell: string, fallback: PhoneLabel = "總機"): ParsedPhone[] {
  if (typeof cell !== "string" || cell.trim() === "") return [];
  const text = halfWidth(cell);
  const parts = text
    .split(/[/|,;、，；\n]|\s{2,}|\bor\b|或/i)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const out: ParsedPhone[] = [];
  for (const part of parts) {
    // 一段入面有兩個 8 位號冇分隔符（「Tel: 2345 6789 Fax: 2345 6790」）都拆。
    // ❗每個號攞**緊貼佢前面**嗰段字做標籤，唔係成段 —— 成段計嘅話兩個號都會
    //   變「傳真」（Equal CRM：「電話 2345 2219 傳真 2345 2259」兩個號都當咗傳真）。
    const runs = [...part.matchAll(/(?:\+?852[\s-]?)?\d{4}[\s-]?\d{4}/g)];
    if (runs.length > 1) {
      let prevEnd = 0;
      for (const m of runs) {
        const before = part.slice(prevEnd, m.index);
        prevEnd = (m.index ?? 0) + m[0].length;
        const n = normalizePhone(m[0]);
        out.push({
          phone: n.phone, raw: m[0], label: labelFromText(before, fallback),
          ...(n.reason ? { reason: n.reason } : {}),
        });
      }
      continue;
    }
    const label = labelFromText(part, fallback);
    // 剝走前面嘅標籤字（Tel:、傳真：）同後面嘅內線（ext 12）先正規化
    const core = part.replace(/^[^\d+]*/, "").replace(/\s*(ext\.?|內線|轉)\s*\d+\s*$/i, "");
    const n = normalizePhone(core);
    out.push({ phone: n.phone, raw: part, label, ...(n.reason ? { reason: n.reason } : {}) });
  }
  return out;
}

/** 顯示用：「2345 6789」。 */
export function formatPhone(p: string): string {
  return /^\d{8}$/.test(p) ? `${p.slice(0, 4)} ${p.slice(4)}` : p;
}
