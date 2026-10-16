/**
 * Postgres 連線（直連，唔經 Supabase REST）。
 *
 * 點解唔用 supabase-js（Equal CRM 用嗰個）：
 *   1. PostgREST 一次最多回 1000 行，寫 `.limit(5000)` 都靜靜雞淨回 1000 行唔報錯
 *      —— Equal 中過四次（公司清單、地圖、冷電池…）。直連冇呢個上限。
 *   2. 冇 transaction。記一次電話要「寫 call ＋ 收舊回撥 ＋ 開新回撥」三件事
 *      一齊成功或者一齊唔做 —— 做一半就係「回撥提醒翻生」嗰個病。
 *
 * ⚠️ DATABASE_URL 入面有 DB 密碼 ＝ 成個客戶資料庫。只可以喺 server 讀環境變數，
 *    永遠唔入 git、唔貼落對話、唔出現喺送去瀏覽器嘅嘢度。
 */

import postgres from "postgres";

export type Sql = postgres.Sql<Record<string, unknown>>;
/** 普通連線或者 transaction 入面都用得嘅 helper 參數 */
export type SqlOrTx = Sql | postgres.TransactionSql<Record<string, unknown>>;
export type JsonValue = postgres.JSONValue;

/** 任何嘢 → 存得落 jsonb（Date 自動變 ISO 字串、undefined 欄剝走）。 */
export function toJson(v: unknown): JsonValue {
  return JSON.parse(JSON.stringify(v ?? null)) as JsonValue;
}

/** 攞第一行；冇就講清楚冇咗乜（唔好畀個 undefined 靜靜雞行落去）。 */
export function one<T>(rows: readonly T[], what = "資料"): T {
  const r = rows[0];
  if (r === undefined) throw new Error(`搵唔到${what}`);
  return r;
}

let cached: Sql | null = null;

export function readDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "環境變數 DATABASE_URL 未設定。\n" +
        "Supabase → Project Settings → Database → Connection string（Session pooler）抄過嚟，\n" +
        "放入 GitHub repo secrets（setup 個 workflow 會搬落 Fly）。⚠️ 唔好 commit、唔好貼落對話。",
    );
  }
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error("DATABASE_URL 格式唔啱（應該 postgresql:// 開頭）");
  }
  parseDbUrl(url);
  return url;
}

/**
 * 解條連接字串；解唔到就拋一個**唔帶條網址**嘅錯。
 * ❗Node 自己個 `TypeError: Invalid URL` 會連 `input` 一齊印 —— 2026-10-15 就係噉將
 *   半截 DB 密碼印咗落 public repo 嘅 Actions log（GitHub 淨係遮成條 secret，半截唔遮）。
 */
export function parseDbUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(BAD_URL);
  }
  // 冇 host 淨係 unix socket（`postgres:///db?host=/tmp`）先得
  if (!u.hostname && !u.searchParams.get("host")) throw new Error(BAD_URL);
  return u;
}

const BAD_URL =
  "DATABASE_URL 唔係一條完整網址 —— 多數係 DB 密碼有 # @ / ? & % 呢類符號。\n" +
  "去 Supabase → Project Settings → Database → Reset database password，" +
  "揀一個淨係英文字母＋數字嘅密碼，再更新 GitHub secret DATABASE_URL。";

/**
 * 本機（127.0.0.1／localhost／unix socket）唔使 TLS；其他一律 require ——
 * Supabase 個 pooler 連接字串冇寫 sslmode，唔講就會明文傳 DB 密碼同客戶資料。
 * 網址自己寫咗 sslmode 就跟網址。
 */
export function sslFor(url: string): "require" | false | undefined {
  const u = parseDbUrl(url);
  if (u.searchParams.has("sslmode")) return undefined;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "" || host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("/")) return false;
  return "require";
}

export function connect(url: string, opts: { max?: number } = {}): Sql {
  const ssl = sslFor(url);
  return postgres(url, {
    ...(ssl === undefined ? {} : { ssl }),
    max: opts.max ?? 5,
    // Supabase pooler（transaction mode）唔支援 prepared statement；session mode 支援。
    // 關咗兩種都行得，慢少少都唔緊要。
    prepare: false,
    // 日期（date）原樣回字串「2026-03-31」，唔好變 JS Date —— 變咗會撞時區，
    // 香港 3 月 31 號喺 UTC 係 3 月 30 號，個到期日會靜靜雞早一日。
    types: {
      date: {
        to: 1082,
        from: [1082],
        serialize: (x: unknown) => String(x),
        parse: (x: string) => x,
      },
    },
    onnotice: () => {},
    // ❗唔靠 session 時區：Supabase pooler 未必傳得到 startup 參數。
    //   所有「邊一日」嘅計法喺 SQL 度明寫 `at time zone 'Asia/Hong_Kong'`。
  }) as unknown as Sql;
}

export function getDb(): Sql {
  if (cached) return cached;
  cached = connect(readDatabaseUrl());
  return cached;
}
