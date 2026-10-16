/**
 * 「聯絡結果」→ 狀態。每條規則都係 Kevin 2026-10-16 親口拍板嘅（見 src/domain/contact-result.ts）；
 * fixture 全部抄自佢 2026-10-15 版整合公司名單嘅原文（連錯字），唔係自己作。
 */
import { describe, expect, it } from "vitest";
import { classifyResult } from "../src/domain/contact-result.js";

const st = (t: string) => classifyResult(t)?.status ?? null;

describe("聯絡結果 → 狀態（淨係 Kevin 拍板咗嘅）", () => {
  it("no need／not interest（連錯字、多空格）→ 不需要", () => {
    for (const t of ["no need", "no need, emailed", "no need , emailed", "no need, emaied", "not Interest, emailed", "on need, emailed"]) {
      expect([t, st(t)]).toEqual([t, "不需要"]);
    }
  });

  it("dead／phone dead／cut line → 不需要（Kevin：唔再出冷電名單）", () => {
    for (const t of ["dead", "dead , emailed", "phone dead, emailed", "cut line, emailed"]) expect([t, st(t)]).toEqual([t, "不需要"]);
  });

  it("close／永久停業 → 已結業；❗「close,emailed」唔可以俾 emailed 嗰條食咗", () => {
    for (const t of ["close", "close,emailed", "close , emailed", "永久停業"]) expect([t, st(t)]).toEqual([t, "已結業"]);
  });

  it("打過未有結論 → 跟進中", () => {
    for (const t of ["no one answer", "one ring , emailed", "vm, emailed", "no one answer, left vm, emailed",
      "left contact call bk, emailed", "call tmr", "in meeting call tmr at 10 am", "on phone, will call bk",
      "not in office, left conact ask to call bk", "wts", "ask to wts , emailed", "email only, emailed",
      "ask to email, emailed", "emailed", "emiled", "emailed new"]) {
      expect([t, st(t)]).toEqual([t, "跟進中"]);
    }
  });

  it("❗認唔到就回 null（唔估）—— 呢啲係 Kevin 要逐個答嘅", () => {
    for (const t of ["billing", "fax, emailed", "ex alvin", "amy wong", "JU", "ow msg, emailed", "97713311, emailed",
      "2 weeks hoilday, emailed", "interest esg, emailed", "客戶自己sim , emailed", "next week", "2026-10-30", "14/10", "", "  "]) {
      expect([t, classifyResult(t)]).toEqual([t, null]);
    }
  });
});
