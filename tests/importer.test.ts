/**
 * 公司匯入 —— 對真 Postgres（真 migration）。
 * 欄名 fixture 抄自上次整嘅兩份真 call list（builderhk、黃頁 IoT），唔係憑印象打。
 */
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { commitImport, loadExisting, mapHeaders, planImport, readTable } from "../src/domain/importer.js";
import { makeCompany, useTestDb } from "./helpers/db.js";

const t = useTestDb();
const csv = (s: string) => Buffer.from(s, "utf8");

describe("欄名對照", () => {
  it("builderhk 份 call list 十個欄全部認得", () => {
    const { mapping, unmapped } = mapHeaders(
      ["中文名", "英文名", "總機", "中文地址", "英文地址", "傳真", "網站", "email", "行業桶", "分類"]);
    expect(mapping).toEqual(
      ["name_zh", "name_en", "phone", "address_zh", "address_en", "fax", "website", "email", "industry", "notes"]);
    expect(unmapped).toEqual([]);
  });

  it("黃頁 IoT 份：公司名、段（做行業）、黃頁分類（落備註）", () => {
    const { mapping } = mapHeaders(["公司名", "總機", "傳真", "地址", "網站", "段", "其他段", "黃頁分類"]);
    expect(mapping).toEqual(["name", "phone", "fax", "address", "website", "industry", "notes", "notes"]);
  });

  it("電話1、電話 2、Tel (Office) 都係電話；認唔到嘅欄列出嚟", () => {
    const { mapping, unmapped } = mapHeaders(["電話1", "電話 2", "Tel", "負責同事", ""]);
    expect(mapping).toEqual(["phone", "phone", "phone", null, null]);
    expect(unmapped).toEqual(["負責同事"]);
  });
});

describe("計劃（未寫入）", () => {
  it("一格幾個電話／電郵照拆，傳真欄標傳真，認唔到嘅欄寫落備註唔丟", async () => {
    const table = await readTable(csv(
      "﻿中文名,英文名,總機,傳真,email,分類,負責同事\n" +
      "甲工程有限公司,Kap Engineering Ltd,2345 6789 / 9123 4567,2345 6790,a@kap.hk; mailto:b%40kap.hk,機電工程,阿明\n"),
      "list.csv");
    const plan = planImport(table, { byName: new Map(), byPhone: new Map() });
    const r = plan.rows[0]!;
    expect(r.action).toBe("new");
    expect(r.phones).toEqual([
      { phone: "23456789", label: "總機", raw: "2345 6789" },
      { phone: "91234567", label: "總機", raw: "9123 4567" },
      { phone: "23456790", label: "傳真", raw: "2345 6790" },
    ]);
    expect(r.emails).toEqual(["a@kap.hk", "b@kap.hk"]);
    expect(r.company.notes).toBe("分類：機電工程\n【原欄】負責同事：阿明");
    expect(plan.unmapped).toEqual(["負責同事"]);
  });

  it("「公司名」一欄：有中文當中文名，冇中文當英文名", async () => {
    const table = await readTable(csv("公司名,總機\n亞太保安服務有限公司,23229972\nCassius Group Limited,31019800\n"), "x.csv");
    const plan = planImport(table, { byName: new Map(), byPhone: new Map() });
    expect(plan.rows[0]!.company).toMatchObject({ name_zh: "亞太保安服務有限公司" });
    expect(plan.rows[0]!.company.name_en).toBeUndefined();
    expect(plan.rows[1]!.company).toMatchObject({ name_en: "Cassius Group Limited" });
  });

  it("「中文名」欄其實係英文：冇英文名就搬過去；同英文名一樣就唔留兩份", async () => {
    const table = await readTable(csv(
      "中文名,英文名\nMaster Builders Solutions HK Limited,Master Builders Solutions HK Limited\nAcme Ltd,\n甲公司,Kap Co\n守望工程公司,守望工程公司\n"), "x.csv");
    const plan = planImport(table, { byName: new Map(), byPhone: new Map() });
    expect(plan.rows[0]!.company.name_zh).toBeUndefined();
    expect(plan.rows[0]!.company.name_en).toBe("Master Builders Solutions HK Limited");
    expect(plan.rows[1]!.company).toMatchObject({ name_en: "Acme Ltd" });
    expect(plan.rows[1]!.company.name_zh).toBeUndefined();
    expect(plan.rows[2]!.company).toMatchObject({ name_zh: "甲公司", name_en: "Kap Co" });
    expect(plan.rows[3]!.company).toMatchObject({ name_zh: "守望工程公司" });
    expect(plan.rows[3]!.company.name_en).toBeUndefined();
  });

  it("檔案入面同名（Ltd／Limited、大細楷、空格唔同）→ 併入第一行，電話一齊收", async () => {
    const table = await readTable(csv(
      "英文名,總機\nABC Engineering Ltd,23456789\nabc  engineering limited,23456790\n"), "x.csv");
    const plan = planImport(table, { byName: new Map(), byPhone: new Map() });
    expect(plan.rows[1]!.reason).toBe("檔案入面重複，併入第 2 行");
    expect(plan.rows[0]!.phones.map((p) => p.phone)).toEqual(["23456789", "23456790"]);
    expect(plan.counts).toMatchObject({ total: 2, new: 1, mergedInFile: 1 });
  });

  it("冇名嗰行唔入；名剝完淨係「有限公司」都唔當鎖匙（'' 唔准撞 ''）", async () => {
    const table = await readTable(csv("中文名,總機\n,23456789\n有限公司,23456790\n公司,23456791\n"), "x.csv");
    const plan = planImport(table, { byName: new Map(), byPhone: new Map() });
    expect(plan.rows[0]!.reason).toBe("冇公司名");
    // 兩行都係「冇鎖匙」，唔可以互相當孖生併埋
    expect(plan.rows[1]!.action).toBe("new");
    expect(plan.rows[2]!.action).toBe("new");
  });

  it("認唔到嘅電話（澳門號、1 字頭）講原因，原文落備註唔丟", async () => {
    const table = await readTable(csv("中文名,總機\n乙公司,1234 5678\n"), "x.csv");
    const plan = planImport(table, { byName: new Map(), byPhone: new Map() });
    expect(plan.rows[0]!.warnings.join()).toMatch(/1234 5678.*唔會 1 字頭/);
    expect(plan.rows[0]!.warnings.join()).toMatch(/冇電話又冇電郵/);
    expect(plan.rows[0]!.company.notes).toBe("【認唔到嘅電話】1234 5678");
  });
});

