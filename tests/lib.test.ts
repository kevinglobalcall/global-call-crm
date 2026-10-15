import { describe, expect, it } from "vitest";
import { readDatabaseUrl, sslFor } from "../src/db/client.js";
import { parseCsv, toCsv } from "../src/lib/csv.js";
import { formatPhone, labelFromText, normalizePhone, parsePhoneCell } from "../src/lib/phone.js";
import { blankToNull, escapeLike, nameKey, nospace } from "../src/lib/text.js";
import { addDays, assertDay, fmtHk, hkDayStart, hkToday, parseHkDateTime } from "../src/lib/time.js";

/**
 * 小工具：電話、時間、文字、CSV。每條都係 Equal CRM 撞過嘅坑。
 */

describe("電話", () => {
  it("8 位、+852、00852、全形數字都收；0／1 字頭唔收", () => {
    expect(normalizePhone("2345 6789").phone).toBe("23456789");
    expect(normalizePhone("+852 2345-6789").phone).toBe("23456789");
    expect(normalizePhone("00852 9123 4567").phone).toBe("91234567");
    expect(normalizePhone("２３４５６７８９").phone).toBe("23456789");
    expect(normalizePhone("1234 5678")).toMatchObject({ phone: null, reason: "香港號碼唔會 1 字頭" });
    expect(normalizePhone("2345 678").reason).toMatch(/得 7 位數/);
  });

  it("❗2–9 字頭都收（淨收 2/3/5/6/9 會丟咗 8 字頭、4 字頭號碼）", () => {
    expect(normalizePhone("8101 5722").phone).toBe("81015722");
    expect(normalizePhone("4612 3456").phone).toBe("46123456");
  });

  it("一格幾個號：/、逗號、或者都拆", () => {
    expect(parsePhoneCell("2345 6789 / 9876 5432").map((p) => p.phone)).toEqual(["23456789", "98765432"]);
    expect(parsePhoneCell("2345 6789, 2345 6790 或 3111 2222").map((p) => p.phone)).toEqual(["23456789", "23456790", "31112222"]);
  });

  it("❗每個號攞緊貼佢前面嘅標籤：「電話 2345 2219 傳真 2345 2259」唔可以兩個都當傳真", () => {
    expect(parsePhoneCell("電話 2345 2219 傳真 2345 2259").map((p) => [p.phone, p.label]))
      .toEqual([["23452219", "總機"], ["23452259", "傳真"]]);
    expect(parsePhoneCell("Tel: 2345 6789 Fax: 2345 6790").map((p) => p.label)).toEqual(["總機", "傳真"]);
  });

  it("標籤：傳真、手提、直線；內線剝走", () => {
    expect(parsePhoneCell("Fax: 2345 6790")[0]).toMatchObject({ phone: "23456790", label: "傳真" });
    expect(parsePhoneCell("手提 9123 4567")[0]!.label).toBe("手提");
    expect(parsePhoneCell("2345-6789 ext 12")[0]!.phone).toBe("23456789");
    expect(labelFromText("WhatsApp")).toBe("手提");
    expect(labelFromText("", "傳真")).toBe("傳真");
  });

  it("認唔到嘅號講原因，唔靜靜雞丟", () => {
    const [p] = parsePhoneCell("(853) 2878 1234");
    expect(p!.phone).toBeNull();
    expect(p!.reason).toMatch(/位數/);
    expect(formatPhone("23456789")).toBe("2345 6789");
  });
});

describe("時間（香港）", () => {
  it("❗香港凌晨 00:30 ＝ UTC 前一日 16:30 —— 今日要係香港嗰日", () => {
    expect(hkToday(new Date("2026-10-13T16:30:00Z"))).toBe("2026-10-14");
    expect(hkToday(new Date("2026-10-14T15:59:00Z"))).toBe("2026-10-14");
    expect(hkDayStart("2026-10-14").toISOString()).toBe("2026-10-13T16:00:00.000Z");
  });

  it("日子加減、唔存在嘅日子要捉", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(() => assertDay("2026-02-30")).toThrow(/冇呢日/);
    expect(() => assertDay("2026/10/14")).toThrow();
  });

  it("「2026-10-20 15:00」當香港時間；有時區就跟時區；亂打就錯", () => {
    expect(parseHkDateTime("2026-10-20 15:00").toISOString()).toBe("2026-10-20T07:00:00.000Z");
    expect(parseHkDateTime("2026-10-20T15:00").toISOString()).toBe("2026-10-20T07:00:00.000Z");
    expect(parseHkDateTime("2026-10-20T07:00:00Z").toISOString()).toBe("2026-10-20T07:00:00.000Z");
    expect(() => parseHkDateTime("聽日三點")).toThrow(/認唔到/);
    expect(() => parseHkDateTime("2026-10-20 25:00")).toThrow(/冇呢個鐘數/);
  });

  it("顯示：日期連星期（一眼捉到錯日）", () => {
    expect(fmtHk(new Date("2026-10-20T07:00:00Z"))).toBe("10/20（二）15:00");
    expect(fmtHk("2026-10-14T16:30:00Z", false)).toBe("10/15（四）");
    expect(fmtHk(null)).toBe("");
  });
});

