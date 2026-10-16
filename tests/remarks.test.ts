/**
 * 備註記錄（Remark Record）—— 對真 Postgres（真 migration）。
 */
import { describe, expect, it } from "vitest";
import { logCall } from "../src/domain/calls.js";
import { getCompany, listCompanies } from "../src/domain/companies.js";
import { addRemark, deleteRemark, listRemarks } from "../src/domain/remarks.js";
import { makeCompany, useTestDb } from "./helpers/db.js";

const t = useTestDb();

describe("備註記錄", () => {
  it("加備註：剝走頭尾空白、寫低邊個、最新喺頂；getCompany 帶埋", async () => {
    const id = await makeCompany(t.sql);
    await addRemark(t.sql, id, "  a women pick up, dunno leo  ");
    await t.sql`update public.company_remarks set created_at = created_at - interval '1 day'`;
    await addRemark(t.sql, id, "前台話 Leo 放假", "mcp");
    const rows = await listRemarks(t.sql, id);
    expect(rows.map((r) => [r.body, r.author, r.source])).toEqual([
      ["前台話 Leo 放假", "Claude", "mcp"],
      ["a women pick up, dunno leo", "Kevin", "web"],
    ]);
    expect((await getCompany(t.sql, id))!.remarks.map((r) => r.body)).toEqual(["前台話 Leo 放假", "a women pick up, dunno leo"]);
  });

  it("空白備註、搵唔到公司 → 錯，乜都冇寫", async () => {
    const id = await makeCompany(t.sql);
    await expect(addRemark(t.sql, id, "   ")).rejects.toThrow(/要寫嘢/);
    await expect(addRemark(t.sql, "00000000-0000-0000-0000-000000000000", "x")).rejects.toThrow(/搵唔到呢間公司/);
    expect((await listRemarks(t.sql, id)).length).toBe(0);
  });

  it("加同刪都入 audit_log；刪咗原文喺 audit 查得返", async () => {
    const id = await makeCompany(t.sql);
    const r = await addRemark(t.sql, id, "called 9872 1105, no pick up");
    await deleteRemark(t.sql, r.id);
    expect((await listRemarks(t.sql, id)).length).toBe(0);
    const a = await t.sql<{ action: string; before: { body: string } | null }[]>`
      select action, before from public.audit_log where record_id = ${r.id} order by id`;
    expect(a.map((x) => x.action)).toEqual(["add_remark", "delete_remark"]);
    expect(a[1]!.before!.body).toBe("called 9872 1105, no pick up");
  });

  it("DB 自己都擋空白備註（唔靠 JS）", async () => {
    const id = await makeCompany(t.sql);
    await expect(t.sql`insert into public.company_remarks (company_id, body) values (${id}, '  ')`).rejects.toThrow(/check/);
  });
});

