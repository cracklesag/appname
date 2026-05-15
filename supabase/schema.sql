-- =====================================================================
-- SCHEMA — paste this into Supabase SQL editor and run
-- =====================================================================
-- Designed for future multi-tenant migration: every row already carries
-- a user_id linked to auth.users. RLS ensures users only see their own
-- data even in single-tenant mode.
-- =====================================================================

-- ---------- FIELDS ----------
create table public.fields (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  name         text not null,
  acres        numeric not null check (acres > 0),
  ha           numeric not null check (ha > 0),
  cut_profile  int not null default 1 check (cut_profile between 1 and 4),
  planned_cuts jsonb not null default '["silage"]'::jsonb,
  ph           numeric,
  p_idx        numeric,
  k_idx        numeric,
  sampled      boolean not null default false,
  sample_date  date,
  last_ploughed   date,
  last_reseeded   date,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.fields (user_id);

-- ---------- PRODUCTS ----------
-- Shared across users (read-only catalogue). Slurry's NPK is configurable per record.
create table public.products (
  id            int primary key,
  name          text not null,
  type          text not null check (type in ('bag_fert', 'slurry', 'lime')),
  n_pct         numeric,
  p2o5_pct      numeric,
  k2o_pct       numeric,
  s_pct         numeric,
  n_kg_per_m3   numeric,
  p2o5_kg_per_m3 numeric,
  k2o_kg_per_m3 numeric
);

-- ---------- APPLICATIONS ----------
create table public.applications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  field_id      uuid references public.fields(id) on delete cascade not null,
  product_id    int references public.products(id) not null,
  date_applied  date not null,
  rate_value    numeric not null check (rate_value > 0),
  rate_unit     text not null,
  method        text,
  notes         text,
  applied_by    text default 'me',
  created_at    timestamptz not null default now()
);
create index on public.applications (user_id, field_id, date_applied desc);

-- ---------- CUTS ----------
create table public.cuts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  field_id      uuid references public.fields(id) on delete cascade not null,
  cut_number    int not null check (cut_number between 1 and 4),
  cut_date      date not null,
  cut_type      text not null default 'silage' check (cut_type in ('silage','bales','grazing')),
  yield_class   text not null default 'average' check (yield_class in ('light','average','heavy')),
  notes         text,
  created_at    timestamptz not null default now()
);
create index on public.cuts (user_id, field_id, cut_date desc);

-- ---------- SETTINGS ----------
create table public.settings (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  data     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- ROW-LEVEL SECURITY
-- =====================================================================
alter table public.fields       enable row level security;
alter table public.applications enable row level security;
alter table public.cuts         enable row level security;
alter table public.settings     enable row level security;
alter table public.products     enable row level security;

-- Products: everyone can read
create policy "products are readable by all authed users"
  on public.products for select
  to authenticated using (true);

-- Fields: own rows only
create policy "users select own fields"  on public.fields for select using (auth.uid() = user_id);
create policy "users insert own fields"  on public.fields for insert with check (auth.uid() = user_id);
create policy "users update own fields"  on public.fields for update using (auth.uid() = user_id);
create policy "users delete own fields"  on public.fields for delete using (auth.uid() = user_id);

-- Applications: own rows only
create policy "users select own applications"  on public.applications for select using (auth.uid() = user_id);
create policy "users insert own applications"  on public.applications for insert with check (auth.uid() = user_id);
create policy "users update own applications"  on public.applications for update using (auth.uid() = user_id);
create policy "users delete own applications"  on public.applications for delete using (auth.uid() = user_id);

-- Cuts: own rows only
create policy "users select own cuts"  on public.cuts for select using (auth.uid() = user_id);
create policy "users insert own cuts"  on public.cuts for insert with check (auth.uid() = user_id);
create policy "users update own cuts"  on public.cuts for update using (auth.uid() = user_id);
create policy "users delete own cuts"  on public.cuts for delete using (auth.uid() = user_id);

-- Settings: own row only
create policy "users select own settings" on public.settings for select using (auth.uid() = user_id);
create policy "users upsert own settings" on public.settings for all    using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================================
-- PRODUCTS SEED (shared catalogue)
-- =====================================================================
insert into public.products (id, name, type, n_pct, p2o5_pct, k2o_pct, s_pct, n_kg_per_m3, p2o5_kg_per_m3, k2o_kg_per_m3) values
  (1, '25-5-5+S',          'bag_fert', 25, 5, 5, 8, null, null, null),
  (2, 'CAN+S (27%N)',      'bag_fert', 27, 0, 0, 12, null, null, null),
  (3, 'MOP (60%K)',        'bag_fert', 0, 0, 60, null, null, null, null),
  (4, 'Dairy slurry (6% DM)', 'slurry', null, null, null, null, 2.6, 1.2, 3.2),
  (5, 'Lime',              'lime', null, null, null, null, null, null, null)
on conflict (id) do nothing;
