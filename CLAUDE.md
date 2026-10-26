# 開場必讀（Global Call CRM）

Kevin（equal.kevin@gmail.com）2026-10-05 入職 **Global Call**（電訊轉售商：Business SIM、無限數據、
NB-IoT／工業 SIM、CloudPhone、SME Bundle）做 **B2B 冷電**。呢個 repo 係佢**自己一個人用**嘅 CRM。
用廣東話覆佢；佢唔寫 code。你嘅記憶唔跨 session —— **呢份嘢就係跨 session 嘅記憶**，學到新規矩就寫返入嚟。

（佢之前喺 EQUAL FLOORING 做 sales，嗰個 CRM 喺 `equalhk-crm`，2026-10-01 停咗。
呢度淨係搬咗通用工程教訓過嚟，**一個 Equal 客名電話都冇搬**，兩間公司資料唔好撈埋。）

## Kevin 嘅業務規矩（佢講過，唔准再問）

- **第九粒「留聯絡」**（Kevin 2026-10-16「加一個按鈕 留聯絡」）加喺最尾：算接通、狀態跟進中、時間可揀（揀咗開回撥）。
  ❗加結果掣要改三處：`OUTCOMES`／`RULES`、`calls.outcome` 個 check（migration）、MCP 說明 —— `tests/calls.test.ts`
  逐粒寫入真 DB，漏咗 migration 即刻紅（破壞測試紅過）。
- **第十粒「唔通」**（Kevin 2026-10-16「加個唔通按鈕」→ 佢揀「轉 唔通」）：電話打唔通（死線／錯號），**唔算接通**，
  公司轉**新狀態「唔通」**（`COMPANY_STATUSES` 加咗，唔出冷電名單，篩得返）。
  ❗「接通」嘅 SQL 而家用 `NOT_CONNECTED`（由 RULES 計），唔准再喺 SQL 寫死 `<> '沒有人接'` —— 寫死咗加新結果就數錯。
  ✅ 佢 10/16 答：「cut line 不需要 / dead 唔通」—— 匯入規則已改；production 嗰 44 間用一次性 migration
  `20261016000400_import_dead_to_no_line.sql` 改（淨係郁仲係不需要＋匯入備註有 dead＋之後冇打過嘅，逐間入 audit）。
  ❗大批改 production 資料用 migration 唔用 MCP：MCP 寫入每次都要 Kevin 撳批准，44 次會煩死佢；migration 有 test 行同一份檔。
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
- **❗DB 密碼淨用英文字母＋數字；錯誤訊息唔准帶連接字串**（2026-10-15 ② 第一次部署紅）：
  Kevin 個 Supabase 密碼有 `^ * % & #`，`flyctl secrets import`（dotenv 式）食咗 `#` 之後成截，
  Fly 臨時機行 migration 嗰陣 Node `new URL()` 報 Invalid URL，**連 `input`（半截密碼）印咗落 Actions log**。
  ❗**個 repo 係 public**，而 GitHub 淨係遮「成條 secret 一模一樣」嘅字串 —— 半截照出。
  執法：即刻刪咗嗰個 run 嘅 log（MCP `delete_workflow_run_logs`，再攞 404 先算刪咗）＋叫 Kevin 重設密碼。
  而家三重擋：`scripts/check-db-url.mjs`（① 同 ② 都行，GitHub 呢邊就擋，唔印網址）、
  `parseDbUrl()` 自己拋唔帶網址嘅錯、`tests/lib.test.ts` 驗錯誤訊息冇密碼（破壞測試紅過）。
  **寫任何會碰 secret 嘅錯誤處理，第一個問題係「呢句錯誤訊息印唔印得出 secret」。**

## 備註記錄（Kevin 2026-10-16 掉 MIS Remark Record 截圖：「之後做這種remark」）

