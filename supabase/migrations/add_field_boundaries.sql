-- ============================================================================
-- Swardly · Visual mapping — schema
-- Run this in the Supabase SQL editor BEFORE deploying the mapping code.
-- Safe to re-run (idempotent): every statement uses IF NOT EXISTS / DROP-then-CREATE.
-- ============================================================================

-- 1) Boundary columns on the existing `fields` table -------------------------
-- All nullable and additive. loadFields() uses select('*'), so these flow
-- through to the app with no loader change (same as add_mg_idx.sql did).
-- `fields` is already protected by its existing RLS policies, so these new
-- columns inherit row-level protection — no new policy needed here.

alter table public.fields add column if not exists boundary           jsonb;          -- GeoJSON Polygon/MultiPolygon, [lng,lat]
alter table public.fields add column if not exists centroid_lat        double precision;
alter table public.fields add column if not exists centroid_lng        double precision;
alter table public.fields add column if not exists area_ha_mapped      double precision; -- area from the boundary (official for RPA, computed for drawn)
alter table public.fields add column if not exists boundary_source     text;            -- 'rpa' | 'drawn'
alter table public.fields add column if not exists rpa_sheet_id        text;
alter table public.fields add column if not exists rpa_parcel_id       text;
alter table public.fields add column if not exists boundary_updated_at timestamptz;

-- 2) Per-farm map settings (SBI + OS licence acceptance) ----------------------
-- Stored per user, NOT on the field. Kept in its own table so this chunk does
-- not need to touch the settings JSON blob / loadSettings deep-merge.

create table if not exists public.map_settings (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  sbi                    text,
  os_licence_accepted_at timestamptz,
  os_licence_acceptor    text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.map_settings enable row level security;

drop policy if exists "map_settings_select_own" on public.map_settings;
create policy "map_settings_select_own" on public.map_settings
  for select using (auth.uid() = user_id);

drop policy if exists "map_settings_insert_own" on public.map_settings;
create policy "map_settings_insert_own" on public.map_settings
  for insert with check (auth.uid() = user_id);

drop policy if exists "map_settings_update_own" on public.map_settings;
create policy "map_settings_update_own" on public.map_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "map_settings_delete_own" on public.map_settings;
create policy "map_settings_delete_own" on public.map_settings
  for delete using (auth.uid() = user_id);

-- Done. No data is destroyed; existing fields simply gain empty boundary columns.
