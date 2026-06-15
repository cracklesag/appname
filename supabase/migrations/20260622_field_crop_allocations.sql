-- =====================================================================
-- Swardly · Field crop allocations (public.field_crop_allocations)
-- Run in the Supabase SQL editor BEFORE deploying. Idempotent; one
-- transaction. Run AFTER 20260621_crops.sql (this FKs to public.crops).
-- =====================================================================
--
-- Allocating a field to a crop for a season. This row is what makes a field a
-- "crop field" for that season: reports/groupings filter on whether an active
-- allocation exists, rather than any flag on the field. Grass fields are the
-- default (no allocation) and are untouched.
--
-- Season is the END year (matches getSeasonLabel): 2026 == 1 Oct 2025–30 Sep 2026.
--
-- Catch + main crop in one season is supported: MULTIPLE allocations per field
-- per season are allowed, but only ONE may be 'active' at a time (a partial
-- unique index). A catch crop goes 'harvested' before the main crop becomes
-- 'active'.
--
-- RLS: read = any farm member (incl. agronomist); write = admin/staff
-- (can_log_of) — allocating/terminating a crop is a logging action, so the
-- agronomist (read-only advisor) is excluded, consistent with applications/cuts.

begin;

-- ---------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------
create table if not exists public.field_crop_allocations (
  id                    uuid primary key default gen_random_uuid(),
  -- Farm owner (admin) — all shared farm data is owned by this id.
  user_id               uuid not null references auth.users(id) on delete cascade,
  field_id              uuid not null references public.fields(id) on delete cascade,
  -- The chosen crop profile: a shared seed or a user fork.
  crop_id               uuid not null references public.crops(id) on delete restrict,
  -- Denormalised stable key of the crop, copied at allocation time so the
  -- engine + rotation logic need no join. Null only if the crop had no key.
  crop_key              text,
  -- Season end-year, e.g. 2026 = 1 Oct 2025 – 30 Sep 2026.
  season                int not null,
  expected_yield        numeric,
  expected_yield_unit   text,
  sown_date             date,
  harvest_date          date,
  status                text not null default 'planned'
                          check (status in ('planned', 'active', 'harvested', 'terminated')),
  notes                 text,
  -- Who created the allocation (admin or staff).
  created_by            uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists field_crop_allocations_field_season_idx
  on public.field_crop_allocations (field_id, season);
create index if not exists field_crop_allocations_user_idx
  on public.field_crop_allocations (user_id);
create index if not exists field_crop_allocations_crop_idx
  on public.field_crop_allocations (crop_id);

-- One ACTIVE crop occupying a field at a time. Catch → 'harvested' before the
-- main crop is set 'active'. Planned/harvested/terminated rows are unconstrained,
-- so history and multiple per-season allocations are fine.
create unique index if not exists field_crop_allocations_one_active
  on public.field_crop_allocations (field_id)
  where status = 'active';

-- ---------------------------------------------------------------------
-- 2. RLS — read any member; write admin/staff (can_log_of) with
--    created_by = self; admin override on update/delete; solo-owner
--    fallback via has_no_membership().
-- ---------------------------------------------------------------------
alter table public.field_crop_allocations enable row level security;

drop policy if exists "allocations read members" on public.field_crop_allocations;
create policy "allocations read members" on public.field_crop_allocations
  for select using (
    public.is_member_of(user_id)
    or (user_id = auth.uid() and public.has_no_membership())
  );

drop policy if exists "allocations insert loggers" on public.field_crop_allocations;
create policy "allocations insert loggers" on public.field_crop_allocations
  for insert with check (
    created_by = auth.uid()
    and (
      public.can_log_of(user_id)
      or (user_id = auth.uid() and public.has_no_membership())
    )
  );

drop policy if exists "allocations update loggers" on public.field_crop_allocations;
create policy "allocations update loggers" on public.field_crop_allocations
  for update using (
    public.is_admin_of(user_id)
    or (public.can_log_of(user_id) and created_by = auth.uid())
    or (user_id = auth.uid() and public.has_no_membership())
  ) with check (
    public.is_admin_of(user_id)
    or (public.can_log_of(user_id) and created_by = auth.uid())
    or (user_id = auth.uid() and public.has_no_membership())
  );

drop policy if exists "allocations delete loggers" on public.field_crop_allocations;
create policy "allocations delete loggers" on public.field_crop_allocations
  for delete using (
    public.is_admin_of(user_id)
    or (public.can_log_of(user_id) and created_by = auth.uid())
    or (user_id = auth.uid() and public.has_no_membership())
  );

commit;
