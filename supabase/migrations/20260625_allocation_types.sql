-- =====================================================================
-- Swardly · Allocation types catalogue (public.allocation_types)
-- Run in the Supabase SQL editor BEFORE deploying. Idempotent; one txn.
-- =====================================================================
--
-- The middle grouping axis: how a field is currently run (Silage / Rotational
-- grazing / Maintenance / Low input + customs). One per field via a swappable
-- FK on public.fields (see 20260626). Carries advisory management params that
-- used to live on the block profile. Mirrors crops / agreements: shared SEED
-- rows (user_id = null, stable seed_key) + user forks/customs.
--
-- Params are advisory — they feed warnings and the composed N cap only.
--
-- Seed block GENERATED from lib/allocation_types.ts by
-- scripts/gen-allocation-types-seed.ts (ON CONFLICT (seed_key) DO UPDATE).

begin;

create table if not exists public.allocation_types (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users(id) on delete cascade,
  seed_key          text,
  label             text not null,
  kind              text not null check (kind in ('silage', 'grazing', 'maintenance', 'low_input', 'custom')),
  regime_default    text not null default 'silage' check (regime_default in ('silage', 'grazing')),
  earliest_fert_md  text,
  n_cap_kg_per_ha    numeric,
  low_input         boolean not null default false,
  note              text,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  unique (user_id, label),
  unique (seed_key)
);

create index if not exists allocation_types_user_idx on public.allocation_types (user_id, sort_order, label);

-- RLS — read shared + own (+ members read admin customs); admin-only writes,
-- exactly like crops / agreements. Forking copies a seed into a user row.
alter table public.allocation_types enable row level security;

drop policy if exists "alloc types read shared and own" on public.allocation_types;
create policy "alloc types read shared and own" on public.allocation_types
  for select using (
    user_id is null or user_id = auth.uid() or public.is_member_of(user_id)
  );

drop policy if exists "alloc types insert own" on public.allocation_types;
create policy "alloc types insert own" on public.allocation_types
  for insert with check (
    user_id = auth.uid() and (public.is_admin_of(auth.uid()) or public.has_no_membership())
  );

drop policy if exists "alloc types update own" on public.allocation_types;
create policy "alloc types update own" on public.allocation_types
  for update using (
    user_id = auth.uid() and (public.is_admin_of(auth.uid()) or public.has_no_membership())
  ) with check (
    user_id = auth.uid() and (public.is_admin_of(auth.uid()) or public.has_no_membership())
  );

drop policy if exists "alloc types delete own" on public.allocation_types;
create policy "alloc types delete own" on public.allocation_types
  for delete using (
    user_id = auth.uid() and (public.is_admin_of(auth.uid()) or public.has_no_membership())
  );

-- Seed (GENERATED — regenerate with: npx tsx scripts/gen-allocation-types-seed.ts).
insert into public.allocation_types
  (user_id, seed_key, label, kind, regime_default, earliest_fert_md, n_cap_kg_per_ha, low_input, note, sort_order)
values
  (null, 'silage', 'Silage', 'silage', 'silage', null, null, false, 'Cut for silage or hay. The implicit default elsewhere in the app.', 0),
  (null, 'rotational', 'Rotational grazing', 'grazing', 'grazing', null, null, false, 'Grazed in rotation. New rounds default to grazing rather than a cut.', 1),
  (null, 'maintenance', 'Maintenance', 'maintenance', 'grazing', null, null, false, 'Lightly managed / maintenance grazing — modest inputs.', 2),
  (null, 'low_input', 'Low input', 'low_input', 'grazing', null, null, true, 'Minimise inputs. Set an N cap to flag dressings above it.', 3)
on conflict (seed_key) do update set
    label = excluded.label,
    kind = excluded.kind,
    regime_default = excluded.regime_default,
    earliest_fert_md = excluded.earliest_fert_md,
    n_cap_kg_per_ha = excluded.n_cap_kg_per_ha,
    low_input = excluded.low_input,
    note = excluded.note,
    sort_order = excluded.sort_order;

commit;
