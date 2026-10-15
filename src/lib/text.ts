/**
 * 文字小工具。
 */

/**
 * 搜尋用：細楷、剝晒空格（半形、全形、tab、換行）。
 * ❗同 SQL 個 `public.nospace()` 一模一樣 —— 兩邊做法唔同就會「打得出搵唔到」。
 *   Kevin 規矩：搜尋無視空格（講咗三次）。
 */
export function nospace(s: string | null | undefined): string {
  return String(s ?? "").toLowerCase().replace(/[\s　]+/g, "");
}

/** LIKE 嘅 % _ \ 要 escape，唔係客打個「_」就變萬用字元。 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** 空字串當冇。 */
export function blankToNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

const EN_SUFFIX = new Set(["limited", "ltd", "company", "co", "corp", "corporation", "inc"]);

/**
 * 公司名正規化（查重用）：細楷、剝走空格標點、剝走 limited／ltd／有限公司 呢啲尾。
 *
 * ❗尾字要「成個字」先剝：「Tesco」唔可以剝咗個「co」變「tes」。
 * ❗「&」當「and」—— Equal CRM 查重漏咗 `A. King … & Engineering` 對 `… and Engineering`。
 * 剝完係空字串（例如成個名淨係「有限公司」）就回 ""，caller 一定要當「冇鎖匙」
 * —— SQL 入面 '' = '' 係 true，唔擋住就成批冇名嘅行會互相撞中（Equal 中過）。
 */
export function nameKey(s: string | null | undefined): string {
  const t = String(s ?? "").toLowerCase().replace(/&/g, " and ");
  const words = t.split(/[^0-9a-z㐀-鿿]+/).filter((w) => w !== "");
  while (words.length > 1 && EN_SUFFIX.has(words[words.length - 1]!)) words.pop();
  let key = words.join("");
  key = key.replace(/(有限公司|公司)$/, "");
  return key;
}
