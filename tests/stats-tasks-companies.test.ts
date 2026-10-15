/**
 * 每日數、今日回撥、公司清單 —— 對真 Postgres。
 * ❗日子一律釘死（today 參數），唔跟真時鐘。
 */
import { describe, expect, it } from "vitest";
import { logCall } from "../src/domain/calls.js";
import { dailyStats, periodTotals, todayStats } from "../src/domain/stats.js";
import { callbacksDue, cancelTask, completeTask, rescheduleTask } from "../src/domain/tasks.js";
import {
  createCompany, findDuplicates, getCompany, listCompanies, phonesFromText, emailsFromText, updateCompany,
} from "../src/domain/companies.js";
import { makeCompany, useTestDb } from "./helpers/db.js";

const t = useTestDb();
const hk = (s: string) => new Date(`${s}+08:00`);

describe("冷電名單排序", () => {
  it("冷電名單預設未打過行先（唔係最近打行先）", async () => {
    const called = await makeCompany(t.sql, { name_zh: "排序測試已打", industry: "排序測試" });
    await logCall(t.sql, { companyId: called, outcome: "沒有人接", calledAt: hk("2024-02-02T09:00") });
    const fresh = await makeCompany(t.sql, { name_zh: "排序測試未打", industry: "排序測試" });
    const r = await listCompanies(t.sql, { cold: true, industry: "排序測試" }, 10, 0);
    expect(r.rows.map((x) => x.id)).toEqual([fresh, called]);
    const recent = await listCompanies(t.sql, { industry: "排序測試" }, 10, 0);
    expect(recent.rows[0]!.id).toBe(called);
  });
});

describe("每日數", () => {
  it("通數、接通、R、D —— R／D 按間數，同一間一日兩次都係 1", async () => {
    const a = await makeCompany(t.sql, { name_zh: "甲公司" });
    const b = await makeCompany(t.sql, { name_zh: "乙公司" });
    await logCall(t.sql, { companyId: a, outcome: "沒有人接", calledAt: hk("2026-10-14T10:00") });
    await logCall(t.sql, { companyId: a, outcome: "需要跟進", reachedR: true, calledAt: hk("2026-10-14T11:00") });
    await logCall(t.sql, {
      companyId: a, outcome: "需要跟進", reachedR: true, dContractEnd: "2027-03-31", calledAt: hk("2026-10-14T15:00"),
    });
    await logCall(t.sql, { companyId: b, outcome: "不需要", calledAt: hk("2026-10-14T16:00") });
    expect(await todayStats(t.sql, "2026-10-14")).toEqual({ day: "2026-10-14", calls: 4, connected: 3, r: 1, d: 1, booked: 0, met: 0 });
  });

  it("❗香港凌晨 00:30 嘅電話算香港嗰日，唔係 UTC 前一日", async () => {
    const a = await makeCompany(t.sql, { name_zh: "夜更公司" });
    await logCall(t.sql, { companyId: a, outcome: "不需要", calledAt: hk("2026-11-02T00:30") });
    const [day] = await dailyStats(t.sql, "2026-11-02", "2026-11-02");
    expect(day!.calls).toBe(1);
    const [prev] = await dailyStats(t.sql, "2026-11-01", "2026-11-01");
    expect(prev!.calls).toBe(0);
  });

  it("冇打電話嗰日都出一行 0（分得到「冇打」定「冇記錄」）", async () => {
    const rows = await dailyStats(t.sql, "2030-01-01", "2030-01-03");
    expect(rows.map((r) => r.day)).toEqual(["2030-01-03", "2030-01-02", "2030-01-01"]);
    for (const r of rows) expect(r).toMatchObject({ calls: 0, connected: 0, r: 0, d: 0 });
  });

  it("一段時間總數：R 按間數唔重複", async () => {
    const a = await makeCompany(t.sql, { name_zh: "五月公司" });
    await logCall(t.sql, { companyId: a, outcome: "需要跟進", reachedR: true, calledAt: hk("2028-05-03T10:00") });
    await logCall(t.sql, { companyId: a, outcome: "稍後再撥打", reachedR: true, calledAt: hk("2028-05-20T10:00") });
    expect(await periodTotals(t.sql, "2028-05-01", "2028-05-31")).toEqual({ calls: 2, connected: 2, r: 1, d: 0, booked: 0, met: 0 });
  });

  it("開始日喺完結日之後 → 錯；超過 400 日 → 錯", async () => {
    await expect(dailyStats(t.sql, "2026-10-14", "2026-10-01")).rejects.toThrow(/開始日喺完結日之後/);
    await expect(dailyStats(t.sql, "2020-01-01", "2026-10-01")).rejects.toThrow(/400 日/);
  });
});

