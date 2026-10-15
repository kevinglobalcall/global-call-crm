/**
 * 每日數：通數 · 接通 · R · D。
 *
 * 計法（Kevin 可以改，改呢度一個位）：
 *   · 通數 ＝ 打咗幾多次（每撥一次算一次）
 *   · 接通 ＝ 結果唔係「沒有人接」嘅次數
 *   · R    ＝ 當日有幾多**間公司**搵到負責人（同一間一日打兩次都係 1）
 *   · D    ＝ 當日有幾多**間公司**攞到詳盡資料
 * R、D 按間數唔按次數：上晝傾到負責人、下晝再打又傾到，唔應該報兩個 R。
 *   · 約   ＝ 當日約咗幾多個見面（按約嗰日，取消咗嘅唔計）
 *   · 見   ＝ 當日見咗幾多個（按見面嗰日，狀態「已見」）
 *
 * 「邊一日」一律按香港時間（`at time zone 'Asia/Hong_Kong'`），唔靠 session 時區。
 */

import type { Sql } from "../db/client.js";
import { addDays, assertDay, hkDayStart, hkToday } from "../lib/time.js";

export interface DayStats {
  day: string;
  calls: number;
  connected: number;
  r: number;
  d: number;
  booked: number;
  met: number;
}

export async function dailyStats(sql: Sql, from: string, to: string): Promise<DayStats[]> {
  assertDay(from);
  assertDay(to);
  if (from > to) throw new Error(`由 ${from} 到 ${to}？開始日喺完結日之後`);
  if (addDays(from, 400) < to) throw new Error("一次最多睇 400 日");
  const start = hkDayStart(from);
  const end = hkDayStart(addDays(to, 1));
  const rows = await sql<Omit<DayStats, "booked" | "met">[]>`
    select (called_at at time zone 'Asia/Hong_Kong')::date::text                as day,
           count(*)::int                                                       as calls,
           count(*) filter (where outcome <> '沒有人接')::int                   as connected,
           count(distinct company_id) filter (where reached_r)::int            as r,
           count(distinct company_id) filter (where got_d)::int                as d
      from public.calls
     where called_at >= ${start} and called_at < ${end}
     group by 1`;
  const booked = await sql<{ day: string; n: number }[]>`
    select (created_at at time zone 'Asia/Hong_Kong')::date::text as day, count(*)::int as n
      from public.appointments
     where created_at >= ${start} and created_at < ${end} and status <> '取消'
     group by 1`;
  const met = await sql<{ day: string; n: number }[]>`
    select (starts_at at time zone 'Asia/Hong_Kong')::date::text as day, count(*)::int as n
      from public.appointments
     where starts_at >= ${start} and starts_at < ${end} and status = '已見'
     group by 1`;
  // 冇打過電話嗰日都要出一行 0 —— 唔出嘅話 Kevin 分唔到「冇打」定「冇記錄」
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const bookedBy = new Map(booked.map((r) => [r.day, r.n]));
  const metBy = new Map(met.map((r) => [r.day, r.n]));
  const out: DayStats[] = [];
  for (let d = to; d >= from; d = addDays(d, -1)) {
    const c = byDay.get(d) ?? { day: d, calls: 0, connected: 0, r: 0, d: 0 };
    out.push({ ...c, booked: bookedBy.get(d) ?? 0, met: metBy.get(d) ?? 0 });
  }
  return out;
}

export async function todayStats(sql: Sql, today: string = hkToday()): Promise<DayStats> {
  const [row] = await dailyStats(sql, today, today);
  return row!;
}

/** 一段時間嘅總數（R、D 照樣按間數 —— 同一間一個月 R 咗三次都係 1）。 */
export async function periodTotals(sql: Sql, from: string, to: string): Promise<Omit<DayStats, "day">> {
  assertDay(from);
  assertDay(to);
  const start = hkDayStart(from);
  const end = hkDayStart(addDays(to, 1));
  const [row] = await sql<Omit<DayStats, "day">[]>`
    select count(*)::int                                                       as calls,
           count(*) filter (where outcome <> '沒有人接')::int                   as connected,
           count(distinct company_id) filter (where reached_r)::int            as r,
           count(distinct company_id) filter (where got_d)::int                as d,
           (select count(*)::int from public.appointments
             where created_at >= ${start} and created_at < ${end} and status <> '取消') as booked,
           (select count(*)::int from public.appointments
             where starts_at >= ${start} and starts_at < ${end} and status = '已見')    as met
      from public.calls
     where called_at >= ${start} and called_at < ${end}`;
  return row!;
}
