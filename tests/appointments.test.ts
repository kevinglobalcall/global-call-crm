/**
 * 預約見面 —— 對真 Postgres（真 migration）。時間一律釘死，唔跟真時鐘。
 */
import { describe, expect, it } from "vitest";
import {
  cancelAppointment, completeAppointment, createAppointment, listAppointments, noShowAppointment,
  rescheduleAppointment, updateAppointment,
} from "../src/domain/appointments.js";
import { dailyStats, periodTotals } from "../src/domain/stats.js";
import { callbacksDue } from "../src/domain/tasks.js";
import { makeCompany, useTestDb } from "./helpers/db.js";

const t = useTestDb();
const hk = (s: string) => new Date(`${s}+08:00`);

async function companyWithAddress(name: string, address: string | null = "觀塘道 1 號 10 樓") {
  const id = await makeCompany(t.sql, { name_zh: name, phones: ["23456789"] });
  await t.sql`update public.companies set address_zh = ${address} where id = ${id}`;
  return id;
}

describe("約見面", () => {
  it("開約連新聯絡人：地址預填公司地址、未打變跟進中、時間表出齊公司名／聯絡人／地址", async () => {
    const id = await companyWithAddress("約見測試甲");
    const r = await createAppointment(t.sql, {
      companyId: id, startsAt: hk("2026-10-20T15:00"), purpose: "介紹 SME Bundle",
      newContact: { name: "陳生", title: "IT 經理", phone: "9123 4567" },
    }, "test");
    expect(r.appointment).toMatchObject({
      company_name: "約見測試甲", contact_name: "陳生", contact_title: "IT 經理", contact_phone: "9123 4567",
      address: "觀塘道 1 號 10 樓", purpose: "介紹 SME Bundle", status: "已約", company_phones: "23456789",
    });
    expect(r.appointment.ends_at!.toISOString()).toBe("2026-10-20T08:00:00.000Z"); // 預設一個鐘
    const [k] = await t.sql`select company_id from public.contacts where id = ${r.newContactId}`;
    expect(k!.company_id).toBe(id);
    const [c] = await t.sql`select status from public.companies where id = ${id}`;
    expect(c!.status).toBe("跟進中");
    const [a] = await t.sql`select actor from public.audit_log where action = 'create_appointment' and record_id = ${r.appointment.id}`;
    expect(a!.actor).toBe("test");
  });

  it("地址畀 null 就唔填；畀咗就用畀嗰個（見面地點未必係公司）", async () => {
    const id = await companyWithAddress("約見測試地址");
    const a = await createAppointment(t.sql, { companyId: id, startsAt: hk("2026-10-21T10:00"), address: null });
    expect(a.appointment.address).toBeNull();
    const b = await createAppointment(t.sql, { companyId: id, startsAt: hk("2026-10-22T10:00"), address: "將軍澳地盤寫字樓" });
    expect(b.appointment.address).toBe("將軍澳地盤寫字樓");
  });

  it("聯絡人唔係呢間公司嘅 → 拒絕，乜都冇寫", async () => {
    const id = await companyWithAddress("約見測試乙");
    const other = await makeCompany(t.sql, { name_zh: "隔籬公司" });
    const [k] = await t.sql`insert into public.contacts (company_id, name) values (${other}, '隔籬人') returning id`;
    await expect(createAppointment(t.sql, { companyId: id, startsAt: hk("2026-10-20T15:00"), contactId: k!.id }))
      .rejects.toThrow(/唔係呢間公司/);
    expect((await t.sql`select 1 from public.appointments where company_id = ${id}`).length).toBe(0);
  });

  it("❗中途出事（寫約嗰步爆）→ 新聯絡人都唔會留低", async () => {
    const id = await companyWithAddress("約見測試回滾");
    await t.sql.unsafe(`
      create function public.boom_appt() returns trigger language plpgsql as $$
      begin raise exception '測試：寫約嗰步爆'; end $$;
      create trigger boom_appt before insert on public.appointments for each row execute function public.boom_appt();`);
    try {
      await expect(createAppointment(t.sql, {
        companyId: id, startsAt: hk("2026-10-20T15:00"), newContact: { name: "回滾先生" },
      })).rejects.toThrow(/寫約嗰步爆/);
    } finally {
      await t.sql.unsafe(`drop trigger boom_appt on public.appointments; drop function public.boom_appt();`);
    }
    expect((await t.sql`select 1 from public.contacts where name = '回滾先生'`).length).toBe(0);
    const [c] = await t.sql`select status from public.companies where id = ${id}`;
    expect(c!.status).toBe("未打");
  });

  it("撞時段（前後 60 分鐘）提示，唔擋；隔得夠遠就唔提", async () => {
    const a = await companyWithAddress("撞時段甲");
    const b = await companyWithAddress("撞時段乙");
    const c = await companyWithAddress("撞時段丙");
    const first = await createAppointment(t.sql, { companyId: a, startsAt: hk("2027-01-05T10:00") });
    const near = await createAppointment(t.sql, { companyId: b, startsAt: hk("2027-01-05T11:30") });
    expect(near.clashes.map((x) => x.id)).toEqual([first.appointment.id]);
    const far = await createAppointment(t.sql, { companyId: c, startsAt: hk("2027-01-05T14:00") });
    expect(far.clashes).toEqual([]);
  });

  it("改期：長度跟返原本、rescheduled +1、audit 有舊時間；已見嘅改唔到", async () => {
    const id = await companyWithAddress("改期測試");
    const r = await createAppointment(t.sql, { companyId: id, startsAt: hk("2026-11-03T10:00"), minutes: 90 });
    const m = await rescheduleAppointment(t.sql, r.appointment.id, hk("2026-11-04T14:00"));
    expect(m.appointment.starts_at.toISOString()).toBe("2026-11-04T06:00:00.000Z");
    expect(m.appointment.ends_at!.toISOString()).toBe("2026-11-04T07:30:00.000Z");
    expect(m.appointment.rescheduled).toBe(1);
    const [a] = await t.sql`select before from public.audit_log where action = 'reschedule_appointment' and record_id = ${r.appointment.id}`;
    expect((a!.before as { starts_at: string }).starts_at).toBe("2026-11-03T02:00:00.000Z");
    await completeAppointment(t.sql, r.appointment.id, { meetingNotes: "見咗" });
    await expect(rescheduleAppointment(t.sql, r.appointment.id, hk("2026-11-05T10:00"))).rejects.toThrow(/已見/);
  });

  it("冇出現之後可以再約（改期變返已約）", async () => {
    const id = await companyWithAddress("冇出現測試");
    const r = await createAppointment(t.sql, { companyId: id, startsAt: hk("2026-11-06T10:00") });
    await noShowAppointment(t.sql, r.appointment.id, "去到冇人");
    const m = await rescheduleAppointment(t.sql, r.appointment.id, hk("2026-11-09T10:00"));
    expect(m.appointment.status).toBe("已約");
    expect(m.appointment.meeting_notes).toBe("冇出現：去到冇人");
  });

  it("見咗：寫備註；有下一步就開跟進待辦，嗰日出喺今日回撥", async () => {
    const id = await companyWithAddress("見完測試");
    const r = await createAppointment(t.sql, { companyId: id, startsAt: hk("2026-11-10T10:00") });
    const done = await completeAppointment(t.sql, r.appointment.id, {
      meetingNotes: "老闆有興趣 Business Connect，要 3 個報價", nextStepNote: "寄報價", nextStepAt: hk("2026-11-12T11:00"),
    });
    expect(done.appointment).toMatchObject({ status: "已見", meeting_notes: "老闆有興趣 Business Connect，要 3 個報價" });
    const [task] = await t.sql`select kind, note, source_appointment_id from public.tasks where id = ${done.taskId}`;
    expect(task).toMatchObject({ kind: "跟進", note: "寄報價", source_appointment_id: r.appointment.id });
    const due = await callbacksDue(t.sql, "2026-11-12");
    expect(due.some((x) => x.id === done.taskId)).toBe(true);
    // 冇下一步就唔開
    const r2 = await createAppointment(t.sql, { companyId: id, startsAt: hk("2026-11-20T10:00") });
    expect((await completeAppointment(t.sql, r2.appointment.id, { meetingNotes: "傾完" })).taskId).toBeNull();
    await expect(completeAppointment(t.sql, r2.appointment.id, {})).rejects.toThrow(/已見/);
  });

  it("見完之後補備註（任何狀態都改得）", async () => {
    const id = await companyWithAddress("補備註測試");
    const r = await createAppointment(t.sql, { companyId: id, startsAt: hk("2026-11-11T10:00") });
    await completeAppointment(t.sql, r.appointment.id, {});
    const u = await updateAppointment(t.sql, r.appointment.id, { meetingNotes: "後補：用緊 CSL 30 條線" });
    expect(u.meeting_notes).toBe("後補：用緊 CSL 30 條線");
  });

  it("❗香港凌晨 00:30 嘅約落香港嗰日，唔係 UTC 前一日", async () => {
    const id = await companyWithAddress("凌晨約");
    await createAppointment(t.sql, { companyId: id, startsAt: hk("2027-02-02T00:30") });
    expect((await listAppointments(t.sql, "2027-02-02", "2027-02-02")).map((x) => x.company_name)).toContain("凌晨約");
    expect((await listAppointments(t.sql, "2027-02-01", "2027-02-01")).map((x) => x.company_name)).not.toContain("凌晨約");
  });
});

