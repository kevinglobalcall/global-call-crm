-- 第九粒結果掣「留聯絡」（Kevin 2026-10-16「加一個按鈕 留聯絡」）
-- calls.outcome 個 check 寫死咗八個 —— 唔改呢度，網頁撳咗會爆 DB 錯。
-- ❗名同 src/domain/outcomes.ts 個 OUTCOMES 一模一樣（tests/outcomes.test.ts 對 DB 驗）。

alter table public.calls drop constraint calls_outcome_check;
alter table public.calls add constraint calls_outcome_check check (outcome in (
  '沒有人接', '不需要', '稍後再撥打', '需要跟進',
  '只接受電郵', '已電郵', '其他人跟進', '幾點鐘再打', '留聯絡'));
