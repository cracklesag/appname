-- =============================================================================
-- Migration: Grazing events — weekly-walk model (CORRECTED)
-- Purpose:   Log that a paddock was grazed on a date, down to a residual
--            (post-grazing cover, kg DM/ha). The PRE-grazing cover is NOT
--            entered — it's taken from the farm's most recent plate reading for
--            that paddock. Grass removed = (last reading before graze) − residual,
--            which feeds the measured "grass grown" calculation:
--               grass grown = (latest cover − earliest cover) + Σ removed
--            This matches how rotational platforms actually meter: one weekly
--            walk records covers; grazings are light marks that let the growth
--            maths add back what was eaten.
-- Optional:  Entirely opt-in. Safe to re-run. Supersedes the earlier version
--            of this file — makes pre_cover_kg_dm_ha nullable if it exists.
-- =============================================================================

create table if not exists public.grazing_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  field_id      uuid not null references public.fields (id) on delete cascade,
  graze_date    date not null,
  post_cover_kg_dm_ha numeric not null,
  pre_cover_kg_dm_ha  numeric,
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now()
);

-- If an earlier version created this table with pre_cover NOT NULL, relax it.
alter table public.grazing_events alter column pre_cover_kg_dm_ha drop not null;

create index if not exists grazing_events_field_date_idx
  on public.grazing_events (field_id, graze_date desc);

alter table public.grazing_events enable row level security;

drop policy if exists "members read grazing events" on public.grazing_events;
create policy "members read grazing events" on public.grazing_events
  for select using (public.is_member_of(user_id));

drop policy if exists "members insert grazing events" on public.grazing_events;
create policy "members insert grazing events" on public.grazing_events
  for insert with check (public.is_member_of(user_id));

drop policy if exists "members update grazing events" on public.grazing_events;
create policy "members update grazing events" on public.grazing_events
  for update using (public.is_member_of(user_id)) with check (public.is_member_of(user_id));

drop policy if exists "members delete grazing events" on public.grazing_events;
create policy "members delete grazing events" on public.grazing_events
  for delete using (public.is_member_of(user_id));
