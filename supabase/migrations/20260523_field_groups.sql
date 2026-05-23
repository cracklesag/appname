-- =============================================================================
-- Migration: Field groups (blocks of land)
-- Purpose:   Let users group fields into named blocks (e.g. "Top Farm",
--            "River Meadows", "Silage Block") for filtering and reporting.
-- =============================================================================
--
-- Design notes:
--   * Real table rather than just a text column on fields, so the user can
--     manage groups (create, rename, delete, reorder) without touching the
--     fields themselves. Lets empty groups exist before assignment.
--   * One group per field (group_id nullable). Many-to-many deferred until
--     there's evidence the simple model isn't enough.
--   * ON DELETE SET NULL — deleting a group ungroups its fields rather than
--     orphaning them. The user wants the fields preserved.
--   * Unique (user_id, name) — can't have two "Top Farm" for the same user.
-- =============================================================================

begin;

-- 1. Groups table.
create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

create index groups_user_sort_idx on public.groups (user_id, sort_order, name);

-- 2. group_id column on fields.
alter table public.fields
  add column if not exists group_id uuid references public.groups(id) on delete set null;

create index if not exists fields_group_id_idx on public.fields (group_id) where group_id is not null;

-- 3. RLS — users only see / write their own groups. Mirrors the fields RLS.
alter table public.groups enable row level security;

create policy "users select own groups"
  on public.groups for select
  to authenticated
  using (user_id = auth.uid());

create policy "users insert own groups"
  on public.groups for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users update own groups"
  on public.groups for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users delete own groups"
  on public.groups for delete
  to authenticated
  using (user_id = auth.uid());

commit;
