# 開場必讀（Global Call CRM）

Kevin（equal.kevin@gmail.com）2026-10-05 入職 **Global Call**（電訊轉售商：Business SIM、無限數據、
NB-IoT／工業 SIM、CloudPhone、SME Bundle）做 **B2B 冷電**。呢個 repo 係佢**自己一個人用**嘅 CRM。
用廣東話覆佢；佢唔寫 code。你嘅記憶唔跨 session —— **呢份嘢就係跨 session 嘅記憶**，學到新規矩就寫返入嚟。

（佢之前喺 EQUAL FLOORING 做 sales，嗰個 CRM 喺 `equalhk-crm`，2026-10-01 停咗。
呢度淨係搬咗通用工程教訓過嚟，**一個 Equal 客名電話都冇搬**，兩間公司資料唔好撈埋。）

## Kevin 嘅業務規矩（佢講過，唔准再問）

- **打完電話八粒掣**，名同次序照佢張單，一個都唔改：
  沒有人接 · 不需要 · 稍後再撥打 · 需要跟進 · 只接受電郵 · 已電郵 · 其他人跟進 · 幾點鐘再打。
  每粒掣做乜喺 `src/domain/outcomes.ts`（純函數，`tests/outcomes.test.ts` 逐粒釘死）。
- **R** ＝ 搵到負責人。**D** ＝ 攞到詳盡資料（合約到期日、價錢、套餐內容、用緊邊個台）。
  R、D 分開判斷（前台講咗合約到期日算 D 唔算 R）。填咗任何一樣 D 資料就自動算 D。
- **每日數**：通數（撥咗幾多次）· 接通（唔係「沒有人接」）· R、D **按間數**（同一間一日兩次都係 1）。
  「邊一日」按香港時間。
- **第幾次致電**：自動 ＝ 打過幾多次 +1，可以手改。
- 打下一次電話**自動收舊嘅回撥／跟進／寄電郵提醒**（唔收源頭，件事第二日翻生 —— Equal 中過）。
- **其他人跟進** ＝ 同事跟緊：要填邊個同事，呢間唔再出冷電名單（唔好撞同事單）。
- **冷電名單** ＝ 狀態 未打／跟進中、冇同事跟開；預設未打過行先。
- **名單規矩**（佢定嘅）：名單淨係用嚟知道有邊啲公司；聯絡用公司總機或公開商業電話；
  **屋宇署、會財局等政府或專業團體名冊唔做 call list**；**打之前先喺公司 MIS 查過**（CRM 有「MIS 查過」剔）。
- ❗**成本同毛利只供 Kevin 自己參考**（佢份溫習筆記寫明「不要對客人講，也不要轉發」）——
  第三期報價單／合約**永遠唔准出成本、GP**，要有 test 釘死。
- **GP／佣金計法未畀就唔估**。佢話「不同產品有不同的計算方法之後再給資料」。
- 未搞清（要問佢組長，唔好自己定）：KPI 係每星期定每日 20；CMHK 50MB 價錢；CSL NB-IoT 成本對唔上。
- **Kevin 2026-10-15 定咗**：續約到期前 **90 日**提醒、**30 日**再提（`settings.renewal`）；
  **唔要**手機日曆同步、**唔要**每朝 email（全部喺 CRM「今日」睇）；每月截數＝**自然月**；報價／合約出 **Word .docx**。
- **續約提醒係計出嚟嘅，唔落 tasks**（`src/domain/renewals.ts`）：打一次電話自動收；「收埋」鎖住到期日，
  佢之後報新到期日會再出。其他人跟進／已結業唔出，不需要照出。
- **約** ＝ 嗰日約咗幾多個（按 `created_at`，取消唔計）；**見** ＝ 嗰日見咗幾多個（按 `starts_at`，狀態已見）。
  見完有「下一步」就開跟進待辦（`tasks.source_appointment_id`），出喺今日回撥。

## 分期（2026-10-14 開工）

| 期 | 內容 | 狀態 |
|---|---|---|
| 一 | 冷電：匯入、清單篩選導出、八粒掣、R／D、回撥、每日數、興趣產品、Claude 對話入記錄 | ✅ 本機 |
| 二 | 預約、見面備註＋下一步、日曆（時間表＋月曆：公司／聯絡人／地址）、續約提醒、約／見每日數 | ✅ 本機 |
| 三 | 報價單（產品／月費／期數／金額）、合約範本（條款可改、出單嗰刻凍結）、BR／住址證明上載 | |
| 四 | 開單記 GP、每日報 GP、每月目標／達成 %／結算、月報 | |

