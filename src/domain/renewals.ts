/**
 * 續約提醒 —— 計出嚟，唔落 tasks 表。
 *
 * Kevin 2026-10-15：到期前 90 日提醒，30 日再提一次（`settings.renewal`，可改）。
 *
 * 來源一：冷電攞到嘅 D —— 對手台合約到期日（company_overview.d_contract_end，最新一筆）。
 * 第三期加來源二：自己客嘅合約到期（`source` 欄已經留咗位）。
 *
 * 幾時出：
 *   第一段：到期日 ≤ 今日 + 90，而且由（到期日 − 90）之後冇打過電話
 *   第二段：到期日 ≤ 今日 + 30，而且由（到期日 − 30）之後冇打過
 *   ⇒ 打咗電話就自動收，唔使另外撳；撳「收埋」鎖住嗰個到期日＋嗰段
 *   已過期照出（標過咗幾多日），過期 60 日之後唔再出。
 * 唔出：其他人跟進（同事單）、已結業。不需要**照出** —— 合約到期正正係再打嘅時候。
 *
 * ❗點解唔落 tasks：D 日期之後會改（再打攞到新日期），落咗嘅 task 會同新日期打交，
 *   即係 Equal CRM「答咗又翻生」嗰個病。計出嚟永遠同資料一致。
 */

import { toJson, type Sql } from "../db/client.js";
import { addDays, assertDay, hkToday } from "../lib/time.js";

export const EXPIRED_GRACE_DAYS = 60;

export interface RenewalSettings { first: number; second: number }

export interface RenewalRow {
  source: "D";
  company_id: string;
  company_code: string;
  company_name: string;
  phones: string;
  status: string;
  contract_end: string;
  provider: string | null;
  price: string | null;
  plan: string | null;
  stage: 1 | 2;
  days_left: number;
  last_call_at: Date | null;
}

export async function renewalSettings(sql: Sql): Promise<RenewalSettings> {
  const [row] = await sql<{ value: unknown }[]>`select value from public.settings where key = 'renewal'`;
  const v = (row?.value ?? {}) as Record<string, unknown>;
  const first = Number(v.first ?? 90);
  const second = Number(v.second ?? 30);
  if (!Number.isInteger(first) || !Number.isInteger(second) || second < 1 || first <= second || first > 400) {
    throw new Error(`續約提醒設定唔啱：first=${String(v.first)} second=${String(v.second)}（要 first > second ≥ 1）`);
  }
  return { first, second };
}

export async function renewalsDue(sql: Sql, today: string = hkToday()): Promise<RenewalRow[]> {
  assertDay(today);
  const { first, second } = await renewalSettings(sql);
  return sql<RenewalRow[]>`
    with due as (
      select o.*,
             case when o.d_contract_end <= ${addDays(today, second)}::date then 2 else 1 end as stage
        from public.company_overview o
       where o.d_contract_end is not null
         and o.d_contract_end <= ${addDays(today, first)}::date
         and o.d_contract_end >= ${addDays(today, -EXPIRED_GRACE_DAYS)}::date
         and o.status not in ('其他人跟進', '已結業')
    )
    select 'D' as source, d.id as company_id, d.code as company_code,
           coalesce(nullif(btrim(d.name_zh), ''), d.name_en) as company_name,
           coalesce((select string_agg(p.phone, ' / ' order by p.sort, p.created_at)
                       from public.company_phones p
                      where p.company_id = d.id and p.label <> '傳真'), '') as phones,
           d.status, d.d_contract_end::text as contract_end, d.d_provider as provider,
           d.d_price as price, d.d_plan as plan, d.stage::int as stage,
           (d.d_contract_end - ${today}::date)::int as days_left, d.last_call_at
      from due d
     where -- 呢一段個窗開咗之後冇打過（香港日子 00:00 起計）
           (d.last_call_at is null or d.last_call_at <
              ((d.d_contract_end - case when d.stage = 2 then ${second}::int else ${first}::int end)::timestamp
                 at time zone 'Asia/Hong_Kong'))
       and not exists (select 1 from public.renewal_dismissals x
                        where x.company_id = d.id and x.contract_end = d.d_contract_end and x.stage = d.stage)
     order by d.d_contract_end, d.code`;
}

/** 「收埋」：鎖住到期日＋段數。之後報返新到期日就會再出。 */
export async function dismissRenewal(
  sql: Sql, companyId: string, contractEnd: string, stage: number, actor = "web",
): Promise<void> {
  assertDay(contractEnd);
  if (stage !== 1 && stage !== 2) throw new Error("stage 要係 1 或 2");
  await sql.begin(async (tx) => {
    await tx`insert into public.renewal_dismissals (company_id, contract_end, stage)
             values (${companyId}, ${contractEnd}, ${stage}) on conflict do nothing`;
    await tx`insert into public.audit_log (actor, action, table_name, record_id, after)
             values (${actor}, 'dismiss_renewal', 'renewal_dismissals', ${companyId},
                     ${tx.json(toJson({ contractEnd, stage }))})`;
  });
}
