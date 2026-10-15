-- 第二期：預約見面、見面備註、續約提醒「收埋」
--
-- Kevin 2026-10-14：「添加預約客戶 客戶紀錄見面備註 已約客戶日曆和時間表
--   時間表要顯示公司名稱，聯絡人，地址」「客户續約提醒」

create table public.appointments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  contact_id      uuid references public.contacts (id) on delete set null,
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  -- 約嗰陣由公司地址預填，可改 —— 見面地點未必係公司（佢可能約喺地盤、分公司）
  address         text,
  purpose         text,
  meeting_notes   text,
  status          text not null default '已約' check (status in ('已約', '已見', '取消', '冇出現')),
  rescheduled     int not null default 0 check (rescheduled >= 0),
  source_call_id  uuid references public.calls (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint appointments_end_after_start check (ends_at is null or ends_at > starts_at)
);

comment on column public.appointments.status is
  '改期唔係一個狀態：直接改 starts_at，rescheduled +1（audit_log 有舊時間）。';

create index appointments_starts_idx on public.appointments (starts_at);
create index appointments_company_idx on public.appointments (company_id, starts_at desc);

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

-- 見完客「下一步幾時跟」→ 開跟進待辦，記住由邊個約嚟
alter table public.tasks
  add column source_appointment_id uuid references public.appointments (id) on delete set null;

-- 續約提醒係「計出嚟」嘅（唔落 tasks），撳「收埋」記喺度。
-- ❗鎖住到期日：佢之後報返個新到期日（新 D），就係新一單嘢，會再出。
create table public.renewal_dismissals (
  company_id     uuid not null references public.companies (id) on delete cascade,
  contract_end   date not null,
  stage          int not null check (stage in (1, 2)),
  created_at     timestamptz not null default now(),
  primary key (company_id, contract_end, stage)
);

-- 到期前幾多日提醒（Kevin 2026-10-15 揀 90 日，30 日再提一次）。設定可改，唔寫死喺 code。
insert into public.settings (key, value) values ('renewal', '{"first": 90, "second": 30}')
on conflict (key) do nothing;

alter table public.appointments       enable row level security;
alter table public.renewal_dismissals enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.appointments, public.renewal_dismissals from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.appointments, public.renewal_dismissals from authenticated';
  end if;
end $$;
