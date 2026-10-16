-- 一次電話可以攞到幾個台嘅 D（Kevin 2026-10-16「要可以加不只一間電訊商」）
--
-- 以前 D 係 calls 上面四個欄（d_provider／d_contract_end／d_price／d_plan），一次電話得一個台。
-- 公司好多時一半線喺 CMHK、一半喺 CSL，各有各到期日 —— 而家一行一個台，掛喺嗰次電話度。
-- ❗舊四個欄搬晒入嚟之後 drop 咗，唔留兩本數。

create table public.call_carriers (
  id            uuid primary key default gen_random_uuid(),
  call_id       uuid not null references public.calls (id) on delete cascade,
  provider      text,
  contract_end  date,
  price         text,
  plan          text,
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  constraint call_carriers_not_empty check (
    nullif(btrim(provider), '') is not null or contract_end is not null
    or nullif(btrim(price), '') is not null or nullif(btrim(plan), '') is not null)
);

comment on column public.call_carriers.contract_end is
  '❗date 唔係 timestamptz：香港 3 月 31 號存落 UTC 會變 3 月 30 號。';

create index call_carriers_call_idx on public.call_carriers (call_id, sort);

alter table public.call_carriers enable row level security;

-- 舊資料：每次有 D 資料嘅電話變一行
insert into public.call_carriers (call_id, provider, contract_end, price, plan, created_at)
select id, nullif(btrim(d_provider), ''), d_contract_end, nullif(btrim(d_price), ''), nullif(btrim(d_plan), ''), created_at
  from public.calls
 where d_contract_end is not null
    or nullif(btrim(d_provider), '') is not null
    or nullif(btrim(d_price), '') is not null
    or nullif(btrim(d_plan), '') is not null;

drop view public.company_overview;
alter table public.calls
  drop column d_contract_end,
  drop column d_price,
  drop column d_plan,
  drop column d_provider;

-- 每間公司而家用緊邊幾個台：同一個台（名無視空格大細楷）攞最新嗰次電話講嘅；
-- 冇講台名嘅（例如前台淨係講到期日）當一個「未知台」，都係攞最新嗰次。
create view public.company_carriers_current with (security_invoker = true) as
select distinct on (k.company_id, public.nospace(cc.provider))
       k.company_id, cc.id, cc.call_id, cc.provider, cc.contract_end, cc.price, cc.plan, k.called_at
  from public.call_carriers cc
  join public.calls k on k.id = cc.call_id
 order by k.company_id, public.nospace(cc.provider), k.called_at desc, cc.sort, cc.created_at;

-- 公司總覽：同舊版一樣，淨係 D 嗰幾欄改由 company_carriers_current 計：
--   d_contract_end ＝ 最早到期嗰個台（排序／篩選／續約用）
--   d_provider／d_price／d_plan ＝ 幾個台用「 / 」串埋（同一個次序）
--   d_lines ＝ 逐個台（網頁、MCP 用）
create view public.company_overview with (security_invoker = true) as
select
  c.*,
  coalesce(s.call_count, 0)        as call_count,
  s.last_call_at,
  s.last_outcome,
  coalesce(s.ever_r, false)        as ever_r,
  coalesce(s.ever_d, false)        as ever_d,
  d.d_contract_end,
  d.d_provider,
  d.d_price,
  d.d_plan,
  coalesce(p.phones, '')           as phones,
  coalesce(e.emails, '')           as emails,
  coalesce(t.open_tasks, 0)        as open_tasks,
  coalesce(pr.product_ids, '{}')   as product_ids,
  coalesce(d.d_lines, '[]'::jsonb) as d_lines
from public.companies c
left join lateral (
  select
    count(*)::int                                                              as call_count,
    max(k.called_at)                                                           as last_call_at,
    (array_agg(k.outcome order by k.called_at desc))[1]                        as last_outcome,
    bool_or(k.reached_r)                                                       as ever_r,
    bool_or(k.got_d)                                                           as ever_d
  from public.calls k
  where k.company_id = c.id
) s on true
left join lateral (
  select
    min(cur.contract_end)                                                                  as d_contract_end,
    string_agg(cur.provider, ' / ' order by cur.contract_end nulls last, cur.provider)     as d_provider,
    string_agg(cur.price, ' / ' order by cur.contract_end nulls last, cur.provider)        as d_price,
    string_agg(cur.plan, ' / ' order by cur.contract_end nulls last, cur.provider)         as d_plan,
    jsonb_agg(jsonb_build_object('provider', cur.provider, 'contract_end', cur.contract_end,
                                 'price', cur.price, 'plan', cur.plan)
              order by cur.contract_end nulls last, cur.provider)                          as d_lines
  from public.company_carriers_current cur
  where cur.company_id = c.id
) d on true
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
