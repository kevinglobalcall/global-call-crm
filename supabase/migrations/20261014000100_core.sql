-- 第一期地基：公司、電話、電郵、聯絡人、產品、興趣產品
--
-- Kevin（Global Call 電訊 B2B 冷電）一個人用。公司列表佢之後會畀：
-- 「公司名稱中英文名稱 電話號碼可能會有多個，電郵又會有多個，中英文地址行業類別等等」。

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- 搜尋無視空格（Kevin 講咗三次）。❗同 src/lib/text.ts 個 nospace() 一模一樣。
create or replace function public.nospace(t text) returns text
language sql immutable parallel safe as $$
  select regexp_replace(lower(coalesce(t, '')), '[[:space:]　]+', '', 'g')
$$;

create sequence public.company_code_seq;

create table public.companies (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique default ('GC-' || lpad(nextval('public.company_code_seq')::text, 5, '0')),
  name_zh        text,
  name_en        text,
  customer_type  text not null default '公司' check (customer_type in ('公司', '個人')),
  industry       text,
  address_zh     text,
  address_en     text,
  br_no          text,
  website        text,
  status         text not null default '未打'
                 check (status in ('未打', '跟進中', '不需要', '其他人跟進', '已成交', '已結業')),
  -- 「其他人跟進」：邊個同事跟緊 —— 填咗就唔出冷電名單
  followed_by    text,
  -- Kevin 規矩：打之前先喺公司 MIS 查過，避免打到現有客
  mis_checked    boolean not null default false,
  notes          text,
  source         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint companies_has_name check (
    coalesce(nullif(btrim(name_zh), ''), nullif(btrim(name_en), '')) is not null
  )
);

create index companies_status_idx on public.companies (status);
create index companies_industry_idx on public.companies (industry);

create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- 一間公司幾多個號都得。8 位數字（冇空格冇 +852），原文留喺 raw。
-- ❗傳真同電話分開標：CRM 個號係傳真 ＝ 打極冇人聽（Equal 中過）。
create table public.company_phones (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  phone       text not null check (phone ~ '^[2-9][0-9]{7}$'),
  label       text not null default '總機' check (label in ('總機', '直線', '手提', '傳真', '其他')),
  raw         text,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  unique (company_id, phone)
);

create index company_phones_phone_idx on public.company_phones (phone);

create table public.company_emails (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  email       text not null check (email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  unique (company_id, email)
);

create table public.contacts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  name              text not null check (btrim(name) <> ''),
  title             text,
  phone             text,
  email             text,
  is_decision_maker boolean not null default false,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index contacts_company_idx on public.contacts (company_id);

create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null unique check (btrim(name) <> ''),
  category            text,
  active              boolean not null default true,
  sort                int not null default 0,
  -- 以下第三、四期先用。❗價錢、成本、GP 計法未有就留空，唔估。
  default_monthly_fee numeric(12, 2),
  default_cost        numeric(12, 2),
  default_term_months int,
  gp_method           text,
  gp_params           jsonb,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- 開頭清單照 Kevin 溫習筆記「產品速查」。淨係名，價錢成本由佢自己入。
insert into public.products (name, category, sort) values
  ('自家品牌 Business SIM',          'SIM',     10),
  ('無限數據',                        '數據',    20),
  ('NB-IoT／工業 SIM',                'IoT',     30),
  ('SME Bundle — Starter Connect',    'Bundle',  40),
  ('SME Bundle — Business Connect',   'Bundle',  41),
  ('SME Bundle — Pro Connect',        'Bundle',  42),
  ('企業手機連月費',                  '手機',    50),
  ('CloudPhone／UC',                  '電話系統', 60),
  ('SMS／MMS 群發',                   'SMS',     70),
  ('電話會議',                        '會議',    80),
  ('ESG 基層家庭網絡支援計劃',        'ESG',     90);

-- 客對乜產品有興趣（公司頁剔）
create table public.company_products (
  company_id  uuid not null references public.companies (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (company_id, product_id)
);

create index company_products_product_idx on public.company_products (product_id);
