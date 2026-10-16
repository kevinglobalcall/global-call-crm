/**
 * 記電話（transaction）—— 對真 Postgres（真 migration）。
 */
import { describe, expect, it } from "vitest";
import { deleteCall, logCall, updateCall } from "../src/domain/calls.js";
import { makeCompany, useTestDb } from "./helpers/db.js";

const t = useTestDb();
const openTasks = (id: string) =>
  t.sql<{ kind: string; status: string }[]>`select kind, status from public.tasks where company_id = ${id} order by created_at`;

describe("記電話", () => {
  it("第幾次自動 ＝ 打過幾多次 +1；手改照用", async () => {
    const id = await makeCompany(t.sql);
    expect((await logCall(t.sql, { companyId: id, outcome: "沒有人接" })).call.attempt_no).toBe(1);
    expect((await logCall(t.sql, { companyId: id, outcome: "沒有人接" })).call.attempt_no).toBe(2);
    expect((await logCall(t.sql, { companyId: id, outcome: "沒有人接", attemptNo: 7 })).call.attempt_no).toBe(7);
  });

  it("幾點鐘再打 → 開回撥（帶時間）、未打變跟進中、接通", async () => {
    const id = await makeCompany(t.sql);
    const r = await logCall(t.sql, { companyId: id, outcome: "幾點鐘再打", callbackAt: new Date("2026-10-20T07:00:00Z") });
    expect(r).toMatchObject({ statusBefore: "未打", statusAfter: "跟進中", connected: true, closedTasks: 0 });
    expect(r.task).toMatchObject({ kind: "回撥" });
    expect(r.task!.due_at!.toISOString()).toBe("2026-10-20T07:00:00.000Z");
  });

  it("❗再打一次自動收舊嘅回撥／跟進／寄電郵（唔收到期提醒）", async () => {
    const id = await makeCompany(t.sql);
    const first = await logCall(t.sql, { companyId: id, outcome: "稍後再撥打" });
    // 第二次：收咗第一次個回撥，開寄電郵
    const second = await logCall(t.sql, { companyId: id, outcome: "只接受電郵" });
    expect(second.closedTasks).toBe(1);
    await t.sql`insert into public.tasks (company_id, kind, note) values (${id}, '跟進', '手動開嘅跟進')`;
    await t.sql`insert into public.tasks (company_id, kind, note) values (${id}, '到期提醒', '合約 3 月到期')`;
    const r = await logCall(t.sql, { companyId: id, outcome: "不需要" });
    expect(r.closedTasks).toBe(2); // 寄電郵 ＋ 跟進
    const rows = await openTasks(id);
    expect(rows.filter((x) => x.status === "待辦").map((x) => x.kind)).toEqual(["到期提醒"]);
    const [closed] = await t.sql`select closed_by_call_id from public.tasks where company_id = ${id} and kind = '回撥'`;
    expect(closed!.closed_by_call_id).toBe(second.call.id);
    expect(first.task!.kind).toBe("回撥");
  });

  it("不需要 → 公司標不需要；之後沒有人接都唔會變返跟進中", async () => {
    const id = await makeCompany(t.sql);
    await logCall(t.sql, { companyId: id, outcome: "不需要" });
    const r = await logCall(t.sql, { companyId: id, outcome: "沒有人接" });
    expect(r.statusAfter).toBe("不需要");
    expect(r.connected).toBe(false);
  });

  it("其他人跟進 → 記低同事名落公司，唔出冷電名單", async () => {
    const id = await makeCompany(t.sql);
    await logCall(t.sql, { companyId: id, outcome: "其他人跟進", otherFollower: "阿明" });
    const [c] = await t.sql`select status, followed_by from public.companies where id = ${id}`;
    expect(c).toMatchObject({ status: "其他人跟進", followed_by: "阿明" });
  });

  it("填咗任何 D 資料就自動算 D；R 照剔", async () => {
    const id = await makeCompany(t.sql);
    const r = await logCall(t.sql, { companyId: id, outcome: "需要跟進", reachedR: true, dProvider: "CSL" });
    expect(r.call).toMatchObject({ reached_r: true, got_d: true });
    expect(r.call.carriers!.map((x) => x.provider)).toEqual(["CSL"]);
    const r2 = await logCall(t.sql, { companyId: id, outcome: "需要跟進" });
    expect(r2.call.got_d).toBe(false);
  });

  it("❗合約到期日原樣存（香港 3/31 唔會變 3/30）", async () => {
    const id = await makeCompany(t.sql);
    const r = await logCall(t.sql, { companyId: id, outcome: "需要跟進", dContractEnd: "2027-03-31" });
    expect(r.call.carriers![0]!.contract_end).toBe("2027-03-31");
    const [row] = await t.sql`select contract_end::text as d from public.call_carriers where call_id = ${r.call.id}`;
    expect(row!.d).toBe("2027-03-31");
  });

  it("JS 先擋：幾點鐘再打冇時間、亂寫日子 → 乜都冇寫", async () => {
    const id = await makeCompany(t.sql);
    await expect(logCall(t.sql, { companyId: id, outcome: "幾點鐘再打" })).rejects.toThrow(/一定要揀時間/);
    await expect(logCall(t.sql, { companyId: id, outcome: "需要跟進", dContractEnd: "2027-02-30" })).rejects.toThrow(/冇呢日/);
    expect((await t.sql`select 1 from public.calls where company_id = ${id}`).length).toBe(0);
  });

  it("❗中途 DB 出事（開新待辦嗰步）→ 成單 rollback：call 冇落地、舊回撥冇被收", async () => {
    const id = await makeCompany(t.sql);
    const old = await logCall(t.sql, {
      companyId: id, outcome: "幾點鐘再打", callbackAt: new Date("2026-10-20T07:00:00Z"),
    });
    // 整個 trigger，等到「開新待辦」嗰步先爆 —— 嗰陣 call 已經寫咗、舊回撥已經收咗
    await t.sql.unsafe(`
      create function public.boom() returns trigger language plpgsql as $$
      begin raise exception '測試：開待辦嗰步爆'; end $$;
      create trigger boom before insert on public.tasks for each row execute function public.boom();`);
    try {
      await expect(logCall(t.sql, { companyId: id, outcome: "需要跟進" })).rejects.toThrow(/開待辦嗰步爆/);
    } finally {
      await t.sql.unsafe(`drop trigger boom on public.tasks; drop function public.boom();`);
    }
    const calls = await t.sql`select id from public.calls where company_id = ${id}`;
    const tasks = await t.sql`select status from public.tasks where company_id = ${id}`;
    expect(calls.map((c) => c.id)).toEqual([old.call.id]);   // 第二筆冇落地
    expect(tasks).toEqual([{ status: "待辦" }]);              // 舊回撥冇被收
  });

  it("❗DB 收晒網頁畀撳嘅每一粒結果（包括第九粒「留聯絡」）—— 唔係撳咗爆 DB 錯", async () => {
    const { OUTCOMES } = await import("../src/domain/outcomes.js");
    for (const o of OUTCOMES) {
      const id = await makeCompany(t.sql);
      const r = await logCall(t.sql, {
        companyId: id, outcome: o,
        ...(o === "幾點鐘再打" ? { callbackAt: new Date("2026-10-20T07:00:00Z") } : {}),
        ...(o === "其他人跟進" ? { otherFollower: "阿明" } : {}),
      });
      expect([o, r.call.outcome]).toEqual([o, o]);
    }
    const id = await makeCompany(t.sql);
    const r = await logCall(t.sql, { companyId: id, outcome: "留聯絡", content: "留咗電話畀前台" });
    expect(r).toMatchObject({ statusAfter: "跟進中", connected: true, task: null });
  });

  it("每次記錄都入 audit_log", async () => {
    const id = await makeCompany(t.sql);
    const r = await logCall(t.sql, { companyId: id, outcome: "不需要" }, "mcp");
    const [a] = await t.sql`select actor, action, record_id from public.audit_log where record_id = ${r.call.id}`;
    expect(a).toMatchObject({ actor: "mcp", action: "log_call" });
  });

  it("搵唔到公司 → 錯，乜都冇寫", async () => {
    await expect(logCall(t.sql, { companyId: "00000000-0000-0000-0000-000000000000", outcome: "不需要" }))
      .rejects.toThrow(/搵唔到呢間公司/);
  });
});