- `company_remarks` 表（`src/domain/remarks.ts`）：時間、邊個（Kevin／Claude／名單匯入）、內容；加／刪入 audit。
- 公司頁「備註記錄」**同電話記錄合埋一條時間線**（Kevin 揀嘅），最新喺頂；新備註格喺頂（跟 MIS）。
- **名單匯入嘅備註冇真日期**：`created_at` 係匯入嗰刻 —— 網頁排最底、寫「名單匯入（原日期不明）」，
  MCP `get_company` 都係噉寫。唔准當佢係嗰日講嘅（Kevin：表入面嗰幾行日子「唔準，唔好用」）。
- MCP `add_remark` ＝ 純文字備註，唔改狀態、唔計通數；打咗電話照用 `log_call`。

## 匯入 Kevin 個整合公司名單（2026-10-16，2026-10-15 版 xlsx，11,841 行）

- **「聯絡結果」欄 → 狀態，淨係用 Kevin 拍板咗嘅規則**（`src/domain/contact-result.ts`）。「不明的問我 不要自己加狀態」：
  認唔到 → 未打＋原文入備註記錄＋preview 逐行列出；加規則之前一定要佢答過。
  佢拍板：no need／not interest → 不需要；dead／phone dead／cut line → 不需要；close／永久停業 → 已結業；
  冇人接／約回撥／wts／email only／淨係 emailed → 跟進中；日子分隔行（14/10…）唔準唔用；
  **ex／billing ＝ 現時客戶 → 其他人跟進**（followed_by「現時客戶」；佢揀呢個唔揀已成交，已成交留畀佢自己傾落嘅單）；
  「已成功Email」當全部冇電郵過（地址入電郵欄，唔加備註）；第二頁「新增－未有電話」暫時唔入。
- **冷電名單「未打過行先」以前淨係睇 call_count** —— 匯入嘅跟進中冇電話記錄（0 次），會同真未打撈埋。而家先排 status=未打。
- **檔案內查重中過三個坑**（真檔對數先捉到，test 全綠都冇用）：
  ① 剝走「公司／有限公司」之後中文名撞 ≠ 同一間 —— 建輝工程公司 Kin Fai ≠ 建輝工程有限公司 Kingford（七對）。
     英文名兩邊都有而唔同 ＝ 兩間（`namesConflict`），對 CRM 現有公司都係噉。
  ② 全形英文（ＧＢＡ集團、ＴＯＭ集團）冇 NFKC 就剝剩「集團」撞埋一齊 —— `nameKey` 而家先 NFKC。
  ③ 名似但冇共同電話（祥興工程公司 ≠ 祥興工程有限公司）唔併，出警告；上市簡稱「信和置業／信和置業有限公司」、
     英文全名一樣（Ltd＝Limited）、或者一邊冇電話先併。寧願兩張卡等 Kevin 合併，都唔好將兩間撈埋。
  併嗰陣第一行未打過、第二行有結果 → 用第二行嘅結果（唔係就靜靜雞變返未打）；兩行結果唔同 → 未打＋問。
- 「未核實」「N/A」「-」做電話格 ＝ 冇號碼，唔當認唔到嘅號碼落備註（真檔 96 格）。
- **真檔對數（本機，real endpoints）**：入 11,803 間（併 34、冇名 4）· 未打 11,350 · 跟進中 239 · 不需要 203 · 已結業 11 ·
  認唔到 24（加咗 ex／billing 之後 17）· 備註 526 條。commit 4 秒，**server RSS 峰值 426MB（Fly 512MB）**—— 再大一倍嘅檔要分開兩次或者加記憶體。
  ❗份真檔有客戶資料，**唔准入 repo（public）**，淨係擺 scratchpad。

## 公司清單直接做嘢（Kevin 2026-10-16「我需要直接顯示電話 email及tick狀態 備註欄」）

