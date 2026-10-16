/**
 * 備註記錄（Remark Record）—— 對真 Postgres（真 migration）。
 */
import { describe, expect, it } from "vitest";
import { getCompany } from "../src/domain/companies.js";
import { addRemark, deleteRemark, listRemarks } from "../src/domain/remarks.js";
import { makeCompany, useTestDb } from "./helpers/db.js";

const t = useTestDb();

describe("備註記錄", () => {
  it("加備註：剝走頭尾空白、寫低邊個、最新喺頂；getCompany 帶埋", async () => {
    const id = await makeCompany(t.sql);
    await addRemark(t.sql, id, "  a women pick up, dunno leo  ");
    await t.sql`update public.company_remarks set created_at = created_at - interval '1 day'`;
    await addRemark(t.sql, id, "前台話 Leo 放假", "mcp");
    const rows = await listRemarks(t.sql, id);
    expect(rows.map((r) => [r.body, r.author, r.source])).toEqual([
      ["前台話 Leo 放假", "Claude", "mcp"],
      ["a women pick up, dunno leo", "Kevin", "web"],
    ]);
    expect((await getCompany(t.sql, id))!.remarks.map((r) => r.body)).toEqual(["前台話 Leo 放假", "a women pick up, dunno leo"]);
  });

  it("空白備註、搵唔到公司 → 錯，乜都冇寫", async () => {
    const id = await makeCompany(t.sql);
    await expect(addRemark(t.sql, id, "   ")).rejects.toThrow(/要寫嘢/);
    await expect(addRemark(t.sql, "00000000-0000-0000-0000-000000000000", "x")).rejects.toThrow(/搵唔到呢間公司/);
    expect((await listRemarks(t.sql, id)).length).toBe(0);
  });

  it("加同刪都入 audit_log；刪咗原文喺 audit 查得返", async () => {
    const id = await makeCompany(t.sql);
    const r = await addRemark(t.sql, id, "called 9872 1105, no pick up");
    await deleteRemark(t.sql, r.id);
    expect((await listRemarks(t.sql, id)).length).toBe(0);
    const a = await t.sql<{ action: string; before: { body: string } | null }[]>`
      select action, before from public.audit_log where record_id = ${r.id} order by id`;
    expect(a.map((x) => x.action)).toEqual(["add_remark", "delete_remark"]);
    expect(a[1]!.before!.body).toBe("called 9872 1105, no pick up");
  });

  it("DB 自己都擋空白備註（唔靠 JS）", async () => {
    const id = await makeCompany(t.sql);
    await expect(t.sql`insert into public.company_remarks (company_id, body) values (${id}, '  ')`).rejects.toThrow(/check/);
  });
});
