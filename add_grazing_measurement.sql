-- =============================================================================
-- Migration: Grazing measurement (plate-meter readings) + grazing schedule
-- Purpose:   Two optional additions for rotational grazing:
--   1) A `plate_readings` table — log a field's grass cover (kg DM/ha) on a
--      date. Powers growth-rate and field-history/performance reporting.
--   2) A simple maintenance-fertiliser schedule on a group profile (e.g.
--      "40 kg N/ha every 4 weeks") so a grazing block can carry a flat plan
--      with no data entry. Soft/advisory — drives reminders, not the engine.
-- Both are entirely optional. Safe to re-run.
-- =============================================================================

-- 1) Plate-meter readings ----------------------------------------------------
create table if not exists public.plate_readings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade, -- farm owner
  field_id      uuid not null references public.fields (id) on delete cascade,
  reading_date  date not null,
  -- Grass cover in kg DM/ha (what a plate meter outputs). Optional height in cm
  -- kept too, for users whose meter shows height — converted on entry.
  cover_kg_dm_ha numeric not null,
  height_cm     numeric,
  note          text,
  created_by    uuid,           -- who entered it (admin or staff)
  created_at    timestamptz not null default now()
);

create index if not exists plate_readings_field_date_idx
  on public.plate_readings (field_id, reading_date desc);

alter table public.plate_readings enable row level security;

-- Farm members can read; admins (and the owner) can write. Mirrors the rest of
-- the farm-scoped tables: is_member_of / is_admin_of resolve via farm_members.
drop policy if exists "members read plate readings" on public.plate_readings;
create policy "members read plate readings" on public.plate_readings
  for select using (public.is_member_of(user_id));

drop policy if exists "members insert plate readings" on public.plate_readings;
create policy "members insert plate readings" on public.plate_readings
  for insert with check (public.is_member_of(user_id));

drop policy if exists "members update plate readings" on public.plate_readings;
create policy "members update plate readings" on public.plate_readings
  for update using (public.is_member_of(user_id)) with check (public.is_member_of(user_id));

drop policy if exists "members delete plate readings" on public.plate_readings;
create policy "members delete plate readings" on public.plate_readings
  for delete using (public.is_member_of(user_id));

-- 2) Grazing maintenance schedule on the group profile -----------------------
-- A flat schedule: apply `graze_n_kg_per_ha` every `graze_interval_days`.
-- Advisory only — surfaced as a reminder, never auto-applied.
alter table public.groups
  add column if not exists graze_n_kg_per_ha numeric;
alter table public.groups
  add column if not exists graze_interval_days int;