- 每行：撥號掣（傳真唔撥）、mailto、**狀態下拉**（改咗即存；由「其他人跟進」改走會清埋同事名，唔係照樣唔出冷電）、
  **八粒結果掣**（撳一粒即記一次電話，格入面啲字做內容；幾點鐘再打要揀時間、其他人跟進要填名先送；記完出「撤回」）、
  **全部備註**（Kevin「顯示所有備註」：`listCompanies` 嘅 `history` —— 手寫備註＋每次電話（冇內容都出「第 N 次 · 結果」），
  新嘅行先，名單匯入最尾；格太長就喺格入面捲）＋「加備註」。❗唔好叫 `notes`，撞 companies.notes 欄。
- **記完結果／改完狀態自動跳去下一間**（Kevin「按完狀態後自動跳下一個」）；加備註、撤回唔跳。
  ❗要等嗰行重畫完先跳 —— 佢多咗「記低咗…撤回」會高 65px，早跳會停喺下一間中間（真瀏覽器量到先捉到，jsdom 測唔到）。
- **網址**（Kevin「加顯示網址」）：清單同公司頁都出，`siteLinks()` 拆「 | 」／空格、冇 http 補 https、開新分頁；
  淨係 http／https 先做連結（匯入嘅字唔准變 `javascript:`）。加咗落主畫面（PWA）用 window.open，唔係 iPhone 會成個 app 走咗去。
- 記完淨係重畫嗰一行（`/companies?id=`），唔重載成版；仲喺唔喺呢個清單用同一組篩選＋id 問一次，唔喺就灰咗唔即刻消失。
- `last_note` 唔加落 view：本機 11,803 間實測冷電 count 0.24 秒，view 再加 lateral 只會更慢；一頁 50 間另外一句 query。
- **R 負責人格**（Kevin「要有位置輸入R資料 例如這間公司的R是DEREK SHAO」）：每行左邊，寫入 `contacts`
  （`is_decision_maker`）—— 同公司頁「聯絡人」同一份，全站搜尋搵得返個名。未有 R 直接出格（名／職位／直線），
  有咗就出「R 名 · 職位 · 撥號」＋「改」，再加人撳「＋R」；Enter 即存。MCP `add_contact`（同名就改返嗰個人）。
  ❗**記低 R 係邊個唔等於搵到 R**：`ever_r`／R 數字照舊由電話記錄嘅 reachedR 計（前台講個名唔算傾到負責人）。
- ❗**auto 模式下改 CRM 資料（MCP 寫入）仍然會問 Kevin 批准**，而我唔准自己改權限設定（self-modification 被擋）。
  佢問「為什麼不停要允許」—— 答案係寫 production 資料嗰類動作；改 code、跑 test 唔會問。

## D：一間公司幾個台（Kevin 2026-10-16「要可以加不只一間電訊商」，掉咗 CMHK 嗰張 D 截圖）

- D 資料喺 **`call_carriers`**（一次電話幾行，一個台一行：provider／contract_end／price／plan）。
  舊 `calls.d_*` 四個欄 migration `20261016000500` 搬晒入嚟之後 **drop 咗** —— 唔留兩本數。
- **「而家用緊」＝ `company_carriers_current`**：同一個台（`public.nospace(provider)`，空格大細楷唔理）攞最新嗰次電話講嘅；
  ❗再打一次淨係講 CSL 新價，**CMHK 照留**（唔係「最新嗰次電話」成組蓋晒 —— 嗰個寫法會靜靜雞洗走其他台）。
  冇講台名嘅（前台淨係講到期日）當一個「未知台」。
- `company_overview`：`d_contract_end` ＝ 最早到期嗰個台（排序／篩選）；`d_provider/price/plan` 用「 / 」串；`d_lines` 逐個台（網頁、MCP）。
  匯出 Excel 用一格「用緊嘅台」講晒（分開幾欄對唔到邊個價係邊個台）。
