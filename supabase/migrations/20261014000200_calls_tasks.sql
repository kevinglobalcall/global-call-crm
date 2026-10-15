-- 電話記錄同待辦（回撥／跟進／寄電郵）
--
-- Kevin：「每打個電話後面可以有點選 沒有人接 不需要 稍後再撥打 需要跟進 只接受電郵 已電郵
--   其他人跟進 幾點鐘再打 然後有欄位輸入第幾次致電， 內容 ，是否找到負責人一般我們叫R，
--   如果有詳盡例如拿到他的合約到期日，價錢，套餐內容我們稱之為D。」

create table public.calls (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  contact_id      uuid references public.contacts (id) on delete set null,
  called_at       timestamptz not null default now(),
  attempt_no      int not null check (attempt_no >= 1),
  outcome         text not null check (outcome in (
                    '沒有人接', '不需要', '稍後再撥打', '需要跟進',
                    '只接受電郵', '已電郵', '其他人跟進', '幾點鐘再打')),
  callback_at     timestamptz,
  content         text,
  -- R：搵到負責人
  reached_r       boolean not null default false,
  -- D：攞到詳盡資料（合約到期日、而家價錢、套餐內容、用緊邊個台）
  got_d           boolean not null default false,
  d_contract_end  date,
  d_price         text,
  d_plan          text,
  d_provider      text,
  other_follower  text,
  phone_dialed    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint calls_time_needs_callback check (outcome <> '幾點鐘再打' or callback_at is not null),
  constraint calls_other_needs_name check (outcome <> '其他人跟進' or nullif(btrim(other_follower), '') is not null)
);

comment on column public.calls.d_contract_end is
  '❗date 唔係 timestamptz：香港 3 月 31 號存落 UTC 會變 3 月 30 號。';

create index calls_company_idx on public.calls (company_id, called_at desc);
create index calls_called_at_idx on public.calls (called_at);

create trigger calls_set_updated_at
  before update on public.calls
  for each row execute function public.set_updated_at();

create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  kind               text not null check (kind in ('回撥', '跟進', '寄電郵', '到期提醒', '其他')),
  due_at             timestamptz,
  status             text not null default '待辦' check (status in ('待辦', '完成', '取消')),
  note               text,
  source_call_id     uuid references public.calls (id) on delete set null,
  closed_by_call_id  uuid references public.calls (id) on delete set null,
  closed_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint tasks_closed_consistent check ((status = '待辦') = (closed_at is null))
);

comment on column public.tasks.due_at is
  '冇時間（null）＝「稍後再撥打」冇揀時間 —— 照樣出喺今日回撥清單，排最尾。';
comment on column public.tasks.closed_by_call_id is
  '❗再打一次電話，舊嘅回撥／跟進／寄電郵自動收，記低係邊次電話收嘅。
   Equal CRM 教訓：答咗唔收返源頭，件事第二日會翻生。';

create index tasks_open_idx on public.tasks (status, due_at);
create index tasks_company_idx on public.tasks (company_id, status);

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();
