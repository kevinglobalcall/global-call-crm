/**
 * 每張表一個 CSV（UTF-8 BOM，Excel 直接開到中文）—— 每晚備份用。
 *
 * 點解 pg_dump 之外仲要呢個：pg_dump 個檔要有部 Postgres 先還原得返；
 * Supabase project 一冇咗，嗰嚿嘢 Kevin 自己打唔開（Equal CRM 停用嗰陣學返嘅）。
 *
 * ❗表清單臨場由 information_schema 數，唔寫死 —— 寫死就會漏咗之後加嘅表。
 * ❗每張表寫完對返 count(*)：對唔上就 exit 1，唔好扮備份咗。
 *
 *   DATABASE_URL=… node --import tsx src/db/export-csv.ts <輸出資料夾>
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toCsv } from "../lib/csv.js";
import { one, type Sql } from "./client.js";

export interface TableDump { table: string; rows: number }

export async function exportCsv(sql: Sql, dir: string): Promise<TableDump[]> {
  mkdirSync(dir, { recursive: true });
  const tables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`;
  const out: TableDump[] = [];
  for (const { table_name: t } of tables) {
    // 一張表一個 transaction snapshot：count 同 select 睇到同一份資料
    // 排序：有編號跟編號、有開檔時間跟時間 —— Excel 打開人睇得順
    const cols = (await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_schema = 'public' and table_name = ${t}`).map((c) => c.column_name);
    const order = cols.includes("code") ? "code" : cols.includes("created_at") ? "created_at, 1" : cols.includes("at") ? "at, 1" : "1";
    const rows = await sql.begin("isolation level repeatable read", async (tx) => {
      const data = await tx.unsafe(`select * from public."${t.replace(/"/g, '""')}" order by ${order}`);
      const { n } = one(await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from public."${t.replace(/"/g, '""')}"`), `${t} 行數`);
      if (n !== data.length) throw new Error(`${t}：讀到 ${data.length} 行，但表入面有 ${n} 行`);
      const headers = data.columns.map((c) => c.name);
      writeFileSync(join(dir, `${t}.csv`), toCsv(headers, data.map((r) => headers.map((h) => (r as Record<string, unknown>)[h]))));
      return data.length;
    });
    out.push({ table: t, rows });
  }
  writeFileSync(join(dir, "_摘要.csv"), toCsv(["表", "行數"], out.map((x) => [x.table, x.rows])));
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2];
  if (!dir) { console.error("用法：export-csv.ts <輸出資料夾>"); process.exit(2); }
  const { connect, readDatabaseUrl } = await import("./client.js");
  const sql = connect(readDatabaseUrl(), { max: 1 });
  try {
    const res = await exportCsv(sql, dir);
    for (const r of res) console.log(`${r.table}\t${r.rows}`);
    console.log(`共 ${res.length} 張表、${res.reduce((a, r) => a + r.rows, 0)} 行`);
  } catch (e) {
    console.error(`::error::導出失敗：${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
