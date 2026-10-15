# Global Call CRM

Kevin 自己用嘅冷電 CRM：匯入公司名單 → 打電話撳八粒掣記低 → R／D、回撥、每日數 → 導出 Excel。
手機電腦都用得；喺 claude.ai 講一句都入到記錄。

## 第一次開機（照次序做，大約 20 分鐘）

1. **Supabase**（資料庫）
   - 去 supabase.com → 開新 organization，揀 **Free** plan（❗唔好開喺 Equal 嗰個 org 入面：
     嗰個如果係 Pro，多開一個 project 會另外收錢）。
   - 開 project：region 揀 **Singapore**，DB 密碼自己諗一個記住。
   - 開好之後撳頂部 **Connect** → 揀 **Session pooler** → 抄嗰條 `postgresql://…`，
     將入面 `[YOUR-PASSWORD]` 換做你個 DB 密碼。
2. **Fly.io**（部機）
   - fly.io → Account → Access Tokens → **Create Org token**，抄低。
3. **GitHub secrets**（❗唔好貼落對話）
   - 呢個 repo → Settings → Secrets and variables → Actions → **New repository secret**，加三個：
     - `FLY_API_TOKEN`：第 2 步嗰條
     - `DATABASE_URL`：第 1 步嗰條（已經換咗密碼）
     - `APP_PASSWORD`：你登入 CRM 用嘅密碼（最少 10 個字）
4. **開機**
   - Actions → **① 開 Fly app／更新設定** → Run workflow（等佢綠）
   - Actions → **② 測試＋部署** → Run workflow（等佢綠，最後一步會寫「✅ https://global-call-crm.fly.dev 行緊 …」）
5. **用**
   - 手機開 `https://global-call-crm.fly.dev/app`，入 `APP_PASSWORD`。可以「加到主畫面」。
   - 更多 → 匯入公司名單（Excel／CSV）。
6. **同 Claude 講一句就入記錄**
   - claude.ai → Settings → Connectors → Add custom connector → URL 填
     `https://global-call-crm.fly.dev/mcp` → 彈出嚟嗰版入 `APP_PASSWORD` 批准。
   - 例：「啱啱打咗畀 GC-00012，搵到 IT 經理，佢 CSL 合約 3 月到期，聽日 3 點再打」。

改密碼：改 GitHub secret `APP_PASSWORD` → 撳 ① → 撳 ②。
想所有裝置同 claude.ai 都要重新登入：Fly 剷咗 `SESSION_SECRET` → 撳 ①（會出條新嘅）→ 撳 ②。

## 每晚備份同還原

**⑤ 每晚備份**（香港 03:07）會出兩樣，喺 Actions 嗰次 run 下面撳 artifact 下載（留 90 日）：
- `csv/` —— 每張表一個 CSV，**Excel 直接開**，唔使任何軟件
- `gc-<日子>.dump` —— 成個資料庫，可以完整還原

還原（要有部 Postgres，例如新開一個 Supabase project）：

```bash
pg_restore --no-owner --no-privileges -d "<新 project 嘅 DATABASE_URL>" gc-2026-10-14.dump
```

❗未試過還原嘅備份唔算備份 —— 第一次用之前，開個新 Supabase project 試一次。

## 收費（以 Fly／Supabase 自己畫面為準）

- Fly：一部 shared-cpu-1x 512MB 長開，大約 US$3–5／月；**淨用共享 IPv4（免費）**。
  ⑦ 揀「睇數」會列出部機、volume、IP，一眼睇收唔收緊錢；唔用嗰陣揀「熄機」。
- Supabase：Free plan $0（500MB DB，一間公司幾 KB，十萬間都夠）。

## 開發

見 `CLAUDE.md`「本機開發」。`npx vitest run`（要 `TEST_DATABASE_URL`）＋ `npx tsc --noEmit` 兩樣綠先好 merge。