## 架構

- Node 22 ＋ TypeScript（`tsx` 直接行，唔 build）。一個程式：`/app` 網頁、`/app/api/*`、`/mcp`（claude.ai connector）、`/health`。
- **直連 Postgres（`postgres` library），唔用 supabase-js**：PostgREST 靜靜雞每次最多回 1000 行（Equal 中過四次），
  而且冇 transaction。寫入一律行 `src/domain/*`（transaction ＋ `audit_log`）。
- Supabase（新加坡、Free organization）。RLS 全開冇 policy：anon key 乜都讀唔到，server 用表主人身份連。
- Fly.io `sin`（❗唔好用 `hkg`，已廢）、shared-cpu-1x 512MB 長開、**淨要共享 IPv4**（專用 IPv4 每月 US$2）。
- 登入：一個密碼（`APP_PASSWORD`）＋ HMAC 自簽 cookie／OAuth token（`SESSION_SECRET`，換咗 ＝ 全部裝置同 claude.ai 要重新登入）。
- migration：`supabase/migrations/*.sql` 順序行，`schema_migrations` 記住；部署時 `fly.toml` 個 `release_command` 行，
  行唔過唔換新版。測試用**同一個 runner** 砌 template DB。

## 改完一定要自己先驗

「test 綠」只證明「我嘅假設之間冇矛盾」。出街前：

1. **講得出邊一步證明佢真係好咗。** 講唔出就係未驗。
2. **測試一律對真 Postgres、行真 migration**（`tests/setup/global.ts`）—— 唔准用憑印象打嘅假 schema（Equal 中過五次）。
3. **改完破壞一次**：特登拆走個 fix，睇住啱嗰條 test 紅，再擺返。綠咗冇紅過嘅 test 唔算數。
4. **用家撳得到嘅就親手撳**：本機開真 server、Chromium（`/opt/pw-browsers`）撳一轉、截圖對。
   2026-10-14 就係真瀏覽器先捉到 `[hidden]` 俾 `.btn{display}` 蓋過（jsdom 唔計 CSS，test 全綠）。
5. **驗唔到就講驗唔到**。「上咗，你撳一撳話我知見唔見到」先係老實。
6. **重開 server 要確認係新嗰個**：`/health` 個 build 對返。2026-10-14 舊 process 霸住 port，新 server 起唔到，
   我截咗一輪舊 code 嘅圖以為驗咗。❗**`pkill -f <路徑>`、`ps | grep <路徑> | kill` 都會殺埋自己個 shell**
   （個 bash -c 指令本身有嗰串字）—— 一律用 PID 檔（`/tmp/gc-server.pid`）。
7. **破壞「寫入唔喺 transaction」會變死鎖，唔係報錯**：transaction 鎖住公司行，外面嗰句等佢 → test 20 秒 timeout，
   但個連線仲卡住，`sql.end()` 永遠等。要 `pg_terminate_backend` 嗰個 test DB 啲連線先行得落去。
8. **container 會被收**：隔一晚返嚟 PG 冇咗（data 仲喺 `/tmp/gc-pg`），`rm /tmp/gc-pg/postmaster.pid` 再 start。

## 本機開發

```bash
# PG16（容器入面）：
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /tmp/gc-pg"     # 第一次
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/gc-pg -o '-p 55432 -k /tmp' -l /tmp/gc-pg.log start"
export TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres
npx vitest run && npx tsc --noEmit        # merge 前兩樣都要綠（main 紅 ＝ 唔部署）
```

開 server：`DATABASE_URL=… APP_PASSWORD=… SESSION_SECRET=… PORT=8787 node --import tsx src/server/http.ts`
（`npx tsx` 會隔多層 process，kill 唔乾淨）。

## ❗2026-10-15：成個 project 冇咗一次，由對話記錄重建

10/14–15 做嘅嘢（8 個 commit、第一＋第二期、173 條 test）放喺 `/home/user/global-call-crm`，**從來冇 push**。
隔一晚 container 被收：呢個資料夾、scratchpad（爬蟲、call list、截圖）、本機 Postgres 全部冇晒，
淨係 primary working directory（`equalhk-crm`）同對話 transcript 留低。
- **教訓：新 project 第一日就要有 remote，做完一步 commit＋push 一步。** 本機 commit 唔係備份。
- 點重建（下次用得返）：transcript `~/.claude/projects/<proj>/<session>.jsonl` 入面有每個 Write 嘅全文、
  每個 heredoc／python 改動；`attachment` 類行有 Read 過嘅全文。照時間次序重做，`assert old in s` 對唔中就停。
