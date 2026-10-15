-- 設定、audit、公司總覽 view、RLS

create table public.settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- 每次寫入記低：邊度做（web／mcp）、做乜、改之前改之後。
-- Equal CRM 靠呢張表捉到「口講改咗但冇落地」—— 冇 audit 嘅寫入等於冇發生過。
create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       text not null,
  action      text not null,
  table_name  text not null,
  record_id   text,
  before      jsonb,
  after       jsonb
);

create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_record_idx on public.audit_log (table_name, record_id);

-- 公司清單一次過攞齊：打過幾多次、最後結果、R／D、D 資料、電話（傳真有標）、電郵、待辦、興趣產品。
-- ❗security_invoker：用查詢嗰個人嘅權限 —— 唔係 view 主人，唔會繞過 RLS。
create view public.company_overview with (security_invoker = true) as
select
  c.*,
  coalesce(s.call_count, 0)        as call_count,
  s.last_call_at,
  s.last_outcome,
  coalesce(s.ever_r, false)        as ever_r,
  coalesce(s.ever_d, false)        as ever_d,
  s.d_contract_end,
  s.d_provider,
  s.d_price,
  s.d_plan,
  coalesce(p.phones, '')           as phones,
  coalesce(e.emails, '')           as emails,
  coalesce(t.open_tasks, 0)        as open_tasks,
  coalesce(pr.product_ids, '{}')   as product_ids
from public.companies c
left join lateral (
  select
    count(*)::int                                                              as call_count,
    max(k.called_at)                                                           as last_call_at,
    (array_agg(k.outcome order by k.called_at desc))[1]                        as last_outcome,
    bool_or(k.reached_r)                                                       as ever_r,
    bool_or(k.got_d)                                                           as ever_d,
    (array_agg(k.d_contract_end order by k.called_at desc)
       filter (where k.d_contract_end is not null))[1]                         as d_contract_end,
    (array_agg(k.d_provider order by k.called_at desc)
       filter (where nullif(btrim(k.d_provider), '') is not null))[1]          as d_provider,
    (array_agg(k.d_price order by k.called_at desc)
       filter (where nullif(btrim(k.d_price), '') is not null))[1]             as d_price,
    (array_agg(k.d_plan order by k.called_at desc)
       filter (where nullif(btrim(k.d_plan), '') is not null))[1]              as d_plan
  from public.calls k
  where k.company_id = c.id
) s on true
left join lateral (
  select string_agg(ph.phone || case when ph.label = '傳真' then '（傳真）' else '' end,
                    ' / ' order by ph.sort, ph.created_at) as phones
  from public.company_phones ph where ph.company_id = c.id
) p on true
left join lateral (
  select string_agg(em.email, ' / ' order by em.sort, em.created_at) as emails
  from public.company_emails em where em.company_id = c.id
) e on true
left join lateral (
  select count(*)::int as open_tasks
  from public.tasks tk where tk.company_id = c.id and tk.status = '待辦'
) t on true
left join lateral (
  select array_agg(cp.product_id order by cp.created_at) as product_ids
  from public.company_products cp where cp.company_id = c.id
) pr on true;

-- RLS 全開、冇 policy：Supabase 個 anon／authenticated key 乜都讀唔到。
-- server 用表主人身份連（直連 Postgres），唔受影響。
alter table public.companies        enable row level security;
alter table public.company_phones   enable row level security;
alter table public.company_emails   enable row level security;
alter table public.contacts         enable row level security;
alter table public.products         enable row level security;
alter table public.company_products enable row level security;
alter table public.calls            enable row level security;
alter table public.tasks            enable row level security;
alter table public.settings         enable row level security;
alter table public.audit_log        enable row level security;

-- Supabase 有 anon／authenticated 兩個 role；本機測試嘅 Postgres 冇。有先收權。
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
  end if;
end $$;