describe("約／見每日數", () => {
  it("約按約嗰日（取消咗唔計）；見按見面嗰日、狀態已見", async () => {
    const id = await companyWithAddress("數測試");
    const a = await createAppointment(t.sql, { companyId: id, startsAt: hk("2028-03-10T10:00") });
    const b = await createAppointment(t.sql, { companyId: id, startsAt: hk("2028-03-12T10:00") });
    const c = await createAppointment(t.sql, { companyId: id, startsAt: hk("2028-03-13T10:00") });
    // created_at 由 DB now() 出，釘返做固定日子先唔跟真時鐘
    await t.sql`update public.appointments set created_at = ${hk("2028-03-01T09:00")} where id in ${t.sql([a.appointment.id, b.appointment.id, c.appointment.id])}`;
    await completeAppointment(t.sql, a.appointment.id, { meetingNotes: "ok" });
    await cancelAppointment(t.sql, c.appointment.id, "改咗主意");
    const days = await dailyStats(t.sql, "2028-03-01", "2028-03-12");
    const by = Object.fromEntries(days.map((d) => [d.day, d]));
    expect(by["2028-03-01"]).toMatchObject({ booked: 2, met: 0 });
    expect(by["2028-03-10"]).toMatchObject({ booked: 0, met: 1 });
    expect(by["2028-03-12"]).toMatchObject({ booked: 0, met: 0 }); // 已約未見唔算
    expect(await periodTotals(t.sql, "2028-03-01", "2028-03-31")).toMatchObject({ booked: 2, met: 1 });
  });
});