describe("Kevin 個整合名單（2026-10-15 版）—— 欄名同真檔一樣", () => {
  const H = "公司名稱,英文名／其他名稱,電話,聯絡結果,聯絡人／補充跟進,已成功Email,一般電郵,ESG電郵,中文地址／地址,傳真,行業桶\n";

  it("十一個欄全部認得：英文名／其他名稱、中文地址／地址、三個電郵欄、聯絡結果、補充跟進", () => {
    const { mapping, unmapped } = mapHeaders(H.trim().split(","));
    expect(mapping).toEqual(["name", "name_en", "phone", "result", "followup", "email", "email", "email", "address", "fax", "industry"]);
    expect(unmapped).toEqual([]);
  });

  it("聯絡結果：認到嘅改狀態、原文入備註；認唔到嘅唔郁（未打）、列出嚟；未核實唔當電話", async () => {
    const table = await readTable(csv(H +
      "鼎峰工程有限公司,,2345 0001,\"no need , emailed\",,,a@df.hk,,,,A\n" +
      "鼎峰機械工程有限公司,,2345 0002,\"close,emailed\",,,,,,,A\n" +
      "齊記工程有限公司,,2345 0003,\"no one answer, emailed\",Mr Wong(IT),,,,,,A\n" +
      "VETRACKR LIMITED,,2345 0004,billing,,,,,,,B\n" +
      "天保工程服務公司,,未核實,,,,,,,未核實,C\n" +
      ",,,14/10,,,,,,,\n"), "x.csv");
    const plan = planImport(table, { byName: new Map(), byPhone: new Map() });
    const [a, b, c, d, e, marker] = plan.rows;
    expect([a!.company.status, b!.company.status, c!.company.status, d!.company.status, e!.company.status])
      .toEqual(["不需要", "已結業", "跟進中", "其他人跟進", undefined]);
    expect(d!.company.followed_by).toBe("現時客戶"); // billing ＝ 現時客戶
    expect(c!.remarks).toEqual(["no one answer, emailed", "聯絡人／補充跟進：Mr Wong(IT)"]);
    expect(d!.remarks).toEqual(["billing"]);
    expect(plan.unknownResults).toEqual([]);
    expect(plan.byStatus).toEqual({ 不需要: 1, 已結業: 1, 跟進中: 1, 其他人跟進: 1, 未打: 1 });
    // 「未核實」唔係認唔到嘅號碼，係冇號碼：唔出警告、唔落備註
    expect(e!.phones).toEqual([]);
    expect(e!.warnings.join()).not.toMatch(/未核實/);
    expect(marker!.reason).toBe("冇公司名"); // 日子分隔行：Kevin 話唔準，唔用
  });

  it("❗同中文名但英文名唔同 ＝ 兩間公司，唔併（建輝工程公司 Kin Fai ≠ 建輝工程有限公司 Kingford）", async () => {
    const table = await readTable(csv(H +
      "建輝工程公司,Kin Fai Construction,9128 4073,\"no one answer, emailed\",,,,,,,C\n" +
      "建輝工程有限公司,Kingford Engineering Limited,2396 4388,\"no need , emailed\",,,,,,,E\n" +
      // 冇電話嗰行：電話規則幫唔到手，淨係靠英文名唔同分開
      "建輝工程公司,Kingford Engineering Limited,,,,,,,,,E\n" +
      "建輝工程有限公司,Kin Fai Construction Co,,,,,,,,,E\n"), "x.csv");
    const plan = planImport(table, { byName: new Map(), byPhone: new Map() });
    expect(plan.rows.map((r) => [r.action, r.company.status])).toEqual([["new", "跟進中"], ["new", "不需要"], ["skip", undefined], ["skip", undefined]]);
    // 冇電話嗰兩行跟英文名歸返啱嗰間，唔會因為中文名一樣就亂併
    expect([plan.rows[2]!.reason, plan.rows[3]!.reason]).toEqual(["檔案入面重複，併入第 3 行", "檔案入面重複，併入第 2 行"]);
  });

  it("❗名似但冇共同電話、又唔係「加有限公司」嗰種 → 兩間，出警告（祥興工程公司 vs 祥興工程有限公司）", async () => {
    const table = await readTable(csv(H +
      "祥興工程公司,Cheung Hing Construction Company,2436 2738,,,,,,,,A\n" +
      "祥興工程有限公司,,2114 0500,,,,,,,,A\n"), "x.csv");
    const plan = planImport(table, { byName: new Map(), byPhone: new Map() });
    expect(plan.rows.map((r) => r.action)).toEqual(["new", "new"]);
    expect(plan.rows[1]!.warnings.join()).toMatch(/同第 2 行名似但冇共同電話/);
  });

  it("上市公司簡稱 ／ 全名（信和置業 ／ 信和置業有限公司）照併；第一行未打過、第二行有結果 → 用第二行嘅", async () => {
    const table = await readTable(csv(H +
      "信和置業,,+852 2132 8480,,,,,,,,港股\n" +
      "信和置業有限公司,Sino Land Company Limited,2721 8388,\"no need, emailed\",,,,,,,港股\n"), "x.csv");
    const plan = planImport(table, { byName: new Map(), byPhone: new Map() });
    expect(plan.rows[1]!.reason).toBe("檔案入面重複，併入第 2 行");
    expect(plan.rows[0]!.company.status).toBe("不需要");
    expect(plan.rows[0]!.remarks).toEqual(["no need, emailed"]);
    expect(plan.rows[0]!.phones.map((p) => p.phone)).toEqual(["21328480", "27218388"]);
  });

  it("❗全形英文名唔可以剝剩「集團」撞埋一齊（ＧＢＡ集團 ≠ ＴＯＭ集團）", async () => {
    // ＯＳＬ集團喺真檔冇電話 —— 電話規則幫唔到手，淨係靠個名分
    const table = await readTable(csv(H + "ＧＢＡ集團,,2865 0078,,,,,,,,港股\nＯＳＬ集團,,,,,,,,,,港股\n"), "x.csv");
    const plan = planImport(table, { byName: new Map(), byPhone: new Map() });
    expect(plan.rows.map((r) => r.action)).toEqual(["new", "new"]);
  });

  it("寫入：狀態落公司、原文落備註記錄（source=import、名單匯入）", async () => {
    const table = await readTable(csv(H +
      "匯入甲工程有限公司,,2999 0001,\"dead, emailed\",Mr Chan,,,,,,A\n" +
      "匯入乙工程有限公司,,2999 0002,,,,,,,,A\n" +
      "匯入丙工程有限公司,,2999 0003,ex alvin,,,,,,,A\n"), "x.csv");
    const plan = planImport(table, await loadExisting(t.sql));
    await commitImport(t.sql, plan, "list.xlsx", "test", "2026-10-16");
    const rows = await t.sql<{ name_zh: string; status: string; followed_by: string | null; remarks: { body: string; source: string; author: string }[] | null }[]>`
      select c.name_zh, c.status, c.followed_by,
             (select json_agg(json_build_object('body', r.body, 'source', r.source, 'author', r.author) order by r.body)
                from public.company_remarks r where r.company_id = c.id) as remarks
        from public.companies c where c.name_zh like '匯入%' order by c.name_zh`;
    expect(rows).toEqual([
      { name_zh: "匯入丙工程有限公司", status: "其他人跟進", followed_by: "現時客戶", remarks: [
        { body: "ex alvin", source: "import", author: "名單匯入" },
      ] },
      { name_zh: "匯入乙工程有限公司", status: "未打", followed_by: null, remarks: null },
      { name_zh: "匯入甲工程有限公司", status: "唔通", followed_by: null, remarks: [ // dead → 唔通（Kevin 2026-10-16）
        { body: "dead, emailed", source: "import", author: "名單匯入" },
        { body: "聯絡人／補充跟進：Mr Chan", source: "import", author: "名單匯入" },
      ] },
    ]);
  });
});