- **重建之後邊啲係原文、邊啲係補寫**：
  - 原文（逐字由記錄抽返／重做改動）：src/server/*、src/domain/{appointments,renewals,products,export,
    importer,companies,stats,tasks}.ts、src/lib/{phone,text}.ts、src/db/{client,export-csv}.ts、public/*、
    tests/{importer,server,web,appointments,renewals,rls,export-csv}.test.ts、tests/helpers/db.ts、
    migration 20261015000100、Dockerfile、fly.toml、workflows、README、本檔。
    （companies.ts 由五段 sed 讀返砌，中間兩行冇人讀過，補咗一行註釋。）
  - **補寫**（得片段，照 summary 規格寫返，行為由 test 同真瀏覽器驗過）：migrations 20261014000100／0200／0300、
    src/db/migrate.ts、src/lib/{time,csv}.ts 頭段、src/domain/outcomes.ts 尾段、src/domain/calls.ts（logCall 係原文）、
    tests/{outcomes,calls,lib,stats-tasks-companies}.test.ts、tests/setup/global.ts、package.json、tsconfig.json、
    vitest.config.ts、.gitignore；新加 tests/migrate.test.ts。
  - **救唔返**：scripts/crawl/*.py（爬蟲）、call list CSV／xlsx、黃頁快取。要 call list 就要 Kevin 畀返或者重爬。

- **Fly org 要用 slug 唔係顯示名**（2026-10-15 ① 第一次跑紅）：`flyctl orgs list --json` 回 `{slug: 名}`，
  個人帳戶個「名」係 email；拎咗 value 就變「organization kevinglobalcall@gmail.com not found」。
  而家攞 key、有 `personal` 優先，用之前 `flyctl orgs show` 驗一次。

## 由 Equal 帶過嚟嘅工程教訓（全部中過）

- **日子一律 `hkToday()`／`at time zone 'Asia/Hong_Kong'`**，唔准 `toISOString()` 當日子（香港凌晨 0–8 點 UTC 仲係前一日）。
  食日子嘅 function 一律收 `today`／`now` 參數，測試釘死，唔跟真時鐘。
- **日期星期一齊出**（「10/20（二）15:00」），用程式計，唔准心算。
- **搜尋無視空格**（Kevin 講咗三次）：JS `nospace()` 同 SQL `public.nospace()` 一模一樣。
- **電話**：一格可以幾個號，要拆開逐個比；**傳真同電話分開**（CRM 個號係傳真 ＝ 打極冇人聽）；
  每個號攞**緊貼佢前面**嘅標籤；香港號碼 2–9 字頭都收。
- **查重**：`'' = ''` 係 true —— 名剝完係空就唔做鎖匙；中英文名兩條鎖匙都要試；`&` 當 `and`；
  「一個名係另一個嘅一部分」唔可以自動當同一間；電話一樣 ≠ 同一間公司（集團共用總機）。
- **讀唔到 ≠ 冇**；數唔到唔准當 0；寫入要睇返回應確認落咗地先講「記低咗」。
- **CSV 要 UTF-8 BOM**（Excel 開中文）；數 CSV 行數唔好用 `wc -l`（備註有真斷行）。
- `mailto:` 要 URL-decode；Word 要真 `.docx`（MHTML 扮 `.doc` 手機開唔到）。
- **中文唔准自己砌 `\uXXXX`**，直接貼原字；寫完讀返逐隻字對。
- **成批寫入要一個 transaction、成批 insert**（逐行 insert 經網絡會撞 timeout：5,054 間 6.8s → 1s）。
- **scratchpad 唔跨 container**：工具、快取要入 repo（`scripts/`），唔好留喺 scratchpad。
- 新目錄站第一件事開 `robots.txt`，唔准爬就唔爬。

## 未做／等 Kevin

- Kevin 要自己做：開 repo、Supabase project（Free org、Singapore）、GitHub secrets
  （`FLY_API_TOKEN`、`DATABASE_URL`、`APP_PASSWORD`）、claude.ai 加 connector `https://global-call-crm.fly.dev/mcp`。見 README。
- 之後畀：公司列表 Excel、GP／佣金計法、報價／合約範本。
- 黃頁 IoT 名單淨掃到 69／約 212 版（見 `scripts/crawl/README.md`）。
- 自動 merge：**未授權**（Equal 嗰個授權唔帶過嚟）—— 開 PR 之後問佢。
