-- 20260607_product_analyses.sql
-- Dated history of a product's nutrient analysis, so editing a product's values
-- does NOT retroactively rewrite past spreading records. An application is
-- valued using the analysis version whose effective_from is the latest date on
-- or before the application's date. Existing custom products are backfilled as a
-- far-past "v1" copying their current values, so current history is unchanged.
-- Shared catalogue products (user_id IS NULL, ids 1-99) are constant and not
-- versioned. RLS mirrors public.products (farm members read; farm admins write).
-- Idempotent.

begin;

create table if not exists public.product_analyses (
  id uuid primary key default gen_random_uuid(),
  product_id integer not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  effective_from date not null,
  dm_pct double precision,
  form text,
  density_kg_per_l double precision,
  n_pct double precision,
  p2o5_pct double precision,
  k2o_pct double precision,
  s_pct double precision,
  n_kg_per_m3 double precision,
  p2o5_kg_per_m3 double precision,
  k2o_kg_per_m3 double precision,
  so3_kg_per_m3 double precision,
  mgo_kg_per_m3 double precision,
  n_kg_per_t double precision,
  p2o5_kg_per_t double precision,
  k2o_kg_per_t double precision,
  so3_kg_per_t double precision,
  mgo_kg_per_t double precision,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index if not exists product_analyses_product_idx
  on public.product_analyses (product_id, effective_from desc);

-- Backfill: one far-past v1 per existing custom product, copying current values,
-- so every application that predates any edit resolves to the values it was
-- actually spread with.
insert into public.product_analyses (
  product_id, user_id, effective_from,
  dm_pct, form, density_kg_per_l,
  n_pct, p2o5_pct, k2o_pct, s_pct,
  n_kg_per_m3, p2o5_kg_per_m3, k2o_kg_per_m3, so3_kg_per_m3, mgo_kg_per_m3,
  n_kg_per_t, p2o5_kg_per_t, k2o_kg_per_t, so3_kg_per_t, mgo_kg_per_t
)
select
  p.id, p.user_id, date '2000-01-01',
  p.dm_pct, p.form, p.density_kg_per_l,
  p.n_pct, p.p2o5_pct, p.k2o_pct, p.s_pct,
  p.n_kg_per_m3, p.p2o5_kg_per_m3, p.k2o_kg_per_m3, p.so3_kg_per_m3, p.mgo_kg_per_m3,
  p.n_kg_per_t, p.p2o5_kg_per_t, p.k2o_kg_per_t, p.so3_kg_per_t, p.mgo_kg_per_t
from public.products p
where p.user_id is not null
  and not exists (select 1 from public.product_analyses a where a.product_id = p.id);

alter table public.product_analyses enable row level security;

drop policy if exists "farm members select product_analyses" on public.product_analyses;
create policy "farm members select product_analyses"
  on public.product_analyses for select
  using (public.is_member_of(user_id));

drop policy if exists "farm admins insert product_analyses" on public.product_analyses;
create policy "farm admins insert product_analyses"
  on public.product_analyses for insert
  with check (public.is_admin_of(user_id));

drop policy if exists "farm admins update product_analyses" on public.product_analyses;
create policy "farm admins update product_analyses"
  on public.product_analyses for update
  using (public.is_admin_of(user_id)) with check (public.is_admin_of(user_id));

drop policy if exists "farm admins delete product_analyses" on public.product_analyses;
create policy "farm admins delete product_analyses"
  on public.product_analyses for delete
  using (public.is_admin_of(user_id));

commit;