- **續約逐個台出**（CMHK 到期唔會俾 CSL 遠啲嘅日子遮住）；收埋係 (公司, 到期日, 段)。
- 網頁：記電話同改電話都係「＋再加一個台」／「刪呢個台」；改嗰陣係**成組換**（`updateCall` 畀 `carriers` 就 delete＋insert，唔畀唔郁）。
  公司頁頂出「而家用緊」；清單行一個台一粒 `.pill.carrier`（❗唔好用 `.pill.d` 揀 —— R/D 嗰粒 D 都係 `pill d`）。
- MCP `log_call`：`carriers: [{provider, contractEnd, price, plan}]`；舊 `dProvider…` 照收，變第一行。readback 要數得返台先 `saved`。
- 本機 11,803 間：`company_overview` 50 行 0.5ms（distinct on 個 company_id 推得落 index），冇變慢。

## 撳個數睇係邊幾間（Kevin 2026-10-16「要能夠點開顯示什麼公司」）

- 今日、本星期、揀日子嗰幾格（`statTiles`）同每日表入面啲數全部係連結 → `#/stats/detail?kind=&from=&to=`。
- `statsDetail()`（`src/domain/stats.ts`）嘅條件**一定要同 `dailyStats`／`periodTotals` 一模一樣**：
  `tests/stats-detail.test.ts` 逐種、逐日、成段時間對「行數 ＝ 個數」（破壞測試紅過）。改計法要兩邊一齊改。
- R／D 按間數 → 一間一行（攞嗰段時間最後一次）；約 ＝ 按約嗰日、取消唔計；見 ＝ 按見面日、已見。

## 刪公司（Kevin 2026-10-16「加個刪除」）

- 清單每行同公司頁都有「刪除」，問一次先刪；成張卡（電話、電郵、聯絡人、備註、待辦）抄落 audit_log。
- ❗**有電話記錄或者約見面嘅唔准刪**：所有子表 on delete cascade，刪咗以前嘅每日數會靜靜雞變細。叫佢改狀態。
- ❗同一個電話幾張卡**唔一定係孖生**：佢搜 2880 0178 出嘅三間（嘉華國際／嘉華地產／帝景灣物業管理）係同集團共用總機嘅三間公司。

## 全站搜尋（Kevin 2026-10-16「全部頁面都要加全站search」）

- 頁頭一格（任何頁都有）：打字 250ms 後搵頭 8 間（`/companies?q=&limit=8`）下拉；撳一間入公司頁；Enter → 公司清單；
  Esc／撳出面收；任何頁撳「/」跳去格度。手機頁頭得 logo＋搜尋＋深淺色（CRM 字同「深色」兩個字收埋）。
- 搜尋（`where()` 個 q）而家連**聯絡人**名／電郵／電話都搵（公司頁同清單一齊受惠）。
- **備註記錄都搵**（Kevin「備註記錄 也要search到出來」）：手寫／名單匯入備註（`company_remarks.body`）＋電話內容
  （`calls.content`），無視空格大細楷，寫喺備註嘅電話號碼都搵到。❗寫成 `o.id in (select … union select …)`，
  唔好逐行 `exists`：本機 11,803 間實測逐行 exists 每次搜尋 1.0 → 1.55 秒，`in` 返返 1.0 秒。
  ❗**唔搵 `companies.notes`**：嗰格係匯入嘅「分類：…／【原欄】SIM／IoT 切入點…」，搜「esg」「IoT」會中幾千間，
  而且清單行度唔出嗰格，Kevin 會見到一堆唔知點解中嘅公司。
- ❗**淨係「成句似電話」先當電話搵**（數字／空格／+ - ( )，再剝走 852 區號）：以前任何 query 都抽數字，
  搜備註「CSL 150 1G」抽出 1501，撞中 4 間總機有 1501 嘅公司（production 實測）。舊版連「+852 3150 1111」都搵唔到。
- ❗**SQL 寫喺 JS template literal 入面唔准用 `\D` 呢類反斜線**：`sql\`…'\D'…\`` 喺 JS 變咗 `'D'`（唔識嘅 escape 靜靜雞食咗），
  regex 由「非數字」變咗「字母 D」，tsc 同 test 都唔會出聲 —— 我第一版就係噉，靠 node 試一下先捉到。用 `[^0-9]`。