describe("今日回撥", () => {
  it("過咗期 → 今日（按鐘數）→ 冇時間排最尾；明日嘅唔出；傳真唔出喺電話", async () => {
    const a = await makeCompany(t.sql, { name_zh: "回撥甲", phones: ["23456789"] });
    await t.sql`insert into public.company_phones (company_id, phone, label, sort) values (${a}, '23456790', '傳真', 1)`;
    const b = await makeCompany(t.sql, { name_zh: "回撥乙" });
    const c = await makeCompany(t.sql, { name_zh: "回撥丙" });
    const d = await makeCompany(t.sql, { name_zh: "回撥丁" });
    await logCall(t.sql, { companyId: a, outcome: "幾點鐘再打", callbackAt: hk("2029-03-05T16:00"), calledAt: hk("2029-03-01T10:00") });
    await logCall(t.sql, { companyId: b, outcome: "幾點鐘再打", callbackAt: hk("2029-03-04T10:00"), calledAt: hk("2029-03-01T10:00") });
    await logCall(t.sql, { companyId: c, outcome: "稍後再撥打", calledAt: hk("2029-03-01T10:00") });
    await logCall(t.sql, { companyId: d, outcome: "幾點鐘再打", callbackAt: hk("2029-03-06T09:00"), calledAt: hk("2029-03-01T10:00") });
    const due = (await callbacksDue(t.sql, "2029-03-05")).filter((x) => x.company_name.startsWith("回撥"));
    expect(due.map((x) => [x.company_name, x.overdue])).toEqual([["回撥乙", true], ["回撥甲", false], ["回撥丙", false]]);
    expect(due.find((x) => x.company_name === "回撥甲")!.phones).toBe("23456789");
  });

  it("完成、取消、改時間；做咗嘅唔可以再做", async () => {
    const a = await makeCompany(t.sql, { name_zh: "待辦測試" });
    const r = await logCall(t.sql, { companyId: a, outcome: "稍後再撥打" });
    await rescheduleTask(t.sql, r.task!.id, hk("2029-04-01T11:00"));
    const [x] = await t.sql`select due_at from public.tasks where id = ${r.task!.id}`;
    expect((x!.due_at as Date).toISOString()).toBe("2029-04-01T03:00:00.000Z");
    await completeTask(t.sql, r.task!.id, "打咗");
    await expect(completeTask(t.sql, r.task!.id)).rejects.toThrow(/已經「完成」/);
    const r2 = await logCall(t.sql, { companyId: a, outcome: "需要跟進" });
    await cancelTask(t.sql, r2.task!.id);
    const rows = await t.sql`select status from public.tasks where company_id = ${a} order by created_at`;
    expect(rows.map((y) => y.status)).toEqual(["完成", "取消"]);
  });
});

