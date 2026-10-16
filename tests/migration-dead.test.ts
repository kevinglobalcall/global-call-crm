/**
 * 一次性資料修正：名單匯入嘅 dead 由「不需要」改做「唔通」（Kevin 2026-10-16「cut line 不需要 / dead 唔通」）。
 * 直接行個 migration 檔（同 production release 行嘅係同一份），睇佢郁啱邊幾間、唔郁邊幾間。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { logCall } from "../src/domain/calls.js";
import { makeCompany, useTestDb } from "./helpers/db.js";

const t = useTestDb();
const FILE = readFileSync(join(import.meta.dirname, "..", "supabase", "migrations", "20261016000400_import_dead_to_no_line.sql"), "utf8");

async function imported(body: string, status = "不需要"): Promise<string> {
  const id = await makeCompany(t.sql);
  await t.sql`update public.companies set status = ${status} where id = ${id}`;
  await t.sql`insert into public.company_remarks (company_id, body, author, source) values (${id}, ${body}, '名單匯入', 'import')`;
  return id;
}
const statusOf = async (id: string) => (await t.sql<{ status: string }[]>`select status from public.companies where id = ${id}`)[0]!.status;

describe("dead → 唔通（一次性）", () => {
  it("淨係改：仲係不需要 ＋ 匯入備註有 dead ＋ 之後冇打過；cut line／no need／Kevin 打過嘅唔郁；入 audit", async () => {
    const dead = await imported("dead, emailed");
    const phoneDead = await imported("phone dead");
    const cut = await imported("cut line, emailed");
    const noNeed = await imported("no need, emailed");
    const touched = await imported("dead , emailed");
    await logCall(t.sql, { companyId: touched, outcome: "需要跟進" }); // Kevin 之後打過 → 佢話事，唔郁
    const changedByKevin = await imported("dead", "跟進中");               // 已經唔係不需要 → 唔郁
    const handwritten = await makeCompany(t.sql);                          // 手寫備註（唔係匯入）→ 唔郁
    await t.sql`update public.companies set status = '不需要' where id = ${handwritten}`;
    await t.sql`insert into public.company_remarks (company_id, body) values (${handwritten}, 'dead')`;

    await t.sql.unsafe(FILE);

    expect(await Promise.all([dead, phoneDead, cut, noNeed, touched, changedByKevin, handwritten].map(statusOf)))
      .toEqual(["唔通", "唔通", "不需要", "不需要", "跟進中", "跟進中", "不需要"]);
    const audit = await t.sql<{ record_id: string }[]>`
      select record_id from public.audit_log where actor = 'migration' and action = 'update_company' order by record_id`;
    expect(audit.map((a) => a.record_id).sort()).toEqual([dead, phoneDead].sort());

    // 行多次唔會再郁（已經唔係不需要）
    await t.sql.unsafe(FILE);
    expect((await t.sql`select 1 from public.audit_log where actor = 'migration'`).length).toBe(2);
  });
});
