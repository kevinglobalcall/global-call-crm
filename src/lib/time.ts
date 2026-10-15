/**
 * 香港時間。container 個鐘行 UTC，香港 +8：凌晨 0–8 點 UTC 仲係前一日。
 *
 * ❗「今日」一律 hkToday()，唔准 `new Date().toISOString().slice(0, 10)`（Equal CRM 中過：
 *   成張表凌晨計少一日）。食日子嘅 function 一律收 today 參數，測試釘死，唔跟真時鐘。
 * 香港冇夏令時間，+08:00 固定。
 */

const HK_OFFSET_MS = 8 * 3600_000;

/** 香港今日，「2026-10-14」。 */
export function hkToday(now: Date = new Date()): string {
  return new Date(now.getTime() + HK_OFFSET_MS).toISOString().slice(0, 10);
}

/** 香港嗰日 00:00 嘅時刻（SQL 用嚟夾 `>= 呢日 and < 第二日`）。 */
export function hkDayStart(day: string): Date {
  assertDay(day);
  return new Date(`${day}T00:00:00+08:00`);
}

/** 日子加減（純日曆，同時區無關）。 */
export function addDays(day: string, n: number): string {
  assertDay(day);
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 「2026-02-30」呢啲唔存在嘅日子都要捉 —— JS Date 會靜靜雞變 3 月 2 號。 */
export function assertDay(day: string): void {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`日子要寫「2026-10-14」噉：「${String(day)}」`);
  }
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) {
    throw new Error(`冇呢日：「${day}」`);
  }
}

/**
 * 香港本地時間字串 → 時刻。收：
 *   「2026-10-20 15:00」「2026-10-20T15:00」（當香港時間）
 *   有時區嘅 ISO（「2026-10-20T07:00:00Z」「…+08:00」）照收。
 * 認唔到就 throw —— 回撥時間錯咗，個提醒會喺錯嘅時間出（或者永遠唔出）。
 */
export function parseHkDateTime(s: string): Date {
  const t = String(s ?? "").trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(t)) {
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) throw new Error(`時間認唔到：「${t}」`);
    return d;
  }
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (!m) throw new Error(`時間認唔到：「${t}」（要「2026-10-20 15:00」噉寫）`);
  assertDay(m[1]!);
  const hh = Number(m[2]);
  const mm = Number(m[3]);
  if (hh > 23 || mm > 59) throw new Error(`冇呢個鐘數：「${t}」`);
  return new Date(`${m[1]}T${String(hh).padStart(2, "0")}:${m[3]}:00+08:00`);
}

/** 顯示：「10/20（一）15:00」—— 日期同星期一齊出，Kevin 一眼捉到錯。 */
export function fmtHk(d: Date | string | null | undefined, withTime = true): string {
  if (d === null || d === undefined || d === "") return "";
  const x = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return "";
  const hk = new Date(x.getTime() + HK_OFFSET_MS);
  const wd = "日一二三四五六"[hk.getUTCDay()];
  const md = `${hk.getUTCMonth() + 1}/${hk.getUTCDate()}（${wd}）`;
  if (!withTime) return md;
  return `${md}${String(hk.getUTCHours()).padStart(2, "0")}:${String(hk.getUTCMinutes()).padStart(2, "0")}`;
}
