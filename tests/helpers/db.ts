/**
 * 每個測試檔一個獨立 database（由真 migration 砌嘅 template clone 出嚟）。
 *
 *   const t = useTestDb();
 *   it("…", async () => { await t.sql`…` });
 */
import { afterAll, beforeAll } from "vitest";
import { connect, type Sql } from "../../src/db/client.js";

export function useTestDb(): { readonly sql: Sql; readonly url: string } {
  const admin = process.env.TEST_DATABASE_URL!;
  const name = `gc_t_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const state: { sql: Sql | null; url: string } = { sql: null, url: "" };

  beforeAll(async () => {
    const root = connect(admin, { max: 1 });
    try {
      await root.unsafe(`create database ${name} template gc_template`);
    } finally {
      await root.end();
    }
    const u = new URL(admin);
    u.pathname = `/${name}`;
    state.url = u.toString();
    state.sql = connect(state.url, { max: 4 });
  });

  afterAll(async () => {
    await state.sql?.end();
    const root = connect(admin, { max: 1 });
    try {
      await root.unsafe(`drop database if exists ${name} with (force)`);
    } finally {
      await root.end();
    }
  });

  return {
    get sql() {
      if (!state.sql) throw new Error("test db 未準備好（喺 it() 入面先用）");
      return state.sql;
    },
    get url() { return state.url; },
  };
}

/** 開一間測試公司，回 id。 */
export async function makeCompany(
  sql: Sql,
  o: { name_zh?: string; name_en?: string; status?: string; industry?: string; phones?: string[] } = {},
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into public.companies (name_zh, name_en, status, industry)
    values (${o.name_zh ?? "測試工程有限公司"}, ${o.name_en ?? null}, ${o.status ?? "未打"}, ${o.industry ?? null})
    returning id`;
  for (const [i, p] of (o.phones ?? []).entries()) {
    await sql`insert into public.company_phones (company_id, phone, sort) values (${row!.id}, ${p}, ${i})`;
  }
  return row!.id;
}
