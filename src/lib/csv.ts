/**
 * CSV：讀（匯入用）同寫（導出／備份用）。
 *
 * ❗讀：識引號（"…"）、引號入面嘅逗號同真斷行、`""` 代表一個引號；開頭嘅 UTF-8 BOM 剝走。
 * ❗寫：開頭一定加 BOM，唔係 Excel 開中文係亂碼。
 */

export interface CsvTable { headers: string[]; rows: string[][] }

export function parseCsv(text: string, sep = sniffSep(text)): CsvTable {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") { inQ = true; continue; }
    if (ch === sep) { row.push(cell); cell = ""; continue; }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
      continue;
    }
    cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter((r) => r.some((c) => c.trim() !== ""));
  return { headers: (clean[0] ?? []).map((h) => h.trim()), rows: clean.slice(1) };
}

/** 估分隔符：Excel 香港版多數逗號；有人會出 tab 或者分號。 */
export function sniffSep(text: string): string {
  const head = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const n = (c: string) => head.split(c).length - 1;
  const tab = n("\t"), semi = n(";"), comma = n(",");
  if (tab > comma && tab > semi) return "\t";
  if (semi > comma) return ";";
  return ",";
}

function cellOut(v: unknown): string {
  if (v === null || v === undefined) return "";
  // jsonb／array 寫返 JSON，唔係「[object Object]」
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 寫 CSV。❗開頭一定要有 UTF-8 BOM —— 冇嘅話 Excel 開中文係亂碼
 * （非技術用家最易撞嗰個坑）。
 */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(cellOut).join(","), ...rows.map((r) => r.map(cellOut).join(","))];
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
