/**
 * 備份 CSV：每張表都有、行數對得返、中文／逗號／真斷行／雙引號／jsonb 讀得返。
 */
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportCsv } from "../src/db/export-csv.js";
import { parseCsv } from "../src/lib/csv.js";
import { makeCompany, useTestDb } from "./helpers/db.js";

const t = useTestDb();

describe("備份 CSV", () => {
  it("每張表一個檔，中文同怪字元原封不動讀得返", async () => {
    const id = await makeCompany(t.sql, { name_zh: '大發"物流", 有限公司' });
    await t.sql`update public.companies set notes = ${"第一行\n第二行，有逗號"} where id = ${id}`;
    await t.sql`insert into public.audit_log (actor, action, table_name, after) values ('test', 'x', 'companies', ${t.sql.json({ a: 1, b: "中" })})`;
    const dir = mkdtempSync(join(tmpdir(), "gc-csv-"));
    const res = await exportCsv(t.sql, dir);
    const tables = (await t.sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`).map((r) => r.table_name);
    expect(res.map((r) => r.table).sort()).toEqual([...tables].sort());
    expect(readdirSync(dir)).toContain("companies.csv");

    const raw = readFileSync(join(dir, "companies.csv"), "utf8");
    expect(raw.charCodeAt(0)).toBe(0xfeff);
    const csv = parseCsv(raw.slice(1));
    const ni = csv.headers.indexOf("name_zh");
    const row = csv.rows.find((r) => r[ni] === '大發"物流", 有限公司')!;
    expect(row[csv.headers.indexOf("notes")]).toBe("第一行\n第二行，有逗號");
    expect(csv.rows.length).toBe(res.find((r) => r.table === "companies")!.rows);

    const audit = parseCsv(readFileSync(join(dir, "audit_log.csv"), "utf8").slice(1));
    expect(audit.rows.map((r) => r[audit.headers.indexOf("after")])).toContain('{"a":1,"b":"中"}');
    const products = parseCsv(readFileSync(join(dir, "products.csv"), "utf8").slice(1));
    expect(products.rows.length).toBe(11);
  });
});
