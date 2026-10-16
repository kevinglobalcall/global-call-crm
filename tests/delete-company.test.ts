/**
 * 刪公司（Kevin 2026-10-16「加個刪除」）—— 對真 Postgres。
 * ❗有電話記錄／約見面嘅唔准刪：子表全部 cascade，刪咗會令以前嘅每日數靜靜雞變細。
 */
import { describe, expect, it } from "vitest";
import { createAppointment } from "../src/domain/appointments.js";
import { logCall } from "../src/domain/calls.js";
import { deleteCompany } from "../src/domain/companies.js";
import { addRemark } from "../src/domain/remarks.js";
import { dailyStats } from "../src/domain/stats.js";
import { makeCompany, useTestDb } from "./helpers/db.js";

const t = useTestDb();
const exists = async (id: string) => (await t.sql`select 1 from public.companies where id = ${id}`).length === 1;

describe("刪公司", () => {
  it("乾淨嘅卡（匯入孖生）：刪埋電話、備註；成張卡抄落 audit_log 搵得返", async () => {
    const id = await makeCompany(t.sql);
    await t.sql`insert into public.company_phones (company_id, phone, label) values (${id}, '28800178', '總機')`;
    await addRemark(t.sql, id, "28808224 mr.lau");
    const r = await deleteCompany(t.sql, id);
    expect(r.code).toMatch(/^GC-\d+$/);
    expect(await exists(id)).toBe(false);
    expect((await t.sql`select 1 from public.company_phones where company_id = ${id}`).length).toBe(0);
    const [a] = await t.sql<{ before: { company: { code: string }; phones: { phone: string }[]; remarks: { body: string }[] } }[]>`
      select before from public.audit_log where action = 'delete_company' and record_id = ${id}`;
    expect(a!.before.company.code).toBe(r.code);
    expect(a!.before.phones.map((p) => p.phone)).toEqual(["28800178"]);
    expect(a!.before.remarks.map((x) => x.body)).toEqual(["28808224 mr.lau"]);
  });

  it("❗有電話記錄 → 唔刪、講明點解；每日數冇變", async () => {
    const id = await makeCompany(t.sql);
    await logCall(t.sql, { companyId: id, outcome: "沒有人接", calledAt: new Date("2031-05-05T02:00:00Z") });
    const before = await dailyStats(t.sql, "2031-05-05", "2031-05-05");
    await expect(deleteCompany(t.sql, id)).rejects.toThrow(/1 次電話記錄.*唔刪得.*改狀態/);
    expect(await exists(id)).toBe(true);
    expect(await dailyStats(t.sql, "2031-05-05", "2031-05-05")).toEqual(before);
  });

  it("❗有約見面 → 唔刪", async () => {
    const id = await makeCompany(t.sql);
    await createAppointment(t.sql, { companyId: id, startsAt: new Date("2031-06-01T07:00:00Z") });
    await expect(deleteCompany(t.sql, id)).rejects.toThrow(/1 個約見面/);
    expect(await exists(id)).toBe(true);
  });

  it("搵唔到（例如啱啱喺第二部機刪咗）→ 講清楚", async () => {
    await expect(deleteCompany(t.sql, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/搵唔到/);
  });
});
