-- 備註記錄（Remark Record）—— Kevin 2026-10-16 掉咗公司 MIS 張截圖：「之後做這種remark」
--
-- 一間公司一條時間線：每行一個時間、邊個寫、內容，最新喺頂。
-- 網頁會同電話記錄（calls）合埋一條時間線顯示（Kevin 揀「合埋一條時間線」），
-- 但兩樣分開存：電話有結果掣／R／D／每日數，備註淨係自由文字。
--
-- source：web（Kevin 喺網頁寫）／mcp（經 claude.ai 寫）／import（名單匯入，原日期不明 ——
--   created_at 係匯入嗰刻，唔係當時打電話嘅日子，網頁唔會扮有時間）。

create table public.company_remarks (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  body        text not null check (length(btrim(body)) > 0),
  author      text not null default 'Kevin',
  source      text not null default 'web' check (source in ('web', 'mcp', 'import')),
  created_at  timestamptz not null default now()
);

create index company_remarks_company_idx on public.company_remarks (company_id, created_at desc);

alter table public.company_remarks enable row level security;
