/**
 * 待辦：今日回撥清單、完成、取消、改時間。
 *
 * 今日回撥 ＝ 仍然待辦 而且（過咗期 或者 今日到期 或者 冇揀時間）。
 * 排法：過咗期 → 今日（按鐘數）→ 冇時間（排最尾）。
 */

import { toJson, type Sql } from "../db/client.js";
import { addDays, hkDayStart, hkToday } from "../lib/time.js";
import { blankToNull } from "../lib/text.js";

export interface TaskRow {
  id: string;
  company_id: string;
  company_code: string;
  company_name: string;
  phones: string;
  kind: string;
  due_at: Date | null;
  note: string | null;
  overdue: boolean;
  created_at: Date;
}

export async function callbacksDue(sql: Sql, today: string = hkToday(), limit = 300): Promise<TaskRow[]> {
  const startToday = hkDayStart(today);
  const startTomorrow = hkDayStart(addDays(today, 1));
  return sql<TaskRow[]>`
    select t.id, t.company_id, c.code as company_code,
           coalesce(nullif(btrim(c.name_zh), ''), c.name_en) as company_name,
           coalesce((select string_agg(p.phone, ' / ' order by p.sort, p.created_at)
                       from public.company_phones p
                      where p.company_id = c.id and p.label <> '傳真'), '') as phones,
           t.kind, t.due_at, t.note, (t.due_at is not null and t.due_at < ${startToday}) as overdue,
           t.created_at
      from public.tasks t
      join public.companies c on c.id = t.company_id
     where t.status = '待辦'
       and t.kind <> '到期提醒'
       and (t.due_at is null or t.due_at < ${startTomorrow})
     order by (t.due_at is null), t.due_at, t.created_at
     limit ${limit}`;
}

/** 之後幾日嘅回撥（今日之後）。 */
export async function callbacksUpcoming(sql: Sql, today: string = hkToday(), days = 7): Promise<TaskRow[]> {
  const from = hkDayStart(addDays(today, 1));
  const to = hkDayStart(addDays(today, days + 1));
  return sql<TaskRow[]>`
    select t.id, t.company_id, c.code as company_code,
           coalesce(nullif(btrim(c.name_zh), ''), c.name_en) as company_name,
           coalesce((select string_agg(p.phone, ' / ' order by p.sort, p.created_at)
                       from public.company_phones p
                      where p.company_id = c.id and p.label <> '傳真'), '') as phones,
           t.kind, t.due_at, t.note, false as overdue, t.created_at
      from public.tasks t
      join public.companies c on c.id = t.company_id
     where t.status = '待辦' and t.kind <> '到期提醒'
       and t.due_at >= ${from} and t.due_at < ${to}
     order by t.due_at`;
}

async function closeTask(sql: Sql, id: string, status: "完成" | "取消", note: string | null, actor: string): Promise<void> {
  await sql.begin(async (tx) => {
    const [before] = await tx<{ id: string; status: string }[]>`
      select id, status from public.tasks where id = ${id} for update`;
    if (!before) throw new Error("搵唔到呢個待辦");
    if (before.status !== "待辦") throw new Error(`呢個待辦已經「${before.status}」咗`);
    await tx`update public.tasks set status = ${status}, closed_at = now(),
               note = coalesce(${note}, note) where id = ${id}`;
    await tx`insert into public.audit_log (actor, action, table_name, record_id, before, after)
             values (${actor}, ${status === "完成" ? "task_done" : "task_cancel"}, 'tasks', ${id},
                     ${tx.json(toJson({ status: before.status }))}, ${tx.json(toJson({ status, note }))})`;
  });
}

export const completeTask = (sql: Sql, id: string, note?: string | null, actor = "web") =>
  closeTask(sql, id, "完成", blankToNull(note), actor);
export const cancelTask = (sql: Sql, id: string, note?: string | null, actor = "web") =>
  closeTask(sql, id, "取消", blankToNull(note), actor);

/** 改時間（null ＝ 冇指定時間）。 */
export async function rescheduleTask(sql: Sql, id: string, dueAt: Date | null, actor = "web"): Promise<void> {
  await sql.begin(async (tx) => {
    const [before] = await tx<{ status: string; due_at: Date | null }[]>`
      select status, due_at from public.tasks where id = ${id} for update`;
    if (!before) throw new Error("搵唔到呢個待辦");
    if (before.status !== "待辦") throw new Error(`呢個待辦已經「${before.status}」咗，改唔到時間`);
    await tx`update public.tasks set due_at = ${dueAt} where id = ${id}`;
    await tx`insert into public.audit_log (actor, action, table_name, record_id, before, after)
             values (${actor}, 'task_reschedule', 'tasks', ${id},
                     ${tx.json(toJson({ due_at: before.due_at?.toISOString() ?? null }))},
                     ${tx.json(toJson({ due_at: dueAt?.toISOString() ?? null }))})`;
  });
}
