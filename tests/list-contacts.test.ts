/**
 * 公司清單每行嘅 R 負責人格（Kevin 2026-10-16「要有位置輸入R資料 例如這間公司的R是DEREK SHAO」）—— 對真 Postgres。
 * ❗記低 R 係邊個唔等於搵到 R：ever_r／R 數字照舊由電話記錄計。
 */
import { describe, expect, it } from "vitest";
import { addContact, listCompanies } from "../src/domain/companies.js";
import { makeCompany, useTestDb } from "./helpers/db.js";

const t = useTestDb();

describe("清單每行帶聯絡人", () => {
  it("負責人（R）行先、其他聯絡人跟尾；冇聯絡人嘅係空陣列；全站搜尋搵到個名", async () => {
    const id = await makeCompany(t.sql);
    const other = await makeCompany(t.sql);
    await addContact(t.sql, id, { name: "前台 Amy", phone: "23456789" });
    await addContact(t.sql, id, { name: "DEREK SHAO", title: "IT Manager", phone: "98765432", is_decision_maker: true });
    const { rows } = await listCompanies(t.sql, { id }, 1);
    expect(rows[0]!.contacts!.map((k) => [k.name, k.is_decision_maker])).toEqual([["DEREK SHAO", true], ["前台 Amy", false]]);
    expect(rows[0]!.contacts![0]).toMatchObject({ title: "IT Manager", phone: "98765432" });
    expect((await listCompanies(t.sql, { id: other }, 1)).rows[0]!.contacts).toEqual([]);
    const hit = await listCompanies(t.sql, { q: "derek shao" }, 50);
    expect(hit.rows.map((r) => r.id)).toContain(id);
  });

  it("❗記低 R 唔會令 ever_r 變真（R 要電話剔先算）", async () => {
    const id = await makeCompany(t.sql);
    await addContact(t.sql, id, { name: "DEREK SHAO", is_decision_maker: true });
    const { rows, totalR } = await listCompanies(t.sql, { id }, 1);
    expect(rows[0]!.ever_r).toBe(false);
    expect(totalR).toBe(0);
  });
});
