-- =====================================================================
-- SCHEMA — paste this into Supabase SQL editor and run
-- =====================================================================
-- Designed for future multi-tenant migration: every row already carries
-- a user_id linked to auth.users. RLS ensures users only see their own
-- data even in single-tenant mode.
-- =====================================================================

-- ---------- GROUPS (blocks of land) ----------
-- Named groupings of fields, e.g. "Top Farm", "River Meadows".
-- One group per field; created and managed by the user. Deleting a group
-- ungroups its fields rather than deleting them (ON DELETE SET NULL on the
-- fields.group_id FK below).
create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);
create index groups_user_sort_idx on public.groups (user_id, sort_order, name);

-- ---------- FIELDS ----------
create table public.fields (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  group_id     uuid references public.groups(id) on delete set null,
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
create index fields_group_id_idx on public.fields (group_id) where group_id is not null;

-- ---------- PRODUCTS ----------
-- Shared catalogue + user-owned custom rows. user_id IS NULL → shared row
-- (visible to all users, immutable via RLS). user_id = auth.uid() → custom
-- row owned by that user. IDs 1-99 are reserved for shared rows; custom
-- rows auto-allocate from the products_id_seq sequence starting at 1000.
--
-- Storage convention by `type`:
--   bag_fert     — *_pct columns (% w/w)
--   slurry       — *_kg_per_m3 columns (kg per cubic metre of product)
--   solid_manure — *_kg_per_t columns (kg per tonne of fresh-weight product)
--   lime         — no nutrient columns used
--
-- `dm_pct`     — dry matter, used by the application form to group DM-band
--                variants of the same product (e.g. dairy slurry at 2/6/10%).
-- `category`   — menu grouping key (dairy_slurry, pig_slurry, fym, poultry,
--                separated_slurry, digestate, biosolids, bag_fert, lime,
--                custom).
-- `sort_order` — within-category ordering for the picker.
create sequence if not exists public.products_id_seq as integer start with 1000;

create table public.products (
  id            int primary key default nextval('public.products_id_seq'),
  user_id       uuid references auth.users(id) on delete cascade,
  name          text not null,
  type          text not null check (type in ('bag_fert', 'slurry', 'solid_manure', 'lime')),
  category      text,
  sort_order    int not null default 0,
  dm_pct        numeric,
  -- bag fert (% w/w)
  n_pct         numeric,
  p2o5_pct      numeric,
  k2o_pct       numeric,
  s_pct         numeric,
  -- slurry / liquid manure (kg per m³)
  n_kg_per_m3   numeric,
  p2o5_kg_per_m3 numeric,
  k2o_kg_per_m3 numeric,
  so3_kg_per_m3 numeric,
  mgo_kg_per_m3 numeric,
  -- solid manure (kg per tonne fresh weight)
  n_kg_per_t    numeric,
  p2o5_kg_per_t numeric,
  k2o_kg_per_t  numeric,
  so3_kg_per_t  numeric,
  mgo_kg_per_t  numeric
);
alter sequence public.products_id_seq owned by public.products.id;
create index on public.products (type, category, sort_order);
create index on public.products (user_id);

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
alter table public.groups       enable row level security;
alter table public.applications enable row level security;
alter table public.cuts         enable row level security;
alter table public.settings     enable row level security;
alter table public.products     enable row level security;

-- Products: shared rows readable by all, user-owned rows readable + writable
-- only by their owner. Shared rows have user_id IS NULL.
create policy "users select shared and own products"
  on public.products for select
  to authenticated
  using (user_id is null or user_id = auth.uid());

create policy "users insert own products"
  on public.products for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users update own products"
  on public.products for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users delete own products"
  on public.products for delete
  to authenticated
  using (user_id = auth.uid());

-- Fields: own rows only
create policy "users select own fields"  on public.fields for select using (auth.uid() = user_id);
create policy "users insert own fields"  on public.fields for insert with check (auth.uid() = user_id);
create policy "users update own fields"  on public.fields for update using (auth.uid() = user_id);
create policy "users delete own fields"  on public.fields for delete using (auth.uid() = user_id);

-- Groups: own rows only
create policy "users select own groups"  on public.groups for select using (auth.uid() = user_id);
create policy "users insert own groups"  on public.groups for insert with check (auth.uid() = user_id);
create policy "users update own groups"  on public.groups for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users delete own groups"  on public.groups for delete using (auth.uid() = user_id);

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
-- See AMENDMENTS_REFERENCE.md for sources and rationale.
-- IDs are stable: applications.product_id references these and historical
-- data depends on them not moving.

-- Bag fertilisers (% w/w)
insert into public.products (id, name, type, category, sort_order,
  n_pct, p2o5_pct, k2o_pct, s_pct) values
  (1, '25-5-5+S',         'bag_fert', 'bag_fert', 1, 25, 5, 5,  8),
  (2, 'CAN+S (27%N)',     'bag_fert', 'bag_fert', 2, 27, 0, 0, 12),
  (3, 'MOP (60%K)',       'bag_fert', 'bag_fert', 3,  0, 0, 60, null)
on conflict (id) do nothing;

-- Lime
insert into public.products (id, name, type, category, sort_order) values
  (5, 'Lime', 'lime', 'lime', 1)
on conflict (id) do nothing;

-- Slurry / liquid manures (kg per m³). RB209 (2023) tables 2.8-2.13, 2.17-2.21.
insert into public.products
  (id, name, type, category, sort_order, dm_pct,
   n_kg_per_m3, p2o5_kg_per_m3, k2o_kg_per_m3, so3_kg_per_m3, mgo_kg_per_m3) values
  -- Dairy slurry, three DM bands. id=4 is the historical default (6% DM) —
  -- kept at id 4 so existing applications still resolve. RB209 (2023) lowered
  -- K₂O from 3.2 to 2.5 vs older revisions.
  (6,  'Dairy slurry (2% DM)',  'slurry', 'dairy_slurry', 1,  2,  1.6, 0.6, 1.7, 0.3, 0.2),
  (4,  'Dairy slurry (6% DM)',  'slurry', 'dairy_slurry', 2,  6,  2.6, 1.2, 2.5, 0.7, 0.6),
  (7,  'Dairy slurry (10% DM)', 'slurry', 'dairy_slurry', 3, 10,  3.6, 1.8, 3.4, 1.0, 0.9),
  -- Pig slurry, three DM bands. RB209 typical is 4% DM (thinner than dairy).
  (10, 'Pig slurry (2% DM)',    'slurry', 'pig_slurry',   1,  2,  3.0, 0.8, 1.8, 0.4, 0.4),
  (11, 'Pig slurry (4% DM)',    'slurry', 'pig_slurry',   2,  4,  3.6, 1.5, 2.2, 0.7, 0.7),
  (12, 'Pig slurry (6% DM)',    'slurry', 'pig_slurry',   3,  6,  4.4, 2.2, 2.6, 1.0, 1.0),
  -- Separated cattle slurry — liquid fraction. RB209 lists three separator
  -- types; the mechanical separator (4% DM) is the modern norm and the only
  -- default seeded. RB209 has no S/Mg data for this product.
  (15, 'Separated cattle slurry — liquid', 'slurry', 'separated_slurry', 1, 4,
    3.0, 1.2, 2.8, null, null),
  -- Digestate liquid forms. Farm-sourced seeded first per amendments doc.
  (30, 'Digestate — whole (farm-sourced)',  'slurry', 'digestate', 1, 5.5,
    3.6, 1.7, 4.4, 0.8, 0.6),
  (31, 'Digestate — liquor (farm-sourced)', 'slurry', 'digestate', 2, 3.0,
    1.9, 0.6, 2.5, 0.1, 0.4),
  (33, 'Digestate — whole (food-based)',    'slurry', 'digestate', 4, 4.1,
    4.8, 1.1, 2.4, 0.7, 0.2),
  (34, 'Digestate — liquor (food-based)',   'slurry', 'digestate', 5, 3.8,
    4.5, 1.0, 2.8, 1.0, 0.2)
on conflict (id) do nothing;

-- Solid manures (kg per tonne fresh weight). RB209 tables 2.2-2.7, 2.15-2.16.
insert into public.products
  (id, name, type, category, sort_order, dm_pct,
   n_kg_per_t, p2o5_kg_per_t, k2o_kg_per_t, so3_kg_per_t, mgo_kg_per_t) values
  -- FYM
  (20, 'Cattle FYM',                              'solid_manure', 'fym',              1, 25,
    6.0,  3.2,  9.4, 2.4, 1.8),
  (21, 'Pig FYM',                                 'solid_manure', 'fym',              2, 25,
    7.0,  6.0,  8.0, 3.4, 1.8),
  -- Separated cattle slurry — solid fraction
  (16, 'Separated cattle slurry — solid',         'solid_manure', 'separated_slurry', 2, 20,
    4.0,  2.0,  3.3, null, null),
  -- Poultry — by source per "Approach B" in the amendments doc
  (23, 'Layer manure (loose, fresh)',             'solid_manure', 'poultry',          1, 20,
    9.4,  8.0,  8.5, 3.0, 2.7),
  (24, 'Layer manure (housed, stored)',           'solid_manure', 'poultry',          2, 40,
    19.0, 12.0, 15.0, 5.6, 4.3),
  (25, 'Broiler/turkey litter',                   'solid_manure', 'poultry',          3, 60,
    28.0, 17.0, 21.0, 8.2, 5.9),
  (26, 'Deep-pit / dried poultry manure',         'solid_manure', 'poultry',          4, 80,
    37.0, 21.0, 27.0, 11.0, 7.5),
  -- Biosolids cake. P₂O₅ at 11 pending RB209 (2023) physical-copy verification.
  (27, 'Biosolids — digested cake',               'solid_manure', 'biosolids',        1, 25,
    11.0, 11.0, 0.6,  8.2, 1.6),
  -- Digestate fibre
  (32, 'Digestate — fibre (farm-sourced)',        'solid_manure', 'digestate',        3, 24,
    5.6,  4.7,  6.0,  2.1, 1.8),
  (35, 'Digestate — fibre (food-based)',          'solid_manure', 'digestate',        6, 27,
    8.9, 10.0,  3.0,  4.1, 2.2)
on conflict (id) do nothing;
