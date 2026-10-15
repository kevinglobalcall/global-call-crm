/**
 * 預約見面：約、改期、見完寫備註、取消、冇出現；日曆時間表。
 *
 * Kevin：「添加預約客戶 客戶紀錄見面備註 已約客戶日曆和時間表 時間表要顯示公司名稱，聯絡人，地址」
 *
 * 規矩：
 *   · 每次寫入一個 transaction ＋ audit_log（同 calls.ts 一樣）。
 *   · 時間一律 timestamptz；「邊一日」按香港時間（hkDayStart）。
 *   · 撞時段（前後 60 分鐘）淨係提示，唔擋 —— 約喺同一幢樓嘅兩間係常事。
 *   · 見完客有「下一步」就開跟進待辦，出喺今日回撥（唔係淨係寫喺備註度冇人睇）。
 */

import { one, toJson, type Sql } from "../db/client.js";
import { blankToNull } from "../lib/text.js";
import { addDays, assertDay, hkDayStart } from "../lib/time.js";

export const APPT_STATUSES = ["已約", "已見", "取消", "冇出現"] as const;
export type ApptStatus = (typeof APPT_STATUSES)[number];

const CLASH_BUFFER_MIN = 60;
const DEFAULT_MINUTES = 60;

export interface AppointmentRow {
  id: string;
  company_id: string;
  company_code: string;
  company_name: string;
  company_name_en: string | null;
  company_phones: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_title: string | null;
  contact_phone: string | null;
  starts_at: Date;
  ends_at: Date | null;
  address: string | null;
  purpose: string | null;
  meeting_notes: string | null;
  status: ApptStatus;
  rescheduled: number;
  source_call_id: string | null;
  created_at: Date;
}

/** 時間表要嘅嘢一次過 join 晒：公司名、公司電話（唔包傳真）、聯絡人。 */
function selectRows(sql: Sql) {
  return sql`
    select a.id, a.company_id, c.code as company_code,
           coalesce(nullif(btrim(c.name_zh), ''), c.name_en) as company_name,
           case when nullif(btrim(c.name_zh), '') is not null then c.name_en end as company_name_en,
           coalesce((select string_agg(p.phone, ' / ' order by p.sort, p.created_at)
                       from public.company_phones p
                      where p.company_id = c.id and p.label <> '傳真'), '') as company_phones,
           a.contact_id, k.name as contact_name, k.title as contact_title, k.phone as contact_phone,
           a.starts_at, a.ends_at, a.address, a.purpose, a.meeting_notes, a.status, a.rescheduled,
           a.source_call_id, a.created_at
      from public.appointments a
      join public.companies c on c.id = a.company_id
      left join public.contacts k on k.id = a.contact_id`;
}

export async function getAppointment(sql: Sql, id: string): Promise<AppointmentRow | null> {
  const [r] = await sql<AppointmentRow[]>`${selectRows(sql)} where a.id = ${id}`;
  return r ?? null;
}

/** from..to（香港日子，包埋 to 嗰日）。 */
export async function listAppointments(
  sql: Sql, from: string, to: string, opts: { statuses?: readonly string[] } = {},
): Promise<AppointmentRow[]> {
  assertDay(from);
  assertDay(to);
  if (from > to) throw new Error(`由 ${from} 到 ${to}？開始日喺完結日之後`);
  if (addDays(from, 400) < to) throw new Error("一次最多睇 400 日");
  const st = (opts.statuses ?? []).filter((s) => (APPT_STATUSES as readonly string[]).includes(s));
  return sql<AppointmentRow[]>`${selectRows(sql)}
     where a.starts_at >= ${hkDayStart(from)} and a.starts_at < ${hkDayStart(addDays(to, 1))}
       ${st.length ? sql`and a.status in ${sql(st)}` : sql``}
     order by a.starts_at, c.code`;
}

export async function companyAppointments(sql: Sql, companyId: string): Promise<AppointmentRow[]> {
  return sql<AppointmentRow[]>`${selectRows(sql)} where a.company_id = ${companyId} order by a.starts_at desc`;
}

