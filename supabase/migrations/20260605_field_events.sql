-- =====================================================================
-- FIELD EVENTS — reseed / oversow / plough log
-- =====================================================================
-- A dated history of sward-management events on a field. Augments the single
-- last_ploughed / last_reseeded date pair on `fields` with a proper log,
-- while keeping those columns (and fields.grass_system_id) updated as a cache
-- — recomputed by the addFieldEvent / deleteFieldEvent server actions — so the
-- existing field displays and any downstream logic keep working unchanged.
--
-- A reseed or oversow event may name the grass system it was sown with; the
-- server action points fields.grass_system_id at the MOST RECENT such event,
-- so backdated entries don't clobber the current sward. A plough event carries
-- no grass system.
--
-- Writes are admin-only (consistent with field / soil edits, which logging an
-- event also performs); any farm member can read the history.
--
-- Safe to re-run (idempotent). Depends on the is_member_of / is_admin_of
-- helpers from 20260529_farm_roles.sql.
-- =====================================================================

create table if not exists public.field_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,   -- farm owner
  field_id        uuid not null references public.fields(id) on delete cascade,
  created_by      uuid references auth.users(id) on delete set null,           -- who logged it
  event_type      text not null check (event_type in ('reseed', 'oversow', 'plough')),
  event_date      date not null,
  grass_system_id uuid references public.grass_systems(id) on delete set null, -- sown system (null for plough)
  seed_mix        text,
  seed_rate_value numeric check (seed_rate_value is null or seed_rate_value > 0),
  seed_rate_unit  text check (seed_rate_unit is null or seed_rate_unit in ('kg/ac', 'kg/ha')),
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists field_events_field_idx
  on public.field_events (user_id, field_id, event_date desc);

alter table public.field_events enable row level security;

-- Read: any member of the farm. Write: admins only.
drop policy if exists "members read field events" on public.field_events;
create policy "members read field events"
  on public.field_events for select
  using (public.is_member_of(user_id));

drop policy if exists "admins insert field events" on public.field_events;
create policy "admins insert field events"
  on public.field_events for insert
  with check (public.is_admin_of(user_id));

drop policy if exists "admins update field events" on public.field_events;
create policy "admins update field events"
  on public.field_events for update
  using (public.is_admin_of(user_id))
  with check (public.is_admin_of(user_id));

drop policy if exists "admins delete field events" on public.field_events;
create policy "admins delete field events"
  on public.field_events for delete
  using (public.is_admin_of(user_id));
