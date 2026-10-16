/**
 * 備註記錄（Remark Record）—— 跟 Kevin 公司 MIS 嗰種：時間、邊個、內容，最新喺頂。
 * 寫／刪都入 audit_log；刪咗都查得返原文。
 */
import { one, toJson, type Sql } from "../db/client.js";

export type RemarkSource = "web" | "mcp" | "import";

export interface RemarkRow {
  id: string;
  company_id: string;
  body: string;
  author: string;
  source: RemarkSource;
  created_at: Date;
}

const AUTHOR: Record<RemarkSource, string> = { web: "Kevin", mcp: "Claude", import: "名單匯入" };

export async function listRemarks(sql: Sql, companyId: string, limit = 300): Promise<RemarkRow[]> {
  return sql<RemarkRow[]>`
    select * from public.company_remarks where company_id = ${companyId}
     order by created_at desc, id limit ${limit}`;
}

export async function addRemark(
  sql: Sql, companyId: string, body: string, source: Exclude<RemarkSource, "import"> = "web",
): Promise<RemarkRow> {
  const text = body.trim();
  if (!text) throw new Error("備註要寫嘢");
  if (text.length > 5000) throw new Error("備註太長（最多 5000 字）");
  return sql.begin(async (tx) => {
    one(await tx`select id from public.companies where id = ${companyId}`, "呢間公司");
    const row = one(await tx<RemarkRow[]>`
      insert into public.company_remarks (company_id, body, author, source)
      values (${companyId}, ${text}, ${AUTHOR[source]}, ${source}) returning *`);
    await tx`insert into public.audit_log (actor, action, table_name, record_id, after)
             values (${source === "mcp" ? "claude" : "web"}, 'add_remark', 'company_remarks', ${row.id}, ${tx.json(toJson(row))})`;
    return row;
  });
}

export async function deleteRemark(sql: Sql, id: string, actor = "web"): Promise<void> {
  await sql.begin(async (tx) => {
    const before = one(await tx<RemarkRow[]>`select * from public.company_remarks where id = ${id} for update`, "呢條備註");
    await tx`delete from public.company_remarks where id = ${id}`;
    await tx`insert into public.audit_log (actor, action, table_name, record_id, before)
             values (${actor}, 'delete_remark', 'company_remarks', ${id}, ${tx.json(toJson(before))})`;
  });
}
