/**
 * Migration runner：再行一次唔會重複行（部署每次都會行 release_command）。
 */
import { describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { useTestDb } from "./helpers/db.js";

const t = useTestDb();

describe("migrate", () => {
  it("template 已經行齊；再行一次乜都唔做", async () => {
    const before = await t.sql<{ version: string }[]>`select version from public.schema_migrations order by version`;
    expect(before.length).toBeGreaterThanOrEqual(4);
    expect(await migrate(t.sql, undefined, () => {})).toEqual([]);
    const after = await t.sql`select count(*)::int as n from public.schema_migrations`;
    expect(after[0]!.n).toBe(before.length);
  });
});
