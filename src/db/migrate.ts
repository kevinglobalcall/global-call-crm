/**
 * Migration runner：`supabase/migrations/*.sql` 照檔名次序行，`public.schema_migrations` 記住行咗邊個。
 *
 * ❗一個檔一個 transaction：行到一半爆就成個檔 rollback，唔會留低半個 schema。
 * ❗部署（fly.toml release_command）同測試（tests/setup/global.ts）行同一個 runner ——
 *   測試個 schema 就係 production 個 schema，唔係憑印象打嘅假 schema。
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "./client.js";

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");

export async function migrate(sql: Sql, dir = MIGRATIONS_DIR, log = (s: string) => console.error(s)): Promise<string[]> {
  await sql`
    create table if not exists public.schema_migrations (
      version     text primary key,
      applied_at  timestamptz not null default now()
    )`;
  // schema_migrations 自己都要鎖門（Supabase API 唔應該睇到）
  await sql`alter table public.schema_migrations enable row level security`;
  const files = readdirSync(dir).filter((f) => /^\d+_[^/]+\.sql$/.test(f)).sort();
  const done = new Set(
    (await sql<{ version: string }[]>`select version from public.schema_migrations`).map((r) => r.version),
  );
  const applied: string[] = [];
  for (const f of files) {
    const version = f.replace(/\.sql$/, "");
    if (done.has(version)) continue;
    const body = readFileSync(join(dir, f), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into public.schema_migrations (version) values (${version})`;
    });
    applied.push(version);
    log(`  ✓ ${f}`);
  }
  log(applied.length ? `行咗 ${applied.length} 個 migration` : "冇新 migration");
  return applied;
}

// 直接行：`npm run migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { connect, readDatabaseUrl } = await import("./client.js");
  const sql = connect(readDatabaseUrl(), { max: 1 });
  try {
    await migrate(sql);
  } catch (e) {
    console.error(`::error::migration 失敗：${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