describe("文字", () => {
  it("搜尋無視空格（全形空格都算）", () => {
    expect(nospace(" 大 發　物流 ")).toBe("大發物流");
    expect(nospace("ABC  Co")).toBe("abcco");
  });

  it("公司名鎖匙：Ltd／Limited／有限公司 剝走；& 當 and；❗Tesco 唔可以剝咗 co", () => {
    expect(nameKey("ABC Engineering Ltd.")).toBe(nameKey("abc engineering limited"));
    expect(nameKey("A. King Maintenance & Engineering Ltd")).toBe(nameKey("A King Maintenance and Engineering Limited"));
    expect(nameKey("Tesco")).toBe("tesco");
    expect(nameKey("大發物流有限公司")).toBe("大發物流");
  });

  it("❗剝完冇嘢就回 \"\"（caller 唔准當鎖匙）", () => {
    expect(nameKey("有限公司")).toBe("");
    expect(nameKey(null)).toBe("");
  });

  it("LIKE 嘅 % _ 要 escape；空字串當冇", () => {
    expect(escapeLike("50%_off")).toBe("50\\%\\_off");
    expect(blankToNull("  ")).toBeNull();
    expect(blankToNull(" x ")).toBe("x");
  });
});

describe("CSV", () => {
  it("引號、引號入面嘅逗號同斷行、BOM 都識", () => {
    const t = parseCsv('﻿中文名,備註\n"大發, 物流","第一行\n第二行 ""引號"""\n乙公司,\n');
    expect(t.headers).toEqual(["中文名", "備註"]);
    expect(t.rows).toEqual([["大發, 物流", '第一行\n第二行 "引號"'], ["乙公司", ""]]);
  });

  it("tab 分隔都認得", () => {
    expect(parseCsv("a\tb\n1\t2\n").rows).toEqual([["1", "2"]]);
  });

  it("寫：開頭有 BOM（Excel 開中文唔會亂碼），要 quote 嘅會 quote", () => {
    const s = toCsv(["名", "備註"], [["大發", 'a,"b"']]);
    expect(s.charCodeAt(0)).toBe(0xfeff);
    expect(s.slice(1)).toBe('名,備註\r\n大發,"a,""b"""\r\n');
  });
});

describe("DB 連線 TLS", () => {
  it("Supabase pooler（冇寫 sslmode）一定 require；本機唔使；網址寫咗就跟網址", () => {
    expect(sslFor("postgresql://postgres.abc:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres")).toBe("require");
    expect(sslFor("postgresql://postgres@127.0.0.1:55432/postgres")).toBe(false);
    expect(sslFor("postgresql://postgres@localhost/postgres")).toBe(false);
    expect(sslFor("postgresql://u:p@db.example.com/x?sslmode=verify-full")).toBeUndefined();
  });

  it("❗密碼有符號解唔到 → 拋錯，但錯誤訊息唔准帶密碼（public repo 嘅 log 會漏）", () => {
    const secret = "pX^J*z5%kV8&#tail";
    const bad = [
      `postgresql://postgres.abc:${secret}@aws-0.pooler.supabase.com:5432/postgres`,
      "postgresql://postgres.abc:pX^J*z5%kV8&", // Fly 個 dotenv 食咗 # 之後嘅樣
    ];
    for (const url of bad) {
      for (const f of [() => readDatabaseUrl({ DATABASE_URL: url }), () => sslFor(url)]) {
        let msg = "";
        try { f(); } catch (e) { msg = String(e instanceof Error ? e.message + (e as { input?: string }).input : e); }
        expect(msg).toMatch(/淨係英文字母＋數字/);
        expect(msg).not.toContain("pX^J");
        expect(msg).not.toContain("postgres.abc");
      }
    }
    const good = "postgresql://postgres.abc:Abc123xyz@aws-0.pooler.supabase.com:5432/postgres";
    expect(readDatabaseUrl({ DATABASE_URL: good })).toBe(good);
    expect(sslFor("postgres:///gc?host=/tmp")).toBe(false);
  });
});