describe("改／刪電話記錄", () => {
  it("改內容同 D；結果改唔到", async () => {
    const id = await makeCompany(t.sql);
    const r = await logCall(t.sql, { companyId: id, outcome: "需要跟進", content: "舊" });
    const u = await updateCall(t.sql, r.call.id, { content: "新內容", carriers: [{ provider: "CSL", price: "$198 × 10" }] });
    expect(u).toMatchObject({ content: "新內容", got_d: true });
    expect(u.carriers!.map((x) => [x.provider, x.price])).toEqual([["CSL", "$198 × 10"]]);
    await expect(updateCall(t.sql, r.call.id, { outcome: "不需要" } as never)).rejects.toThrow(/結果改唔到/);
    const [a] = await t.sql`select action from public.audit_log where record_id = ${r.call.id} and action = 'update_call'`;
    expect(a).toBeTruthy();
  });

  it("❗刪一次記錄：佢開嘅待辦一齊刪，佢收咗嘅舊待辦返嚟", async () => {
    const id = await makeCompany(t.sql);
    await logCall(t.sql, { companyId: id, outcome: "稍後再撥打" });
    const second = await logCall(t.sql, { companyId: id, outcome: "需要跟進" });
    expect((await openTasks(id)).map((x) => `${x.kind}:${x.status}`)).toEqual(["回撥:完成", "跟進:待辦"]);
    const d = await deleteCall(t.sql, second.call.id);
    expect(d).toEqual({ reopened: 1, removedTasks: 1 });
    expect((await openTasks(id)).map((x) => `${x.kind}:${x.status}`)).toEqual(["回撥:待辦"]);
    expect((await t.sql`select 1 from public.calls where id = ${second.call.id}`).length).toBe(0);
  });
});
