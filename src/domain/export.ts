/**
 * 公司清單導出 Excel —— 同畫面上嘅篩選一模一樣（搵到幾多間就出幾多間，唔截）。
 *
 * ❗電話欄傳真會標「（傳真）」，打 call list 唔會撥錯。
 * ❗日子時間一律香港時間。
 */

import ExcelJS from "exceljs";
import type { Sql } from "../db/client.js";
import { listCompanies, type CompanyFilters, type CompanyListRow } from "./companies.js";
import { listProducts } from "./products.js";

const PAGE = 5000;

function hkStamp(d: Date | null): string {
  if (!d) return "";
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
}

/** 篩選條件寫返做人睇得明嘅中文（放喺「篩選」嗰張 sheet）。 */
export function describeFilters(f: CompanyFilters, productName: (id: string) => string): string[] {
  const out: string[] = [];
  if (f.q) out.push(`搜尋：${f.q}`);
  if (f.status?.length) out.push(`狀態：${f.status.join("、")}`);
  if (f.industry) out.push(`行業：${f.industry}`);
  if (f.r) out.push(f.r === "yes" ? "R：有" : "R：未有");
  if (f.d) out.push(f.d === "yes" ? "D：有" : "D：未有");
  if (f.lastOutcome) out.push(`最後結果：${f.lastOutcome}`);
  if (f.productId) out.push(`有興趣：${productName(f.productId)}`);
  if (f.mis) out.push(f.mis === "yes" ? "MIS：查過" : "MIS：未查");
  if (f.called) out.push(f.called === "yes" ? "打過" : "未打過");
  if (f.cold) out.push("冷電名單（未打／跟進中、冇同事跟開）");
  if (f.contractEndBy) out.push(`合約 ${f.contractEndBy} 或之前到期`);
  return out.length ? out : ["（冇篩選，全部公司）"];
}

export async function companiesXlsx(sql: Sql, f: CompanyFilters, generatedAt = new Date()): Promise<{ buf: Buffer; total: number }> {
  const rows: CompanyListRow[] = [];
  let total = 0, totalR = 0, totalD = 0;
  for (let off = 0; ; off += PAGE) {
    const page = await listCompanies(sql, f, PAGE, off);
    if (off === 0) ({ total, totalR, totalD } = page);
    rows.push(...page.rows);
    if (page.rows.length === 0 || rows.length >= page.total) break;
  }
  const products = await listProducts(sql, { includeInactive: true });
  const pname = new Map(products.map((p) => [p.id, p.name]));

  const wb = new ExcelJS.Workbook();
  wb.created = generatedAt;
  const ws = wb.addWorksheet("公司", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "編號", key: "code", width: 10 },
    { header: "中文名", key: "name_zh", width: 26 },
    { header: "英文名", key: "name_en", width: 30 },
    { header: "行業", key: "industry", width: 18 },
    { header: "狀態", key: "status", width: 10 },
    { header: "電話", key: "phones", width: 26 },
    { header: "電郵", key: "emails", width: 26 },
    { header: "中文地址", key: "address_zh", width: 30 },
    { header: "英文地址", key: "address_en", width: 30 },
    { header: "打過幾次", key: "call_count", width: 8 },
    { header: "最後打", key: "last_call_at", width: 16 },
    { header: "最後結果", key: "last_outcome", width: 12 },
    { header: "R", key: "r", width: 4 },
    { header: "D", key: "d", width: 4 },
    { header: "合約到期", key: "d_contract_end", width: 11 },
    { header: "用緊邊個台", key: "d_provider", width: 12 },
    { header: "而家價錢", key: "d_price", width: 12 },
    { header: "而家套餐", key: "d_plan", width: 20 },
    { header: "興趣產品", key: "products", width: 24 },
    { header: "其他人跟進", key: "followed_by", width: 12 },
    { header: "MIS 查過", key: "mis", width: 8 },
    { header: "待辦", key: "open_tasks", width: 6 },
    { header: "BR", key: "br_no", width: 12 },
    { header: "網站", key: "website", width: 20 },
    { header: "備註", key: "notes", width: 30 },
    { header: "來源", key: "source", width: 24 },
  ];
  for (const r of rows) {
    ws.addRow({
      ...r,
      last_call_at: hkStamp(r.last_call_at),
      r: r.ever_r ? "✓" : "",
      d: r.ever_d ? "✓" : "",
      d_contract_end: r.d_contract_end ?? "",
      products: r.product_ids.map((id) => pname.get(id) ?? "?").join("、"),
      mis: r.mis_checked ? "✓" : "",
    });
  }
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

  const info = wb.addWorksheet("篩選");
  info.columns = [{ width: 16 }, { width: 50 }];
  info.addRow(["導出時間", hkStamp(generatedAt)]);
  for (const line of describeFilters(f, (id) => pname.get(id) ?? id)) info.addRow(["篩選", line]);
  info.addRow(["共幾多間", total]);
  info.addRow(["當中 R", totalR]);
  info.addRow(["當中 D", totalD]);
  if (rows.length !== total) info.addRow(["❗注意", `清單得 ${rows.length} 行，但應該有 ${total} 間 —— 導出途中有人改緊資料，再導一次`]);

  return { buf: Buffer.from(await wb.xlsx.writeBuffer()), total };
}
