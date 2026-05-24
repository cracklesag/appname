-- =============================================================================
-- Migration: Grass systems catalogue
-- Purpose:   Per-field grass system selection (perennial ryegrass, clover-rich,
--            herbal ley, etc.) driving N caps, N target multipliers and K
--            multipliers in reports.
-- =============================================================================
--
-- Design: shared seed rows (user_id = null) plus user-owned custom systems,
-- same pattern as `products`. Per-user visibility hiding lives in settings
-- JSONB (hiddenGrassSystemIds), so this migration doesn't need a join table.
-- =============================================================================

begin;

-- 1. Grass systems table.
create table public.grass_systems (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references auth.users(id) on delete cascade,
  -- Unique key per shared seed so reports / advisory code can look up the
  -- "perennial_ryegrass" system without hardcoding a uuid. NULL for
  -- user-created custom systems.
  seed_key              text,
  name                  text not null,
  short_label           text not null,
  description           text,
  -- Annual N cap (kg N/ha). Replaces the global settings cap when set.
  n_cap_kg_per_ha       numeric not null,
  -- Multiplier applied to base RB209 N target per cut. 1.00 = standard PRG.
  n_target_multiplier   numeric not null default 1.00 check (n_target_multiplier > 0 and n_target_multiplier <= 2),
  -- Multiplier applied to base RB209 K2O offtake. 1.00 = standard.
  k_multiplier          numeric not null default 1.00 check (k_multiplier > 0 and k_multiplier <= 2),
  -- Legume-rich flag — drives clover-suppression flag in spring report.
  is_legume_rich        boolean not null default false,
  -- Sort order for the dropdown when listed.
  sort_order            int not null default 0,
  created_at            timestamptz not null default now(),
  -- Same user can't have two systems with the same name; shared rows allowed
  -- to coexist with a user's identically-named row.
  unique (user_id, name),
  -- Only one shared seed per key — null user_id with same seed_key would be
  -- a bug. User-owned rows can have null seed_key (custom systems).
  unique (seed_key)
);

create index grass_systems_user_idx on public.grass_systems (user_id, sort_order, name);

-- 2. RLS — users see shared + own; can only write their own.
alter table public.grass_systems enable row level security;

create policy "users select shared or own grass systems"
  on public.grass_systems for select
  to authenticated
  using (user_id is null or user_id = auth.uid());

create policy "users insert own grass systems"
  on public.grass_systems for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users update own grass systems"
  on public.grass_systems for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users delete own grass systems"
  on public.grass_systems for delete
  to authenticated
  using (user_id = auth.uid());

-- 3. Seed shared rows. user_id NULL = shared. Numbers below were locked
-- against the deep research report + RB209 evidence; see app docs.
insert into public.grass_systems
  (user_id, seed_key, name, short_label, description, n_cap_kg_per_ha,
   n_target_multiplier, k_multiplier, is_legume_rich, sort_order)
values
  (null, 'perennial_ryegrass',
   'Perennial ryegrass', 'Perennial ryegrass',
   'Standard PRG sward managed for silage or silage+grazing. Reference system; multipliers are 1.00. Suits most UK dairy ground; cut profile and yield class drive per-cut splits.',
   320, 1.00, 1.00, false, 10),
  (null, 'grazed_permanent_pasture',
   'Grazed permanent pasture', 'Grazed pasture',
   'Long-established grazed sward. Rotational small N dressings, low net P/K removal (grazing returns recycle nutrients). Spring K cautious where hypomagnesaemia risk.',
   270, 0.85, 0.85, false, 20),
  (null, 'clover_rich_ley',
   'Clover-rich ley', 'Clover-rich',
   'Grass-clover mix with appreciable clover content. N requirement sharply reduced (clover fixes atmospheric N); P/K demand stays. Avoid early-spring N to maintain clover.',
   180, 0.70, 1.00, true, 30),
  (null, 'herbal_ley',
   'Herbal ley', 'Herbal ley',
   'Multi-species diverse ley with grasses, legumes and herbs (chicory, plantain, etc.). Typically low-input or stewardship-managed. Check scheme rules — many cap N at 0–100 kg/ha. Deep rooting scavenges K and trace elements.',
   100, 0.30, 0.90, true, 40),
  (null, 'hay_haylage',
   'Hay / haylage', 'Hay/haylage',
   'Conservation crop with lower N per cut than multi-cut silage. Weather window matters more than clamp silage; late slurry less compatible. P/K still meaningfully removed.',
   200, 0.60, 0.95, false, 50),
  (null, 'italian_ryegrass',
   'Italian ryegrass', 'Italian ryegrass',
   'Short-term high-yield silage ley (1–2 years). Very N- and K-responsive. Treat as intensive silage grass, not ordinary pasture. K-hungry.',
   360, 1.15, 1.20, false, 60),
  (null, 'temporary_ley_grazed',
   'Temporary ley (grazed)', 'Temp ley grazed',
   'Recent reseed managed primarily for grazing. Higher yield potential than aged permanent pasture; nutrient logic otherwise similar to grazed pasture.',
   290, 0.95, 0.95, false, 70),
  (null, 'temporary_ley_cut',
   'Temporary ley (cut)', 'Temp ley cut',
   'Recent reseed managed primarily for silage cutting. Yield potential 10–20% above old leys; nutrient logic mirrors PRG silage.',
   320, 1.00, 1.00, false, 80);

-- 4. Field foreign key. Existing fields default to perennial ryegrass.
-- Looking up the perennial_ryegrass seed id rather than baking it in.
alter table public.fields
  add column if not exists grass_system_id uuid references public.grass_systems(id) on delete set null;

update public.fields
   set grass_system_id = (select id from public.grass_systems where seed_key = 'perennial_ryegrass')
 where grass_system_id is null;

create index if not exists fields_grass_system_id_idx on public.fields (grass_system_id);

commit;