describe("公司清單", () => {
  it("搜尋無視空格；電話打 4 位以上都搵到；總數連 R／D", async () => {
    const a = await makeCompany(t.sql, { name_zh: "清單大發物流", name_en: "Tai Fat Logistics", industry: "清單測試", phones: ["27771888"] });
    await makeCompany(t.sql, { name_zh: "清單小發工程", industry: "清單測試" });
    await logCall(t.sql, { companyId: a, outcome: "需要跟進", reachedR: true, dProvider: "CSL", calledAt: hk("2029-05-01T10:00") });
    expect((await listCompanies(t.sql, { q: "清單 大發" })).rows.map((r) => r.id)).toEqual([a]);
    expect((await listCompanies(t.sql, { q: "taifat" })).rows.map((r) => r.id)).toEqual([a]);
    expect((await listCompanies(t.sql, { q: "7771 888" })).rows.map((r) => r.id)).toEqual([a]);
    const all = await listCompanies(t.sql, { industry: "清單測試" });
    expect(all).toMatchObject({ total: 2, totalR: 1, totalD: 1 });
    expect((await listCompanies(t.sql, { industry: "清單測試", r: "no" })).total).toBe(1);
  });

  it("冷電名單：唔出不需要、其他人跟進、有同事跟開嘅", async () => {
    const ok = await makeCompany(t.sql, { name_zh: "冷電可以打", industry: "冷電測試" });
    await makeCompany(t.sql, { name_zh: "冷電不需要", industry: "冷電測試", status: "不需要" });
    const f = await makeCompany(t.sql, { name_zh: "冷電同事跟", industry: "冷電測試", status: "跟進中" });
    await t.sql`update public.companies set followed_by = '阿明' where id = ${f}`;
    const r = await listCompanies(t.sql, { cold: true, industry: "冷電測試" });
    expect(r.rows.map((x) => x.id)).toEqual([ok]);
  });

  it("合約到期日篩選（D 資料）", async () => {
    const a = await makeCompany(t.sql, { name_zh: "到期早", industry: "到期測試" });
    const b = await makeCompany(t.sql, { name_zh: "到期遲", industry: "到期測試" });
    await logCall(t.sql, { companyId: a, outcome: "需要跟進", dContractEnd: "2027-01-31", calledAt: hk("2029-06-01T10:00") });
    await logCall(t.sql, { companyId: b, outcome: "需要跟進", dContractEnd: "2027-09-30", calledAt: hk("2029-06-01T10:00") });
    const r = await listCompanies(t.sql, { industry: "到期測試", contractEndBy: "2027-03-31" });
    expect(r.rows.map((x) => x.id)).toEqual([a]);
  });

  it("開新：電話或者名撞咗就唔開（回撞咗邊間）；force 先開", async () => {
    const r = await createCompany(t.sql, { name_zh: "查重甲有限公司", phones: [{ phone: "26668888" }] });
    expect(r.created).toBeTruthy();
    const dupPhone = await createCompany(t.sql, { name_zh: "查重乙", phones: [{ phone: "26668888" }] });
    expect(dupPhone.created).toBeNull();
    expect(dupPhone.duplicates[0]!.why).toMatch(/電話 26668888/);
    const dupName = await findDuplicates(t.sql, { name_zh: "查重甲" });
    expect(dupName.map((d) => d.why)).toEqual(["公司名一樣"]);
    const forced = await createCompany(t.sql, { name_zh: "查重乙", phones: [{ phone: "26668888" }] }, { force: true });
    expect(forced.created).toBeTruthy();
  });

  it("改公司：電話成格換；兩個名都清唔得；getCompany 用編號都搵到", async () => {
    const r = await createCompany(t.sql, { name_zh: "改資料公司", phones: [{ phone: "23331111" }] });
    const id = r.created!.id;
    await updateCompany(t.sql, id, { phones: phonesFromText("2333 2222 / 傳真 2333 2223").ok, emails: emailsFromText("a@b.hk").ok });
    const c = (await getCompany(t.sql, r.created!.code))!;
    expect(c.phones.map((p) => [p.phone, p.label])).toEqual([["23332222", "總機"], ["23332223", "傳真"]]);
    expect(c.emails.map((e) => e.email)).toEqual(["a@b.hk"]);
    await expect(updateCompany(t.sql, id, { name_zh: "" })).rejects.toThrow(/兩個名都清晒/);
  });

  it("電郵：mailto:、URL-encode、大細楷；亂嘢講返出嚟", () => {
    expect(emailsFromText("mailto:Info%40ABC.hk; sales@abc.hk").ok).toEqual(["info@abc.hk", "sales@abc.hk"]);
    expect(emailsFromText("唔係電郵").bad).toEqual(["唔係電郵"]);
    expect(phonesFromText("2345 6789 / 1234").bad.length).toBe(1);
  });
});
