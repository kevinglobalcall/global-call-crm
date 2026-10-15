/**
 * 八粒掣逐粒釘死：接唔接通、開乜待辦、時間必唔必填、公司變乜狀態。
 * 純函數，唔使 DB。
 */
import { describe, expect, it } from "vitest";
import { nextStatus, OUTCOMES, RULES, taskFor, validateCall, isOutcome } from "../src/domain/outcomes.js";

describe("八粒掣", () => {
  it("名同次序照 Kevin 張單，一個都唔改", () => {
    expect([...OUTCOMES]).toEqual([
      "沒有人接", "不需要", "稍後再撥打", "需要跟進", "只接受電郵", "已電郵", "其他人跟進", "幾點鐘再打",
    ]);
  });

  it("逐粒：接通、待辦、時間、狀態", () => {
    const table = OUTCOMES.map((o) => [o, RULES[o].connected, RULES[o].task, RULES[o].time, RULES[o].status]);
    expect(table).toEqual([
      ["沒有人接", false, null, "optional", null],
      ["不需要", true, null, "none", "不需要"],
      ["稍後再撥打", true, "回撥", "optional", null],
      ["需要跟進", true, "跟進", "optional", null],
      ["只接受電郵", true, "寄電郵", "optional", null],
      ["已電郵", true, null, "optional", null],
      ["其他人跟進", true, null, "none", "其他人跟進"],
      ["幾點鐘再打", true, "回撥", "required", null],
    ]);
  });

  it("每粒掣都有一句講畀 Kevin 聽做咗乜", () => {
    for (const o of OUTCOMES) expect(RULES[o].hint.length).toBeGreaterThan(5);
  });

  it("isOutcome 淨係認八粒", () => {
    expect(isOutcome("需要跟進")).toBe(true);
    expect(isOutcome("需要 跟進")).toBe(false);
    expect(isOutcome(undefined)).toBe(false);
  });
});

describe("taskFor", () => {
  it("沒有人接：揀咗時間先開回撥", () => {
    expect(taskFor("沒有人接", false)).toBeNull();
    expect(taskFor("沒有人接", true)).toBe("回撥");
  });
  it("已電郵：揀咗時間就開跟進（寄完約幾時再跟）", () => {
    expect(taskFor("已電郵", false)).toBeNull();
    expect(taskFor("已電郵", true)).toBe("跟進");
  });
  it("其他照規則：稍後再撥打 → 回撥（時間有冇都開）", () => {
    expect(taskFor("稍後再撥打", false)).toBe("回撥");
    expect(taskFor("只接受電郵", false)).toBe("寄電郵");
    expect(taskFor("不需要", false)).toBeNull();
  });
});

describe("nextStatus", () => {
  it("不需要／其他人跟進：照掣", () => {
    expect(nextStatus("跟進中", "不需要")).toBe("不需要");
    expect(nextStatus("未打", "其他人跟進")).toBe("其他人跟進");
  });
  it("❗沒有人接唔可以將「不需要」變返跟進中；未打就變跟進中", () => {
    expect(nextStatus("不需要", "沒有人接")).toBe("不需要");
    expect(nextStatus("未打", "沒有人接")).toBe("跟進中");
    expect(nextStatus("其他人跟進", "沒有人接")).toBe("其他人跟進");
  });
  it("已成交嘅唔郁（打去跟單唔會變返跟進中）", () => {
    expect(nextStatus("已成交", "需要跟進")).toBe("已成交");
    expect(nextStatus("已成交", "沒有人接")).toBe("已成交");
  });
  it("有人聽 → 跟進中（之前話不需要，今次肯傾都係）", () => {
    expect(nextStatus("不需要", "需要跟進")).toBe("跟進中");
    expect(nextStatus("未打", "稍後再撥打")).toBe("跟進中");
  });
});

describe("validateCall", () => {
  const ok = { callbackAt: null, otherFollower: null, attemptNo: null };
  const t = new Date("2026-10-20T07:00:00Z");
  it("幾點鐘再打一定要有時間", () => {
    expect(() => validateCall({ ...ok, outcome: "幾點鐘再打" })).toThrow(/一定要揀時間/);
    expect(() => validateCall({ ...ok, outcome: "幾點鐘再打", callbackAt: t })).not.toThrow();
  });
  it("不需要／其他人跟進唔可以有時間", () => {
    expect(() => validateCall({ ...ok, outcome: "不需要", callbackAt: t })).toThrow(/唔使揀時間/);
    expect(() => validateCall({ ...ok, outcome: "其他人跟進", otherFollower: "阿明", callbackAt: t })).toThrow(/唔使揀時間/);
  });
  it("其他人跟進要填同事名（淨係空格唔算）", () => {
    expect(() => validateCall({ ...ok, outcome: "其他人跟進", otherFollower: "  " })).toThrow(/同事/);
    expect(() => validateCall({ ...ok, outcome: "其他人跟進", otherFollower: "阿明" })).not.toThrow();
  });
  it("第幾次要係 1 或以上整數；亂打結果唔收", () => {
    expect(() => validateCall({ ...ok, outcome: "需要跟進", attemptNo: 0 })).toThrow(/第幾次/);
    expect(() => validateCall({ ...ok, outcome: "需要跟進", attemptNo: 1.5 })).toThrow(/第幾次/);
    expect(() => validateCall({ ...ok, outcome: "傾咗好耐" })).toThrow(/結果要係/);
  });
});
