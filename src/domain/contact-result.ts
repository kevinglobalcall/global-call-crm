/**
 * 名單入面「聯絡結果」嗰欄（Kevin 自己寫嘅英文速記）→ CRM 狀態。
 *
 * ❗Kevin 2026-10-16：「不明的問我 不要自己加狀態」。所以呢度淨係有佢**親口拍板**嗰幾組；
 *   認唔到就回 null —— 匯入嗰陣狀態唔郁（未打），原文照入備註記錄，preview 逐行列出嚟問佢。
 *   加新規則之前一定要佢答過，唔好見到似就加。
 *
 * 佢拍板嘅（2026-10-16，對住 2026-10-15 版整合公司名單）：
 *   no need／not interest（連 on need、emaied 呢類錯字）→ 不需要
 *   dead／phone dead／cut line                         → 不需要（「唔再出冷電名單」）
 *   close／永久停業                                     → 已結業
 *   打過未有結論：no one answer／one ring／vm、left contact／call tmr／in meeting、
 *   wts、email only／ask to email、淨係 emailed           → 跟進中
 *   日子分隔行（14/10…）「唔準，唔好用」—— 冇公司名，匯入本身就跳過。
 */
import type { CompanyStatus } from "./outcomes.js";

export interface ResultRule { status: CompanyStatus; rule: string }

/** 次序有意思：結業、電話死行先（「close, emailed」唔好俾 emailed 嗰條食咗）。 */
const RULES: { rule: string; status: CompanyStatus; re: RegExp }[] = [
  { rule: "結業", status: "已結業", re: /^close\b|永久停業/ },
  { rule: "電話打唔通", status: "不需要", re: /\bdead\b|cut line/ },
  { rule: "唔需要", status: "不需要", re: /\bno need\b|not interest|\bon need\b/ },
  { rule: "冇人接", status: "跟進中", re: /no one answer|no answer|one ring|^vm\b|left vm/ },
  { rule: "約回撥／留咗聯絡", status: "跟進中", re: /call bk|call tmr|call later|will call|in meeting|not in office|left (num|contact|conact)/ },
  { rule: "WhatsApp", status: "跟進中", re: /\bwts\b/ },
  { rule: "只要電郵", status: "跟進中", re: /email only|ask to email|^email\b|email marketing/ },
  { rule: "已電郵", status: "跟進中", re: /^(emailed|emiled|emailed new)$/ },
];

/**
 * Kevin 逐行答嘅（原文 → 狀態）。鎖原文（細楷、空格縮做一個）唔鎖公司 ——
 * 佢答之前呢度係空，嗰啲行匯入做未打，答完用 update_company 逐間改。
 */
const EXACT: Record<string, CompanyStatus> = {};

export function normResult(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function classifyResult(text: string | null | undefined): ResultRule | null {
  const t = normResult(text ?? "");
  if (!t) return null;
  const exact = EXACT[t];
  if (exact) return { status: exact, rule: "Kevin 逐行答" };
  const hit = RULES.find((r) => r.re.test(t));
  return hit ? { status: hit.status, rule: hit.rule } : null;
}
