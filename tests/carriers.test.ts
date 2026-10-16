/**
 * 一間公司幾個台（Kevin 2026-10-16「要可以加不只一間電訊商」）—— 對真 Postgres。
 *
 *   · 一次電話可以記幾個台；同一個台（名無視空格大細楷）攞最新嗰次講嘅，其他台唔會俾新電話洗走
 *   · 公司總覽：最早到期嗰個做 d_contract_end；d_lines 逐個台
 *   · 續約：逐個台各自出
 *   · migration：舊 calls.d_* 四個欄搬晒落 call_carriers
 */
import { cpSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { connect } from "../src/db/client.js";
import { migrate, MIGRATIONS_DIR } from "../src/db/migrate.js";
import { deleteCall, logCall, updateCall } from "../src/domain/calls.js";
import { getCompany, listCompanies } from "../src/domain/companies.js";
import { renewalsDue } from "../src/domain/renewals.js";
import { makeCompany, useTestDb } from "./helpers/db.js";

const t = useTestDb();
const hk = (s: string) => new Date(`${s}+08:00`);
const overview = async (id: string) => (await listCompanies(t.sql, { id }, 1)).rows[0]!;

describe("一次電話幾個台", () => {
  it("記兩個台 → 兩行；空行唔記；壞日子成次唔寫", async () => {
    const id = await makeCompany(t.sql);
    const r = await logCall(t.sql, { companyId: id, outcome: "需要跟進", carriers: [
      { provider: "CMHK 中國移動", contractEnd: "2028-09-16", price: "130", plan: "4G" },
      { provider: " ", contractEnd: "", price: null },
      { provider: "CSL", price: "150" },
    ] });
    expect(r.call.got_d).toBe(true);
    expect(r.call.carriers!.map((x) => [x.provider, x.contract_end, x.price, x.plan, x.sort])).toEqual([
      ["CMHK 中國移動", "2028-09-16", "130", "4G", 0], ["CSL", null, "150", null, 1]]);
    await expect(logCall(t.sql, { companyId: id, outcome: "需要跟進", carriers: [{ provider: "3HK", contractEnd: "2027-02-30" }] }))
      .rejects.toThrow(/冇呢日/);
    expect((await t.sql`select 1 from public.calls where company_id = ${id}`).length).toBe(1);
  });

  it("舊寫法（dProvider…）同 carriers 一齊畀 → 舊寫法做第一行", async () => {
    const id = await makeCompany(t.sql);
    const r = await logCall(t.sql, { companyId: id, outcome: "需要跟進", dProvider: "SmarTone", carriers: [{ provider: "CSL" }] });
    expect(r.call.carriers!.map((x) => x.provider)).toEqual(["SmarTone", "CSL"]);
  });

  it("❗再打一次淨係講 CSL 新價 → CSL 換新，CMHK 照留（唔會俾新電話洗走）；台名大細楷空格唔同當同一個", async () => {
    const id = await makeCompany(t.sql);
    await logCall(t.sql, { companyId: id, outcome: "需要跟進", calledAt: hk("2026-10-01T10:00"), carriers: [
      { provider: "CMHK", contractEnd: "2028-09-16", price: "130" }, { provider: "CSL", contractEnd: "2027-05-31", price: "150" }] });
    await logCall(t.sql, { companyId: id, outcome: "需要跟進", calledAt: hk("2026-10-10T10:00"), carriers: [
      { provider: "csl ", contractEnd: "2027-06-30", price: "138" }] });
    const o = await overview(id);
    expect(o.d_lines).toEqual([
      { provider: "csl", contract_end: "2027-06-30", price: "138", plan: null },
      { provider: "CMHK", contract_end: "2028-09-16", price: "130", plan: null },
    ]);
    expect(o.d_contract_end).toBe("2027-06-30");
    expect(o.ever_d).toBe(true);
  });

  it("改一次電話：成組換；唔畀 carriers 就唔郁；刪電話連台一齊走、audit 有台", async () => {
    const id = await makeCompany(t.sql);
    const r = await logCall(t.sql, { companyId: id, outcome: "需要跟進", carriers: [{ provider: "CMHK" }, { provider: "CSL" }] });
    const u1 = await updateCall(t.sql, r.call.id, { content: "淨改內容" });
    expect(u1.carriers!.map((x) => x.provider)).toEqual(["CMHK", "CSL"]);
    const u2 = await updateCall(t.sql, r.call.id, { carriers: [{ provider: "3HK", price: "88" }] });
    expect(u2.carriers!.map((x) => x.provider)).toEqual(["3HK"]);
    expect((await getCompany(t.sql, id))!.calls[0]!.carriers!.map((x) => x.provider)).toEqual(["3HK"]);
    await deleteCall(t.sql, r.call.id);
    expect((await t.sql`select 1 from public.call_carriers where call_id = ${r.call.id}`).length).toBe(0);
    const [a] = await t.sql<{ before: { carriers: { provider: string }[] } }[]>`
      select before from public.audit_log where action = 'delete_call' and record_id = ${r.call.id}`;
    expect(a!.before.carriers.map((x) => x.provider)).toEqual(["3HK"]);
    expect((await overview(id)).d_lines).toEqual([]);
  });
});

describe("續約逐個台出", () => {
  it("CMHK 60 日內到期出、CSL 一年後唔出；兩個都近 → 兩行；收埋一個唔影響另一個", async () => {
    const id = await makeCompany(t.sql, { name_zh: "兩個台公司" });
    await logCall(t.sql, { companyId: id, outcome: "需要跟進", calledAt: hk("2026-05-01T10:00"), carriers: [
      { provider: "CMHK", contractEnd: "2026-12-13" }, { provider: "CSL", contractEnd: "2027-12-31" }] });
    let rows = (await renewalsDue(t.sql, "2026-10-14")).filter((x) => x.company_id === id);
    expect(rows.map((x) => [x.provider, x.contract_end, x.stage])).toEqual([["CMHK", "2026-12-13", 1]]);

    const id2 = await makeCompany(t.sql, { name_zh: "兩個都近" });
    await logCall(t.sql, { companyId: id2, outcome: "需要跟進", calledAt: hk("2026-05-01T10:00"), carriers: [
      { provider: "CMHK", contractEnd: "2026-11-30", price: "130" }, { provider: "CSL", contractEnd: "2026-12-20", price: "150" }] });
    rows = (await renewalsDue(t.sql, "2026-10-14")).filter((x) => x.company_id === id2);
    expect(rows.map((x) => [x.provider, x.contract_end, x.price])).toEqual([["CMHK", "2026-11-30", "130"], ["CSL", "2026-12-20", "150"]]);
    await t.sql`insert into public.renewal_dismissals (company_id, contract_end, stage) values (${id2}, '2026-11-30', 1)`;
    rows = (await renewalsDue(t.sql, "2026-10-14")).filter((x) => x.company_id === id2);
    expect(rows.map((x) => x.provider)).toEqual(["CSL"]);
  });
});

describe("migration：舊 D 欄搬落 call_carriers", () => {
  it("有 D 嘅電話變一行（日子原樣）；冇 D 嘅唔開行；舊欄冇咗", async () => {
    const admin = process.env.TEST_DATABASE_URL!;
    const name = `gc_mig_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    const root = connect(admin, { max: 1 });
    await root.unsafe(`create database ${name}`);
    const u = new URL(admin);
    u.pathname = `/${name}`;
    const db = connect(u.toString(), { max: 1 });
    try {
      // 行到上一個 migration 為止
      const dir = mkdtempSync(join(tmpdir(), "gc-mig-"));
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
      const target = "20261016000500_call_carriers.sql";
      for (const f of files.filter((x) => x < target)) cpSync(join(MIGRATIONS_DIR, f), join(dir, f));
      await migrate(db, dir, () => {});
      const [co] = await db<{ id: string }[]>`insert into public.companies (name_zh) values ('舊資料公司') returning id`;
      await db`insert into public.calls (company_id, attempt_no, outcome, got_d, d_contract_end, d_provider, d_price, d_plan)
               values (${co!.id}, 1, '需要跟進', true, '2027-03-31', 'CSL', '$198 × 10', ' ')`;
      await db`insert into public.calls (company_id, attempt_no, outcome, got_d, d_provider)
               values (${co!.id}, 2, '需要跟進', false, '  ')`;
      cpSync(join(MIGRATIONS_DIR, target), join(dir, target));
      await migrate(db, dir, () => {});
      const rows = await db`select provider, contract_end::text as contract_end, price, plan from public.call_carriers`;
      expect(rows).toEqual([{ provider: "CSL", contract_end: "2027-03-31", price: "$198 × 10", plan: null }]);
      const cols = await db`select column_name from information_schema.columns
                             where table_name = 'calls' and column_name like 'd\\_%'`;
      expect(cols).toEqual([]);
      const [o] = await db`select d_contract_end::text as e, d_provider, d_lines from public.company_overview where id = ${co!.id}`;
      expect(o).toMatchObject({ e: "2027-03-31", d_provider: "CSL" });
    } finally {
      await db.end();
      await root.unsafe(`drop database if exists ${name} with (force)`);
      await root.end();
    }
  });
});
