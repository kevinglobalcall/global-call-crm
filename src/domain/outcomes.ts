/**
 * 打完電話嘅結果掣 —— Kevin 張單嘅八粒，一個都唔改、次序都唔改：
 *   沒有人接 · 不需要 · 稍後再撥打 · 需要跟進 · 只接受電郵 · 已電郵 · 其他人跟進 · 幾點鐘再打
 * ＋ 第九粒「留聯絡」（Kevin 2026-10-16「加一個按鈕 留聯絡」）—— 加喺最尾，前面八粒次序唔郁。
 *
 * 每粒掣三樣嘢要講清楚：
 *   1. 算唔算「接通」（每日數）
 *   2. 要唔要開待辦（回撥／跟進／寄電郵），時間係必填、可填、定唔使
 *   3. 間公司個狀態變乜
 *
 * 純函數，冇 DB —— 每粒掣嘅行為由 tests/outcomes.test.ts 逐粒釘死。
 */

export const OUTCOMES = [
  "沒有人接",
  "不需要",
  "稍後再撥打",
  "需要跟進",
  "只接受電郵",
  "已電郵",
  "其他人跟進",
  "幾點鐘再打",
  "留聯絡",
] as const;

export type Outcome = (typeof OUTCOMES)[number];

export const COMPANY_STATUSES = ["未打", "跟進中", "不需要", "其他人跟進", "已成交", "已結業"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export type TaskKind = "回撥" | "跟進" | "寄電郵" | "到期提醒" | "其他";

export interface OutcomeRule {
  /** 接通 ＝ 有人聽。沒有人接 唔算，其他全部算。 */
  connected: boolean;
  /** 打完要開邊種待辦；null ＝ 唔開（除非你自己揀咗時間）。 */
  task: TaskKind | null;
  /** 時間：required ＝ 唔揀唔畀存；optional ＝ 可揀可唔揀。 */
  time: "required" | "optional" | "none";
  /** 間公司變乜狀態。null ＝ 照舊（但未打嘅會變跟進中）。 */
  status: CompanyStatus | null;
  /** 一句講畀 Kevin 聽呢粒掣做咗乜。 */
  hint: string;
}

export const RULES: Record<Outcome, OutcomeRule> = {
  "沒有人接": {
    connected: false, task: null, time: "optional", status: null,
    hint: "唔算接通。想約時間再打就揀個時間，唔揀就留喺冷電名單。",
  },
  "不需要": {
    connected: true, task: null, time: "none", status: "不需要",
    hint: "間公司標「不需要」，冷電名單唔再出。",
  },
  "稍後再撥打": {
    connected: true, task: "回撥", time: "optional", status: null,
    hint: "開回撥提醒。揀咗時間就到時出；唔揀就喺今日回撥清單排最尾。",
  },
  "需要跟進": {
    connected: true, task: "跟進", time: "optional", status: null,
    hint: "開跟進提醒。",
  },
  "只接受電郵": {
    connected: true, task: "寄電郵", time: "optional", status: null,
    hint: "開「寄電郵」待辦，寄完撳「已電郵」再記一次。",
  },
  "已電郵": {
    connected: true, task: null, time: "optional", status: null,
    hint: "收咗「寄電郵」待辦。想跟返就揀個時間，會開跟進提醒。",
  },
  "其他人跟進": {
    connected: true, task: null, time: "none", status: "其他人跟進",
    hint: "要填邊個同事。呢間唔再出喺冷電名單（唔好撞同事單）。",
  },
  "幾點鐘再打": {
    connected: true, task: "回撥", time: "required", status: null,
    hint: "一定要揀時間，到時出喺今日回撥。",
  },
  // 有人聽（前台／秘書），留低咗聯絡等佢覆 —— 接通照 Kevin 嘅定義（唔係「沒有人接」就算）
  "留聯絡": {
    connected: true, task: null, time: "optional", status: null,
    hint: "留低咗聯絡等佢覆。想約時間再打就揀個時間（會開回撥）；唔揀就留喺冷電名單。",
  },
};

export function isOutcome(x: unknown): x is Outcome {
  return typeof x === "string" && (OUTCOMES as readonly string[]).includes(x);
}

/**
 * 呢粒掣要開邊種待辦。hasTime ＝ Kevin 有冇揀回撥時間。
 *   · 沒有人接 ＋ 揀咗時間 → 回撥（「4 點再打過」）
 *   · 已電郵 ＋ 揀咗時間 → 跟進（寄完約幾時再跟）
 */
export function taskFor(outcome: Outcome, hasTime: boolean): TaskKind | null {
  if (outcome === "沒有人接") return hasTime ? "回撥" : null;
  if (outcome === "已電郵") return hasTime ? "跟進" : null;
  if (outcome === "留聯絡") return hasTime ? "回撥" : null;
  return RULES[outcome].task;
}

/**
 * 打完之後間公司變乜狀態。
 *   · 掣本身有指定（不需要、其他人跟進）→ 照指定
 *   · 已成交嘅唔郁
 *   · 冇人接：淨係「未打」變「跟進中」（打過喇）；❗唔可以將「不需要」變返跟進中
 *   · 其他有人聽嘅 → 跟進中
 */
export function nextStatus(current: CompanyStatus, outcome: Outcome): CompanyStatus {
  const r = RULES[outcome];
  if (r.status) return r.status;
  if (current === "已成交") return current;
  if (!r.connected) return current === "未打" ? "跟進中" : current;
  return "跟進中";
}

/** 寫入之前驗：唔合規矩就 throw 講原因（DB 都有 check constraint 再保一次）。 */
export function validateCall(c: {
  outcome: unknown; callbackAt: Date | null; otherFollower: string | null; attemptNo: number | null;
}): void {
  if (!isOutcome(c.outcome)) throw new Error(`結果要係：${OUTCOMES.join("／")}`);
  const r = RULES[c.outcome];
  if (c.callbackAt !== null && (!(c.callbackAt instanceof Date) || Number.isNaN(c.callbackAt.getTime()))) {
    throw new Error("回撥時間認唔到");
  }
  if (r.time === "required" && c.callbackAt === null) throw new Error(`「${c.outcome}」一定要揀時間`);
  if (r.time === "none" && c.callbackAt !== null) throw new Error(`「${c.outcome}」唔使揀時間`);
  if (c.outcome === "其他人跟進" && !c.otherFollower?.trim()) throw new Error("「其他人跟進」要填邊個同事");
  if (c.attemptNo !== null && (!Number.isInteger(c.attemptNo) || c.attemptNo < 1)) {
    throw new Error("第幾次致電要係 1 或以上嘅整數");
  }
}
