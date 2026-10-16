/**
 * 撳個數睇係邊幾間（Kevin 2026-10-16「要能夠點開顯示什麼公司」）——
 * ❗最緊要嘅一條：detail 行數 ＝ 嗰格個數。對唔埋 Kevin 即刻唔信個數。
 */
import { describe, expect, it } from "vitest";
import { cancelAppointment, completeAppointment, createAppointment } from "../src/domain/appointments.js";
import { logCall } from "../src/domain/calls.js";
import { dailyStats, DETAIL_KINDS, periodTotals, statsDetail } from "../src/domain/stats.js";
import { makeCompany, useTestDb } from "./helpers/db.js";

const t = useTestDb();
const hk = (s: string) => new Date(`${s}+08:00`);

describe("每日數 → 撳入去睇係邊幾間", () => {
  it("六種數，逐日同成段時間，行數都等如個數；R／D 按間數（同一間兩次 R 都係一行）", async () => {
    const a = await makeCompany(t.sql), b = await makeCompany(t.sql), c = await makeCompany(t.sql);
    // 2030-01-07：a 兩次 R（第二次有 D）、b 冇人接、c 不需要；香港凌晨 00:30 都要計返當日（唔係 UTC 前一日）
    await logCall(t.sql, { companyId: a, outcome: "需要跟進", reachedR: true, calledAt: hk("2030-01-07T00:30") });
    await logCall(t.sql, { companyId: a, outcome: "需要跟進", reachedR: true, dProvider: "CSL", calledAt: hk("2030-01-07T15:00") });
    await logCall(t.sql, { companyId: b, outcome: "沒有人接", calledAt: hk("2030-01-07T10:00") });
    await logCall(t.sql, { companyId: c, outcome: "不需要", calledAt: hk("2030-01-07T11:00") });
    // 2030-01-08：b 再打 R
    await logCall(t.sql, { companyId: b, outcome: "需要跟進", reachedR: true, calledAt: hk("2030-01-08T09:00") });
    // 約：1/7 約咗兩個（一個之後取消），1/8 見咗一個
    const ap1 = await createAppointment(t.sql, { companyId: a, startsAt: hk("2030-01-08T15:00"), createdAt: hk("2030-01-07T16:00"), purpose: "介紹 SME Bundle" });
    const ap2 = await createAppointment(t.sql, { companyId: b, startsAt: hk("2030-01-09T15:00"), createdAt: hk("2030-01-07T17:00") });
    await cancelAppointment(t.sql, ap2.appointment.id, "客改主意");
    await completeAppointment(t.sql, ap1.appointment.id, { meetingNotes: "老闆有興趣" });

    for (const day of ["2030-01-07", "2030-01-08"]) {
      const [s] = await dailyStats(t.sql, day, day);
      for (const k of DETAIL_KINDS) {
        const rows = await statsDetail(t.sql, k, day, day);
        expect([day, k, rows.length]).toEqual([day, k, s![k === "r" ? "r" : k === "d" ? "d" : k]]);
      }
    }
    const tot = await periodTotals(t.sql, "2030-01-07", "2030-01-08");
    for (const k of DETAIL_KINDS) {
      expect([k, (await statsDetail(t.sql, k, "2030-01-07", "2030-01-08")).length]).toEqual([k, tot[k]]);
    }
    // R 兩日加埋：a、b 兩間（唔係三次）
    expect(tot.r).toBe(2);

    const r = await statsDetail(t.sql, "r", "2030-01-07", "2030-01-07");
    expect(r).toEqual([expect.objectContaining({ company_id: a, tag: "需要跟進", got_d: true, extra: "CSL" })]); // 攞最後嗰次
    const met = await statsDetail(t.sql, "met", "2030-01-08", "2030-01-08");
    expect(met).toEqual([expect.objectContaining({ company_id: a, tag: "已見", text: "老闆有興趣" })]);
    const connected = await statsDetail(t.sql, "connected", "2030-01-07", "2030-01-07");
    expect(connected.map((x) => x.tag)).toEqual(["需要跟進", "不需要", "需要跟進"]); // 冇「沒有人接」，新嘅行先
  });

  it("日子亂寫／倒轉 → 錯", async () => {
    await expect(statsDetail(t.sql, "calls", "2030-02-30", "2030-03-01")).rejects.toThrow();
    await expect(statsDetail(t.sql, "calls", "2030-03-02", "2030-03-01")).rejects.toThrow(/開始日喺完結日之後/);
  });
});