## 外觀（Kevin 2026-10-15「使用官網配色方便手機瀏覽」）

- **配色由官網 globalcall.com.hk 個 theme 抄**（`--wp--preset--color--*`），唔係估：主藍 `#046CB5`（＝logo 個藍）、
  頁頭深藍 `#0e2753`（官網 hero 底色）、淺藍 `#D4ECFA`、logo 紅 `#EB2027`、橙 `#f54900`；字體 Inter ＋ Noto Sans HK。
  中文公司名係 **國際電訊**（官網 /zh/ 個 title），唔好自己譯。
- **logo／app icon 由官網 `logo-1200x628-4.png` 裁出嚟**（官網自己個 icon 得 80px，放大會矇）。
  `public/` 有 logo／favicon／apple-touch-icon／icon-192／icon-512 ＋ `manifest.webmanifest`，iPhone「加到主畫面」似個 app。
  `tests/server.test.ts` 會逐個 icon 讀 PNG 闊高對返 manifest 講嘅 sizes。
- **深淺色**（Kevin 2026-10-16「web也要dark mode」）：**預設深色**，頁頭粒掣轉 深 → 淺 → 跟系統，記喺 localStorage
  `gc-theme`（每部機自己記）。`index.html` 個 inline script 一開頁就套用，唔會閃白；讀唔到 localStorage 照用深色。
  「跟系統」＝ 唔寫 `data-theme`，由 CSS prefers-color-scheme 話事。
- 手機：公司頁電話係大粒「一撳就打」掣（`.dial`）；「記低」掣黐住底；輸入格 16px（細過 iPhone 會自己 zoom）。
- **改外觀要真係睇過**：`scripts/dev-seed.ts` 入示範資料（淨係肯行本機 DB），Chromium 390px 截晒五個 tab ＋ 公司頁 ＋ 登入頁，
  淺色深色各一，`scrollWidth` 要等於 390（冇打橫捲）。今次就係咁捉到登入框爆出右邊、表頭一個字一行。

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

## ❗2026-10-26 CRM 停用（Kevin「crm停止運作」→ 問清楚係「想熄咗佢」，唔係壞咗）

- 問之前查過：server `/health` 200、DB 答到（過去 7 日 321 通電話）—— 即係唔係壞，所以要問，唔好估住去熄。
- 做咗：⑤ 最後一次完整備份（pg_dump ＋ 每張表 CSV，GitHub artifact 留 90 日）→ ⑦ 熄機（`scale count 0`）→ ⑦ 睇數。
- **資料一行都冇剷**：Supabase 照留，Fly app／secrets／image 照留。開返：⑦ 揀「開返機」；起唔返就行 ② 部署。
- ⑤ 每晚備份個 cron 註釋咗（淨係手動）；② 部署加咗 `paths`：淨係改 src／public／supabase／package／Dockerfile／fly.toml 先部署
  —— ❗唔加嘅話，熄機之後任何 push（連改 CLAUDE.md）都會 `flyctl deploy`，部機即刻翻生。
- 熄咗機之後 claude.ai 嗰個 gc 連接器（MCP 喺部機度）都會用唔到 —— 唔係壞咗。

## 未做／等 Kevin

- Kevin 要自己做：開 repo、Supabase project（Free org、Singapore）、GitHub secrets
  （`FLY_API_TOKEN`、`DATABASE_URL`、`APP_PASSWORD`）、claude.ai 加 connector `https://global-call-crm.fly.dev/mcp`。見 README。
- 之後畀：公司列表 Excel、GP／佣金計法、報價／合約範本。
- 黃頁 IoT 名單淨掃到 69／約 212 版（見 `scripts/crawl/README.md`）。
- 自動 merge：**未授權**（Equal 嗰個授權唔帶過嚟）—— 開 PR 之後問佢。
