-- 第十粒結果掣「唔通」＋ 公司新狀態「唔通」（Kevin 2026-10-16「加個唔通按鈕」→「轉 唔通」）
-- ❗名同 src/domain/outcomes.ts 個 OUTCOMES／COMPANY_STATUSES 一模一樣（tests/calls.test.ts 逐粒寫入真 DB 驗）。

alter table public.calls drop constraint calls_outcome_check;
alter table public.calls add constraint calls_outcome_check check (outcome in (
  '沒有人接', '不需要', '稍後再撥打', '需要跟進',
  '只接受電郵', '已電郵', '其他人跟進', '幾點鐘再打', '留聯絡', '唔通'));

alter table public.companies drop constraint companies_status_check;
alter table public.companies add constraint companies_status_check check (status in (
  '未打', '跟進中', '不需要', '唔通', '其他人跟進', '已成交', '已結業'));
