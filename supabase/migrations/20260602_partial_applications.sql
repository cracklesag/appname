-- =====================================================================
-- Swardly · Partial (part-field) applications + K loading heat map
-- Run this in the Supabase SQL editor BEFORE deploying the dependent code.
-- Safe to re-run (idempotent): create table if not exists / add column if
-- not exists / drop policy if exists throughout. No data is destroyed.
-- =====================================================================
--
-- Model
-- -----
-- A "part application" covers only PART of a field, so it must NOT distort
-- the field's nutrient metrics while it is still partial. We mark such an
-- application with coverage = 'partial' and store the drawn sub-area(s) in
-- application_areas. The nutrient engine excludes partial applications until
-- their field "reconciles" — i.e. until the union of the field's pending
-- partial areas covers ~the whole field (>= 95%). On reconciliation,
-- reconciled_at is stamped and the partials fold into the metrics, area-
-- weighted by each patch's drawn area (see lib/partials.ts).
--
-- RLS is farm-aware, mirroring the cuts/applications family from
-- 20260529_farm_roles.sql: any farm MEMBER may read; members may insert
-- rows they create (created_by = self) on their farm; admins edit anything
-- in the farm, staff only rows they created. user_id is the farm OWNER.

-- ---------------------------------------------------------------------
-- 1. New columns on applications
-- ---------------------------------------------------------------------
-- coverage: 'whole' (normal, default) | 'partial' (drawn sub-area only).
alter table public.applications
  add column if not exists coverage text not null default 'whole';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'applications_coverage_check'
  ) then
    alter table public.applications
      add constraint applications_coverage_check
      check (coverage in ('whole', 'partial'));
  end if;
end $$;

-- reconciled_at: set when the field's partials reach full coverage and the
-- application folds into the field nutrient metrics. NULL = still pending.
alter table public.applications
  add column if not exists reconciled_at timestamptz;

-- drawn_ha: total drawn area (ha) for a partial application = sum of its
-- application_areas.area_ha. Cached on the row so the nutrient sum sites can
-- area-weight a reconciled partial without loading application_areas.
alter table public.applications
  add column if not exists drawn_ha numeric;

-- ---------------------------------------------------------------------
-- 2. application_areas: the drawn sub-polygon(s) for a partial application
-- ---------------------------------------------------------------------
create table if not exists public.application_areas (
  id             uuid primary key default gen_random_uuid(),
  -- Farm owner (admin) — all shared data is owned by this id, like every
  -- other field-scoped table.
  user_id        uuid not null references auth.users(id) on delete cascade,
  -- Who actually drew it (admin or staff).
  created_by     uuid references auth.users(id) on delete set null,
  application_id uuid not null references public.applications(id) on delete cascade,
  field_id       uuid not null references public.fields(id) on delete cascade,
  polygon        jsonb not null,            -- GeoJSON Polygon/MultiPolygon, [lng,lat]
  area_ha        numeric not null,          -- geodesic area of the drawn sub-area
  created_at     timestamptz not null default now()
);
create index if not exists application_areas_field_idx on public.application_areas (field_id);
create index if not exists application_areas_app_idx   on public.application_areas (application_id);
create index if not exists application_areas_user_idx  on public.application_areas (user_id);

alter table public.application_areas enable row level security;

-- ---- SELECT: any member of the farm ----
drop policy if exists "farm members select application_areas" on public.application_areas;
create policy "farm members select application_areas"
  on public.application_areas for select
  using (public.is_member_of(user_id));

-- ---- INSERT: any member; row owned by the farm owner, created_by = self ----
drop policy if exists "farm members insert application_areas" on public.application_areas;
create policy "farm members insert application_areas"
  on public.application_areas for insert
  with check (public.is_member_of(user_id) and created_by = auth.uid());

-- ---- UPDATE: admins anything in the farm; staff only rows they created ----
drop policy if exists "farm update application_areas" on public.application_areas;
create policy "farm update application_areas"
  on public.application_areas for update
  using (public.is_admin_of(user_id) or (public.is_member_of(user_id) and created_by = auth.uid()))
  with check (public.is_admin_of(user_id) or (public.is_member_of(user_id) and created_by = auth.uid()));

-- ---- DELETE: admins anything in the farm; staff only rows they created ----
drop policy if exists "farm delete application_areas" on public.application_areas;
create policy "farm delete application_areas"
  on public.application_areas for delete
  using (public.is_admin_of(user_id) or (public.is_member_of(user_id) and created_by = auth.uid()));

-- ---------------------------------------------------------------------
-- 3. Fallback for brand-new accounts with no membership yet (mirrors the
--    cuts/applications belt-and-braces in 20260529_roles_fix.sql, so a
--    first-run admin can write before their self-admin row exists).
-- ---------------------------------------------------------------------
drop policy if exists "self insert application_areas fallback" on public.application_areas;
create policy "self insert application_areas fallback"
  on public.application_areas for insert
  with check (user_id = auth.uid() and public.has_no_membership());

-- Done. Existing applications default to coverage = 'whole' and behave
-- exactly as before; application_areas starts empty.