/** 同一段時間（前後 60 分鐘）有冇其他「已約」。 */
async function clashesWith(sql: Sql, startsAt: Date, endsAt: Date, exceptId: string | null): Promise<AppointmentRow[]> {
  return sql<AppointmentRow[]>`${selectRows(sql)}
     where a.status = '已約'
       and a.id is distinct from ${exceptId}::uuid
       and a.starts_at < ${new Date(endsAt.getTime() + CLASH_BUFFER_MIN * 60_000)}
       and coalesce(a.ends_at, a.starts_at + make_interval(mins => ${DEFAULT_MINUTES}))
             > ${new Date(startsAt.getTime() - CLASH_BUFFER_MIN * 60_000)}
     order by a.starts_at`;
}

function endOf(startsAt: Date, endsAt: Date | null | undefined, minutes: number | null | undefined): Date {
  if (endsAt) return endsAt;
  const m = minutes ?? DEFAULT_MINUTES;
  if (!Number.isInteger(m) || m < 5 || m > 24 * 60) throw new Error("見面長度要係 5 分鐘至 24 個鐘");
  return new Date(startsAt.getTime() + m * 60_000);
}

function audit(tx: Sql, actor: string, action: string, id: string, before: unknown, after: unknown) {
  return tx`insert into public.audit_log (actor, action, table_name, record_id, before, after)
            values (${actor}, ${action}, 'appointments', ${id},
                    ${before === null ? null : tx.json(toJson(before))}, ${tx.json(toJson(after))})`;
}

// ── 約 ────────────────────────────────────────────────────────────────────

export interface CreateAppointmentInput {
  companyId: string;
  startsAt: Date;
  endsAt?: Date | null;
  /** 冇畀 endsAt 就用呢個（分鐘），預設 60 */
  minutes?: number | null;
  /** 揀現有聯絡人 */
  contactId?: string | null;
  /** 或者畀個新名，同一個 transaction 開埋聯絡人 */
  newContact?: { name: string; title?: string | null; phone?: string | null } | null;
  /** undefined ＝ 用公司地址；null／"" ＝ 唔填 */
  address?: string | null;
  purpose?: string | null;
  sourceCallId?: string | null;
  /** 幾時約嘅（「約」每日數按呢個計）；唔畀就 DB now() —— API／MCP 傳佢哋個時鐘入嚟，測試唔跟真時鐘 */
  createdAt?: Date | null;
}

