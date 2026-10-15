/**
 * 續約提醒 —— 計出嚟嘅，today 釘死 2026-10-15（四）。
 *   第一段：到期 ≤ +90 日，而且由（到期 − 90）之後冇打過
 *   第二段：到期 ≤ +30 日，而且由（到期 − 30）之後冇打過
 */
import { describe, expect, it } from "vitest";
import { logCall } from "../src/domain/calls.js";
import { dismissRenewal, renewalsDue } from "../src/domain/renewals.js";
import { makeCompany, useTestDb } from "./helpers/db.js";

const t = useTestDb();
const hk = (s: string) => new Date(`${s}+08:00`);
const TODAY = "2026-10-15";

/** 開一間公司，喺 calledAt 嗰次電話攞到 D（合約到期日）。 */
async function withD(name: string, contractEnd: string, calledAt: string, status?: string) {
  const id = await makeCompany(t.sql, { name_zh: name, phones: ["21234567"], ...(status ? { status } : {}) });
  await logCall(t.sql, {
    companyId: id, outcome: "需要跟進", reachedR: true, dContractEnd: contractEnd, dProvider: "CSL",
    dPrice: "$198 × 10", calledAt: hk(calledAt),
  });
  return id;
}

const names = async () => (await renewalsDue(t.sql, TODAY)).map((r) => r.company_name);

describe("續約提醒", () => {
  it("第一段：77 日後到期、個窗開咗之後冇打過 → 出；窗開咗之後打過 → 唔出", async () => {
    await withD("續約甲", "2026-12-31", "2026-06-01T10:00");          // 窗由 10/2 開，最後打 6/1
    await withD("續約乙", "2026-12-31", "2026-10-05T10:00");          // 窗開咗之後打過
    const rows = await renewalsDue(t.sql, TODAY);
    const a = rows.find((r) => r.company_name === "續約甲")!;
    expect(a).toMatchObject({ stage: 1, days_left: 77, contract_end: "2026-12-31", provider: "CSL", price: "$198 × 10", source: "D" });
    expect(rows.some((r) => r.company_name === "續約乙")).toBe(false);
  });

  it("第二段：26 日後到期，第二個窗（到期前 30 日）開咗之後冇打過 → 出 stage 2", async () => {
    await withD("續約丙", "2026-11-10", "2026-10-05T10:00");          // 第二個窗由 10/11 開
    const c = (await renewalsDue(t.sql, TODAY)).find((r) => r.company_name === "續約丙")!;
    expect(c).toMatchObject({ stage: 2, days_left: 26 });
  });

  it("超過 90 日唔出；過咗期 60 日內照出，再耐就唔出", async () => {
    await withD("續約遠", "2027-03-01", "2026-06-01T10:00");
    await withD("過期近", "2026-09-01", "2026-05-01T10:00");
    await withD("過期遠", "2026-08-01", "2026-04-01T10:00");
    const rows = await renewalsDue(t.sql, TODAY);
    expect(rows.some((r) => r.company_name === "續約遠")).toBe(false);
    expect(rows.find((r) => r.company_name === "過期近")).toMatchObject({ stage: 2, days_left: -44 });
    expect(rows.some((r) => r.company_name === "過期遠")).toBe(false);
  });

  it("其他人跟進、已結業唔出；不需要照出（合約到期正正係再打嘅時候）", async () => {
    const other = await withD("同事單", "2026-12-20", "2026-06-01T10:00");
    await t.sql`update public.companies set status = '其他人跟進', followed_by = '阿明' where id = ${other}`;
    const closed = await withD("執咗", "2026-12-20", "2026-06-01T10:00");
    await t.sql`update public.companies set status = '已結業' where id = ${closed}`;
    const no = await withD("話不需要", "2026-12-20", "2026-06-01T10:00");
    await t.sql`update public.companies set status = '不需要' where id = ${no}`;
    const n = await names();
    expect(n).not.toContain("同事單");
    expect(n).not.toContain("執咗");
    expect(n).toContain("話不需要");
  });

  it("❗打一次電話就自動收（唔使另外撳）", async () => {
    const id = await withD("打咗就收", "2026-12-25", "2026-06-01T10:00");
    expect(await names()).toContain("打咗就收");
    await logCall(t.sql, { companyId: id, outcome: "沒有人接", calledAt: hk("2026-10-15T09:00") });
    expect(await names()).not.toContain("打咗就收");
  });

  it("❗收埋鎖住到期日：之後報返新到期日會再出", async () => {
    const id = await withD("收埋測試", "2026-12-30", "2026-06-01T10:00");
    await dismissRenewal(t.sql, id, "2026-12-30", 1, "test");
    expect(await names()).not.toContain("收埋測試");
    // 9/20 再打，佢講新到期日 12/28（窗由 9/29 開，9/20 喺窗之前）
    await logCall(t.sql, { companyId: id, outcome: "需要跟進", dContractEnd: "2026-12-28", calledAt: hk("2026-09-20T10:00") });
    const r = (await renewalsDue(t.sql, TODAY)).find((x) => x.company_name === "收埋測試");
    expect(r).toMatchObject({ contract_end: "2026-12-28", stage: 1 });
  });

  it("收咗第一段唔會收埋第二段：28 日後到期照出 stage 2，收埋第二段先唔出", async () => {
    const id = await withD("兩段測試", "2026-11-12", "2026-06-01T10:00");
    await dismissRenewal(t.sql, id, "2026-11-12", 1);
    expect((await renewalsDue(t.sql, TODAY)).find((x) => x.company_name === "兩段測試")).toMatchObject({ stage: 2 });
    await dismissRenewal(t.sql, id, "2026-11-12", 2);
    expect(await names()).not.toContain("兩段測試");
  });

  it("❗個窗由香港 00:00 起計：窗開嗰日凌晨 00:30 打過算收；前一晚 23:30 打唔算", async () => {
    // 到期 2026-12-31 → 窗由 2026-10-02（香港）開
    await withD("凌晨窗內", "2026-12-31", "2026-10-02T00:30");
    await withD("凌晨窗外", "2026-12-31", "2026-10-01T23:30");
    const n = await names();
    expect(n).not.toContain("凌晨窗內");
    expect(n).toContain("凌晨窗外");
  });

  it("設定改咗（60／20）即刻跟；設定亂寫就報錯，唔靜靜雞用預設", async () => {
    await withD("設定測試", "2026-12-24", "2026-06-01T10:00"); // 70 日後
    expect(await names()).toContain("設定測試");
    await t.sql`update public.settings set value = '{"first": 60, "second": 20}' where key = 'renewal'`;
    try {
      expect(await names()).not.toContain("設定測試");
      await t.sql`update public.settings set value = '{"first": 10, "second": 30}' where key = 'renewal'`;
      await expect(renewalsDue(t.sql, TODAY)).rejects.toThrow(/設定唔啱/);
    } finally {
      await t.sql`update public.settings set value = '{"first": 90, "second": 30}' where key = 'renewal'`;
    }
  });
});
