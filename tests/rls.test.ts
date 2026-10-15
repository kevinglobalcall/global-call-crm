/**
 * ❗public 每張表都要開 RLS —— 冇開嘅話 Supabase 個 anon key（公開嘅）讀得到成張表。
 * 第一期係喺一個 migration 逐張開，之後加表好容易漏，所以用 test 釘死。
 */
import { describe, expect, it } from "vitest";
import { useTestDb } from "./helpers/db.js";

const t = useTestDb();

describe("RLS", () => {
  it("public 每張表都 enable row level security", async () => {
    const rows = await t.sql<{ relname: string; relrowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`;
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => !r.relrowsecurity && r.relname !== "schema_migrations").map((r) => r.relname)).toEqual([]);
  });
});