export async function createAppointment(
  sql: Sql, input: CreateAppointmentInput, actor = "web",
): Promise<{ appointment: AppointmentRow; clashes: AppointmentRow[]; newContactId: string | null }> {
  if (!(input.startsAt instanceof Date) || Number.isNaN(input.startsAt.getTime())) throw new Error("要揀見面時間");
  const endsAt = endOf(input.startsAt, input.endsAt, input.minutes);
  if (endsAt <= input.startsAt) throw new Error("完結時間要喺開始之後");
  if (input.contactId && input.newContact) throw new Error("揀咗現有聯絡人就唔好再填新名");

  const made = await sql.begin(async (tx) => {
    const co = one(await tx<{ id: string; status: string; address_zh: string | null; address_en: string | null }[]>`
      select id, status, address_zh, address_en from public.companies where id = ${input.companyId} for update`,
      "呢間公司（可能啱啱被刪咗）");
    let contactId = blankToNull(input.contactId);
    if (contactId) {
      const [k] = await tx`select 1 from public.contacts where id = ${contactId} and company_id = ${co.id}`;
      if (!k) throw new Error("個聯絡人唔係呢間公司嘅");
    }
    if (input.newContact) {
      const name = blankToNull(input.newContact.name);
      if (!name) throw new Error("新聯絡人要有名");
      contactId = one(await tx<{ id: string }[]>`
        insert into public.contacts (company_id, name, title, phone)
        values (${co.id}, ${name}, ${blankToNull(input.newContact.title)}, ${blankToNull(input.newContact.phone)})
        returning id`, "新聯絡人").id;
      await tx`insert into public.audit_log (actor, action, table_name, record_id, after)
               values (${actor}, 'add_contact', 'contacts', ${contactId}, ${tx.json(toJson({ ...input.newContact, companyId: co.id }))})`;
    }
    const address = input.address === undefined
      ? blankToNull(co.address_zh) ?? blankToNull(co.address_en)
      : blankToNull(input.address);
    const row = one(await tx<{ id: string }[]>`
      insert into public.appointments (company_id, contact_id, starts_at, ends_at, address, purpose, source_call_id, created_at)
      values (${co.id}, ${contactId}, ${input.startsAt}, ${endsAt}, ${address},
              ${blankToNull(input.purpose)}, ${blankToNull(input.sourceCallId)}, coalesce(${input.createdAt ?? null}::timestamptz, now()))
      returning id`, "啱啱開嘅約");
    // 約到見面 ＝ 傾開；未打嘅公司變跟進中（已成交／不需要嗰啲唔郁）
    if (co.status === "未打") await tx`update public.companies set status = '跟進中' where id = ${co.id}`;
    await audit(tx as unknown as Sql, actor, "create_appointment", row.id, null,
      { companyId: co.id, contactId, startsAt: input.startsAt, endsAt, address, purpose: input.purpose ?? null });
    return { id: row.id, contactId: input.newContact ? contactId : null };
  });

  const appointment = (await getAppointment(sql, made.id))!;
  const clashes = await clashesWith(sql, appointment.starts_at, appointment.ends_at ?? endsAt, appointment.id);
  return { appointment, clashes, newContactId: made.contactId };
}

// ── 改 ────────────────────────────────────────────────────────────────────

async function lockRow(tx: Sql, id: string) {
  return one(await tx<{ id: string; company_id: string; status: ApptStatus; starts_at: Date; ends_at: Date | null;
    address: string | null; purpose: string | null; meeting_notes: string | null; contact_id: string | null; rescheduled: number }[]>`
    select id, company_id, status, starts_at, ends_at, address, purpose, meeting_notes, contact_id, rescheduled
      from public.appointments where id = ${id} for update`, "呢個約");
}

/** 改期：已約或者冇出現（再約過）先改得；長度跟返原本。 */
export async function rescheduleAppointment(
  sql: Sql, id: string, startsAt: Date, endsAt?: Date | null, actor = "web",
): Promise<{ appointment: AppointmentRow; clashes: AppointmentRow[] }> {
  if (!(startsAt instanceof Date) || Number.isNaN(startsAt.getTime())) throw new Error("要揀新時間");
  await sql.begin(async (tx) => {
    const b = await lockRow(tx as unknown as Sql, id);
    if (b.status !== "已約" && b.status !== "冇出現") throw new Error(`呢個約已經「${b.status}」，改唔到期 —— 開過個新約`);
    const len = b.ends_at ? b.ends_at.getTime() - b.starts_at.getTime() : DEFAULT_MINUTES * 60_000;
    const newEnd = endsAt ?? new Date(startsAt.getTime() + len);
    if (newEnd <= startsAt) throw new Error("完結時間要喺開始之後");
    await tx`update public.appointments
                set starts_at = ${startsAt}, ends_at = ${newEnd}, status = '已約', rescheduled = rescheduled + 1
              where id = ${id}`;
    await audit(tx as unknown as Sql, actor, "reschedule_appointment", id,
      { starts_at: b.starts_at, ends_at: b.ends_at, status: b.status }, { starts_at: startsAt, ends_at: newEnd });
  });
  const appointment = (await getAppointment(sql, id))!;
  return { appointment, clashes: await clashesWith(sql, appointment.starts_at, appointment.ends_at!, id) };
}

export interface AppointmentPatch {
  address?: string | null;
  purpose?: string | null;
  meetingNotes?: string | null;
  contactId?: string | null;
}

