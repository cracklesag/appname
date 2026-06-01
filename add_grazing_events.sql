-- =============================================================================
-- Migration: Grazing events — measured grass offtake
-- Purpose:   Log each grazing of a paddock with its pre-grazing cover and
--            post-grazing residual (kg DM/ha). The difference is the grass the
--            paddock actually grew and the stock removed — the rigorous basis
--            for "grass grown" (offtake method used by grazing platforms),
--            replacing the indicative plate-reading-delta estimate.
-- Optional:  Entirely opt-in. Fields/blocks with no events just don't show a
--            measured yield. Safe to re-run. RLS farm-aware (members read/write).
-- =============================================================================

create table if not exists public.grazing_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade, -- farm owner
  field_id      uuid not null references public.fields (id) on delete cascade,
  graze_date    date not null,
  -- Cover entering the paddock and the residual left behind, kg DM/ha.
  pre_cover_kg_dm_ha  numeric not null,
  post_cover_kg_dm_ha numeric not null,
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now()
);

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