describe("公司清單嘅「最新一條」", () => {
  it("有日期嘅（手寫備註、有內容嘅電話）邊個新出邊個；名單匯入嗰幾條冇日期，排最後、合埋一句", async () => {
    const { listCompanies } = await import("../src/domain/companies.js");
    const { logCall } = await import("../src/domain/calls.js");
    const id = await makeCompany(t.sql);
    await t.sql`insert into public.company_remarks (company_id, body, author, source) values
      (${id}, 'no one answer, emailed', '名單匯入', 'import'),
      (${id}, '聯絡人／補充跟進：Mr Wong', '名單匯入', 'import')`;
    const pick = async () => (await listCompanies(t.sql, { id }, 5, 0)).rows[0]!.last_note;
    expect(await pick()).toMatchObject({ kind: "import", text: "no one answer, emailed · 聯絡人／補充跟進：Mr Wong", at: null });

    await logCall(t.sql, { companyId: id, outcome: "沒有人接" }); // 冇內容嘅電話唔算
    expect((await pick())!.kind).toBe("import");

    await logCall(t.sql, { companyId: id, outcome: "需要跟進", content: "IT 經理陳生" });
    expect(await pick()).toMatchObject({ kind: "call", text: "IT 經理陳生", outcome: "需要跟進" });

    await addRemark(t.sql, id, "前台話陳生放假");
    expect(await pick()).toMatchObject({ kind: "remark", text: "前台話陳生放假", author: "Kevin" });

    // 「顯示所有備註」：全部都出，新嘅行先；冇內容嘅電話都出（第幾次・結果）；名單匯入最尾、補充跟進排喺結果後面
    const hist = (await listCompanies(t.sql, { id }, 5, 0)).rows[0]!.history!;
    expect(hist.map((h) => [h.kind, h.text, h.outcome ?? null, h.attempt_no ?? null])).toEqual([
      ["remark", "前台話陳生放假", null, null],
      ["call", "IT 經理陳生", "需要跟進", 2],
      ["call", null, "沒有人接", 1],
      ["import", "no one answer, emailed", null, null],
      ["import", "聯絡人／補充跟進：Mr Wong", null, null],
    ]);

    // id 篩選：淨係出嗰一間
    const other = await makeCompany(t.sql);
    const one = await listCompanies(t.sql, { id: other }, 50, 0);
    expect([one.total, one.rows.map((r) => r.id), one.rows[0]!.last_note]).toEqual([1, [other], null]);
  });
});

describe("全站搜尋（Kevin 2026-10-16「全部頁面都要加全站search」）", () => {
  it("搵聯絡人個名（空格唔理）、聯絡人手提（有空格都得）、聯絡人電郵，都搵到佢間公司", async () => {
    const { addContact, listCompanies } = await import("../src/domain/companies.js");
    const id = await makeCompany(t.sql);
    await addContact(t.sql, id, { name: "Kenneth Wong", phone: "9123 4567", email: "kenneth@sustain.example" });
    const hit = async (q: string) => (await listCompanies(t.sql, { q }, 10, 0)).rows.map((r) => r.id);
    expect(await hit("kennethwong")).toContain(id);
    expect(await hit("91234567")).toContain(id);
    expect(await hit("9123 45")).toContain(id);
    expect(await hit("kenneth@sustain")).toContain(id);
    expect(await hit("Kenneth Lee")).not.toContain(id);
  });
});

describe("搜尋搵到備註記錄（Kevin 2026-10-16「備註記錄 也要search到出來」）", () => {
  it("手寫備註、名單匯入備註、電話內容都搜到；無視空格大細楷；電話號碼寫喺備註都得；唔中嘅唔出", async () => {
    const a = await makeCompany(t.sql);
    const b = await makeCompany(t.sql);
    const c = await makeCompany(t.sql);
    const none = await makeCompany(t.sql);
    await addRemark(t.sql, a, "前台話 Kelvin 去咗旅行，下星期再打");
    await t.sql`insert into public.company_remarks (company_id, body, author, source) values (${b}, '漢基 9771 3311 call me tmr', '名單匯入', 'import')`;
    await logCall(t.sql, { companyId: c, outcome: "需要跟進", content: "IT Manager Bosco 話年尾約滿" });
    const ids = async (q: string) => (await listCompanies(t.sql, { q }, 50)).rows.map((r) => r.id);
    expect(await ids("kelvin去咗旅行")).toEqual([a]);
    expect(await ids("CALL ME TMR")).toEqual([b]);
    expect(await ids("97713311")).toEqual([b]);
    expect(await ids("年尾約滿")).toEqual([c]);
    expect(await ids("bosco")).toEqual([c]);
    expect(await ids("去咗旅行")).not.toContain(none);
    // 篩選照樣疊得上：冷電名單 ＋ 備註字
    await t.sql`update public.companies set status = '不需要' where id = ${a}`;
    expect((await listCompanies(t.sql, { q: "kelvin去咗旅行", cold: true }, 50)).total).toBe(0);
  });
});