/** 改內容（地址、目的、見面備註、聯絡人）—— 任何狀態都改得，見完先補備註好常見。 */
export async function updateAppointment(sql: Sql, id: string, p: AppointmentPatch, actor = "web"): Promise<AppointmentRow> {
  await sql.begin(async (tx) => {
    const b = await lockRow(tx as unknown as Sql, id);
    const set: Record<string, unknown> = {};
    if (p.address !== undefined) set.address = blankToNull(p.address);
    if (p.purpose !== undefined) set.purpose = blankToNull(p.purpose);
    if (p.meetingNotes !== undefined) set.meeting_notes = blankToNull(p.meetingNotes);
    if (p.contactId !== undefined) {
      const cid = blankToNull(p.contactId);
      if (cid) {
        const [k] = await tx`select 1 from public.contacts where id = ${cid} and company_id = ${b.company_id}`;
        if (!k) throw new Error("個聯絡人唔係呢間公司嘅");
      }
      set.contact_id = cid;
    }
    if (!Object.keys(set).length) return;
    await tx`update public.appointments set ${tx(set)} where id = ${id}`;
    await audit(tx as unknown as Sql, actor, "update_appointment", id, b, set);
  });
  return (await getAppointment(sql, id))!;
}

export interface CompleteInput {
  meetingNotes?: string | null;
  /** 下一步：有寫字或者有時間就開跟進待辦 */
  nextStepNote?: string | null;
  nextStepAt?: Date | null;
}

/** 見咗：寫見面備註；有下一步就開跟進待辦（出喺今日回撥）。 */
export async function completeAppointment(
  sql: Sql, id: string, input: CompleteInput, actor = "web",
): Promise<{ appointment: AppointmentRow; taskId: string | null }> {
  const taskId = await sql.begin(async (tx) => {
    const b = await lockRow(tx as unknown as Sql, id);
    if (b.status !== "已約") throw new Error(`呢個約係「${b.status}」，唔可以標「已見」`);
    const notes = blankToNull(input.meetingNotes) ?? b.meeting_notes;
    await tx`update public.appointments set status = '已見', meeting_notes = ${notes} where id = ${id}`;
    let tid: string | null = null;
    const nextNote = blankToNull(input.nextStepNote);
    if (nextNote || input.nextStepAt) {
      tid = one(await tx<{ id: string }[]>`
        insert into public.tasks (company_id, kind, due_at, note, source_appointment_id)
        values (${b.company_id}, '跟進', ${input.nextStepAt ?? null}, ${nextNote ?? "見完客跟進"}, ${id})
        returning id`, "跟進待辦").id;
    }
    await tx`update public.companies set status = '跟進中' where id = ${b.company_id} and status = '未打'`;
    await audit(tx as unknown as Sql, actor, "complete_appointment", id, { status: b.status, meeting_notes: b.meeting_notes },
      { status: "已見", meeting_notes: notes, taskId: tid });
    return tid;
  });
  return { appointment: (await getAppointment(sql, id))!, taskId };
}

async function closeAs(sql: Sql, id: string, status: "取消" | "冇出現", reason: string | null | undefined, actor: string) {
  await sql.begin(async (tx) => {
    const b = await lockRow(tx as unknown as Sql, id);
    if (b.status !== "已約") throw new Error(`呢個約已經「${b.status}」`);
    const r = blankToNull(reason);
    const notes = r ? [b.meeting_notes, `${status}：${r}`].filter(Boolean).join("\n") : b.meeting_notes;
    await tx`update public.appointments set status = ${status}, meeting_notes = ${notes} where id = ${id}`;
    await audit(tx as unknown as Sql, actor, status === "取消" ? "cancel_appointment" : "noshow_appointment", id,
      { status: b.status }, { status, reason: r });
  });
  return (await getAppointment(sql, id))!;
}

export const cancelAppointment = (sql: Sql, id: string, reason?: string | null, actor = "web") =>
  closeAs(sql, id, "取消", reason, actor);
export const noShowAppointment = (sql: Sql, id: string, reason?: string | null, actor = "web") =>
  closeAs(sql, id, "冇出現", reason, actor);
