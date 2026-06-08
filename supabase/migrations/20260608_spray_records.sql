-- =====================================================================
-- Swardly · Spray records (plant-protection / pesticide applications)
-- Run in the Supabase SQL editor BEFORE deploying the dependent code.
-- Idempotent (create if not exists / drop policy if exists). No data lost.
-- =====================================================================
--
-- Spray records are a SEPARATE domain from fertiliser/slurry applications:
-- they record plant-protection products (e.g. dock spray), not nutrients, and
-- must never enter the N/P/K calculations or fertiliser plans. Hence their own
-- table rather than a new applications type. A record optionally carries a
-- drawn sprayed area (when only part of the field was treated) stored inline as
-- a GeoJSON polygon + its geodesic hectares — spray has one area per record and
-- no nutrient reconciliation, so no separate areas table is needed.
--
-- RLS mirrors the applications/cuts family (20260529_farm_roles.sql): any farm
-- MEMBER may read and insert (row owned by the farm owner, created_by = self);
-- admins edit/delete anything in the farm, staff only rows they created.

begin;

create table if not exists public.spray_records (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,  -- farm owner
  created_by      uuid references auth.users(id) on delete set null,          -- who entered it
  field_id        uuid not null references public.fields(id) on delete cascade,
  date_applied    date not null,
  product_name    text not null,
  product_litres  numeric,            -- total litres of product used
  water_l_per_ha  numeric,            -- water volume rate (litres/ha)
  area_ha         numeric,            -- treated area (whole field, or drawn part)
  coverage        text not null default 'whole',
  polygon         jsonb,              -- GeoJSON Polygon/MultiPolygon when coverage = 'partial'
  wind_dir        text,               -- N / NE / E / SE / S / SW / W / NW
  wind_speed_mph  numeric,
  temp_c          numeric,
  weather_note    text,               -- free-text conditions
  targets         text[],             -- reason / target(s), e.g. {docks,chickweed} — optional
  notes           text,
  created_at      timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'spray_records_coverage_check') then
    alter table public.spray_records
      add constraint spray_records_coverage_check check (coverage in ('whole', 'partial'));
  end if;
end $$;

create index if not exists spray_records_field_idx on public.spray_records (field_id);
create index if not exists spray_records_user_idx  on public.spray_records (user_id);
create index if not exists spray_records_date_idx  on public.spray_records (date_applied desc);

alter table public.spray_records enable row level security;

drop policy if exists "farm members select spray_records" on public.spray_records;
create policy "farm members select spray_records"
  on public.spray_records for select
  using (public.is_member_of(user_id));

drop policy if exists "farm members insert spray_records" on public.spray_records;
create policy "farm members insert spray_records"
  on public.spray_records for insert
  with check (public.is_member_of(user_id) and created_by = auth.uid());

drop policy if exists "farm update spray_records" on public.spray_records;
create policy "farm update spray_records"
  on public.spray_records for update
  using (public.is_admin_of(user_id) or (public.is_member_of(user_id) and created_by = auth.uid()))
  with check (public.is_admin_of(user_id) or (public.is_member_of(user_id) and created_by = auth.uid()));

drop policy if exists "farm delete spray_records" on public.spray_records;
create policy "farm delete spray_records"
  on public.spray_records for delete
  using (public.is_admin_of(user_id) or (public.is_member_of(user_id) and created_by = auth.uid()));

-- Fallback for a brand-new admin before their self-admin membership row exists
-- (mirrors the applications/application_areas belt-and-braces).
drop policy if exists "self insert spray_records fallback" on public.spray_records;
create policy "self insert spray_records fallback"
  on public.spray_records for insert
  with check (user_id = auth.uid() and public.has_no_membership());

commit;