describe("對返 CRM", () => {
  it("❗CRM 淨係有英文名、檔案有中英文 → 一樣認得係同一間（兩條鎖匙都試）", async () => {
    await makeCompany(t.sql, { name_zh: "", name_en: "Dragon Fly Engineering Co., Ltd." });
    const table = await readTable(csv("中文名,英文名\n飛龍工程有限公司,Dragon Fly Engineering Company Limited\n"), "x.csv");
    const plan = planImport(table, await loadExisting(t.sql));
    expect(plan.rows[0]!.action).toBe("skip");
    expect(plan.rows[0]!.reason).toMatch(/^已經有：GC-\d{5} Dragon Fly/);
  });

  it("電話撞咗但名唔同 → 預設唔入（共用總機）；剔咗「照入」先入", async () => {
    await makeCompany(t.sql, { name_zh: "南豐地產", phones: ["25217417"] });
    const table = await readTable(csv("中文名,總機\n南豐紡織,2521 7417\n"), "x.csv");
    const existing = await loadExisting(t.sql);
    const plan = planImport(table, existing);
    expect(plan.rows[0]!.reason).toMatch(/^電話撞咗 GC-\d{5} 南豐地產/);
    expect(plan.counts.existingPhone).toBe(1);
    expect(planImport(table, existing, { allowPhoneClash: true }).rows[0]!.action).toBe("new");
  });

  it("❗檔案入面孖生帶嚟嘅第二個電話撞 CRM，一樣捉到（併埋之後先查電話）", async () => {
    await makeCompany(t.sql, { name_zh: "丙集團", phones: ["27771111"] });
    const table = await readTable(csv("中文名,總機\n丁工程,2777 2222\n丁工程,2777 1111\n"), "x.csv");
    const plan = planImport(table, await loadExisting(t.sql));
    expect(plan.rows[0]!.action).toBe("skip");
    expect(plan.rows[0]!.reason).toMatch(/丙集團/);
  });
});

