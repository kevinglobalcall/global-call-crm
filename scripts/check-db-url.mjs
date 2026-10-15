// 驗 GitHub secret DATABASE_URL 搬得落 Fly、Postgres 解得到 —— 永遠唔印條網址。
// 2026-10-15：DB 密碼有 # & ^ * % 呢啲符號，`flyctl secrets import` 食咗 # 之後成截，
// 去到 Fly 臨時機 Node 報 Invalid URL 仲連半截密碼印落 public repo 嘅 Actions log。
// 所以喺 GitHub 呢邊就擋住，唔好等去到 Fly 先爆。
const url = (process.env.DATABASE_URL ?? "").trim();
const fail = (msg) => {
  console.log(`::error::${msg}`);
  process.exit(1);
};
if (!url) fail("DATABASE_URL 未設定");
if (!/^postgres(ql)?:\/\//.test(url)) fail("DATABASE_URL 唔似 Supabase 條連接字串（要 postgresql:// 開頭）");
if (/YOUR-PASSWORD|\[YOUR/.test(url)) fail("DATABASE_URL 入面仲係 [YOUR-PASSWORD] —— 換返你個 DB 密碼");
const fix =
  "去 Supabase → Project Settings → Database → Reset database password，揀一個淨係英文字母＋數字嘅密碼，" +
  "砌返 Session pooler 條連接字串，再更新 GitHub secret DATABASE_URL。";
let u;
try {
  u = new URL(url);
} catch {
  fail(`DATABASE_URL 解唔到（多數係 DB 密碼有 # @ / ? & % 呢類符號）。${fix}`);
}
if (!u.hostname) fail(`DATABASE_URL 冇主機名（多數係 DB 密碼有符號將條網址斬開咗）。${fix}`);
if (!u.password) fail("DATABASE_URL 冇密碼 —— Supabase 嗰條要 postgres.xxxx:密碼@… 嘅格式");
if (!/^[A-Za-z0-9._~-]+$/.test(u.password))
  fail(`DATABASE_URL 個密碼有英文字母／數字以外嘅符號，搬落 Fly 會斷。${fix}`);
if (!u.hostname.endsWith("pooler.supabase.com"))
  console.log("::warning::DATABASE_URL 唔係 Session pooler 嗰條 —— GitHub 冇 IPv6，每晚備份可能駁唔到。建議用 Connect → Session pooler。");
console.log("DATABASE_URL 格式 OK（冇印出嚟）");