describe("寫入", () => {
  it("寫入公司、電話（傳真標返）、電郵、來源、audit；舊公司唔郁", async () => {
    const before = await t.sql<{ n: number }[]>`select count(*)::int as n from public.companies`;
    const table = await readTable(csv(
      "中文名,英文名,總機,傳真,email,中文地址,行業桶\n" +
      "戊建築有限公司,Mo Construction Ltd,2888 1234,2888 1235,info@mo.hk,觀塘道 1 號,A 工程／裝修\n" +
      "己裝修,,3999 0000,,,,\n"), "builderhk.csv");
    const plan = planImport(table, await loadExisting(t.sql));
    const res = await commitImport(t.sql, plan, "builderhk.csv", "test", "2026-10-14");
    expect(res.created).toBe(2);
    const [c] = await t.sql`select * from public.companies where code = ${res.firstCode}`;
    expect(c).toMatchObject({
      name_zh: "戊建築有限公司", name_en: "Mo Construction Ltd", address_zh: "觀塘道 1 號",
      industry: "A 工程／裝修", status: "未打", customer_type: "公司", source: "builderhk.csv（2026-10-14 匯入）",
    });
    const phones = await t.sql`select phone, label from public.company_phones where company_id = ${c!.id} order by sort`;
    expect(phones).toEqual([{ phone: "28881234", label: "總機" }, { phone: "28881235", label: "傳真" }]);
    const emails = await t.sql`select email from public.company_emails where company_id = ${c!.id}`;
    expect(emails).toEqual([{ email: "info@mo.hk" }]);
    const after = await t.sql<{ n: number }[]>`select count(*)::int as n from public.companies`;
    expect(after[0]!.n - before[0]!.n).toBe(2);
    const [a] = await t.sql`select actor, action, after from public.audit_log where action = 'import' order by at desc limit 1`;
    expect(a).toMatchObject({ actor: "test", action: "import" });
    expect((a!.after as { created: number }).created).toBe(2);
  });

  it("❗中途一行寫唔入 → 成批 rollback，唔留低半批", async () => {
    const table = await readTable(csv("中文名,總機\n庚公司,2111 1111\n辛公司,2111 2222\n"), "x.csv");
    const plan = planImport(table, await loadExisting(t.sql));
    // 第二行個電話改到違反 DB 規則（DB 會拒絕），模擬中途出事
    plan.rows[1]!.phones[0]!.phone = "1234";
    await expect(commitImport(t.sql, plan, "x.csv", "test", "2026-10-14")).rejects.toThrow();
    const rows = await t.sql`select 1 from public.companies where name_zh in ('庚公司', '辛公司')`;
    expect(rows.length).toBe(0);
  });

  it("全部都係 skip → 乜都唔寫", async () => {
    const res = await commitImport(t.sql, { headers: [], mapping: [], unmapped: [], rows: [],
      counts: { total: 0, new: 0, mergedInFile: 0, existingName: 0, existingPhone: 0, noName: 0 }, byStatus: {}, unknownResults: [], conflicts: [] }, "x.csv");
    expect(res).toEqual({ created: 0, firstCode: null, lastCode: null });
  });
});

describe("Excel", () => {
  it("讀 .xlsx：數字電話、hyperlink 電郵、空行、第一張空 sheet 都搞得掂", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("空");
    const ws = wb.addWorksheet("名單");
    ws.addRow(["中文名", "英文名", "總機", "email"]);
    ws.addRow(["壬公司", "Yam Co Ltd", 23456789, { text: "yam@yam.hk", hyperlink: "mailto:yam@yam.hk" }]);
    ws.addRow([]);
    ws.addRow(["癸公司", null, "852-2345-0000", null]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const table = await readTable(buf, "名單.xlsx");
    expect(table.sheet).toBe("名單");
    expect(table.headers).toEqual(["中文名", "英文名", "總機", "email"]);
    expect(table.rows).toEqual([["壬公司", "Yam Co Ltd", "23456789", "yam@yam.hk"], ["癸公司", "", "852-2345-0000", ""]]);
    const plan = planImport(table, { byName: new Map(), byPhone: new Map() });
    expect(plan.rows[1]!.phones[0]!.phone).toBe("23450000");
  });

  it("舊式 .xls 講明點做，唔扮讀到", async () => {
    await expect(readTable(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), "old.xls")).rejects.toThrow(/另存新檔/);
  });
});
