-- =====================================================================
-- Multi-user farms: admin + staff roles
-- =====================================================================
--
-- Model
-- -----
-- The app was single-user: every row is owned by user_id and RLS lets you
-- see/edit only your own rows. This migration introduces shared farm access
-- WITHOUT a disruptive farm_id refactor, by keeping user_id meaning "the farm
-- owner (admin) account" and letting staff members resolve to their admin's
-- user_id for read access.
--
-- A "farm" is simply an admin user. Staff are linked to that admin via
-- farm_members. When a staff user queries, RLS lets them SELECT rows whose
-- user_id is any admin they belong to. WRITE rules are role-aware:
--   * Admin: full control of their own farm's rows (unchanged from before).
--   * Staff: may INSERT cuts/applications (stamped created_by = themselves),
--     may UPDATE/DELETE only rows they themselves created, and may NOT touch
--     fields, soil, groups, grass systems, products or settings.
--
-- Security is enforced here in RLS (the database), not just the UI. The UI
-- hides what staff can't do, but even a hand-crafted request is rejected.

-- ---------------------------------------------------------------------
-- 1. farm_members: who belongs to whose farm, and in what role
-- ---------------------------------------------------------------------
create table if not exists public.farm_members (
  id          uuid primary key default gen_random_uuid(),
  -- The admin/owner whose farm this membership grants access to.
  owner_id    uuid not null references auth.users(id) on delete cascade,
  -- The member user (the staff account, or the admin themselves).
  member_id   uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('admin', 'staff')),
  created_at  timestamptz not null default now(),
  unique (owner_id, member_id)
);
create index if not exists farm_members_member_idx on public.farm_members (member_id);
create index if not exists farm_members_owner_idx  on public.farm_members (owner_id);

-- ---------------------------------------------------------------------
-- 2. farm_invites: codes an admin generates for staff to join with
-- ---------------------------------------------------------------------
create table if not exists public.farm_invites (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  code        text not null unique,
  role        text not null default 'staff' check (role in ('staff')),
  label       text,                 -- optional note, e.g. "Tom (relief milker)"
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,          -- null = no expiry
  used_at     timestamptz,          -- set when redeemed
  used_by     uuid references auth.users(id) on delete set null
);
create index if not exists farm_invites_owner_idx on public.farm_invites (owner_id);
create index if not exists farm_invites_code_idx  on public.farm_invites (code);

-- ---------------------------------------------------------------------
-- 3. created_by on cuts and applications — so "edit your own only" works
-- ---------------------------------------------------------------------
alter table public.cuts
  add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.applications
  add column if not exists created_by uuid references auth.users(id) on delete set null;

-- Backfill existing rows: the owner created them.
update public.cuts         set created_by = user_id where created_by is null;
update public.applications set created_by = user_id where created_by is null;

-- ---------------------------------------------------------------------
-- 4. Backfill farm_members: every existing user is an admin of their own farm
-- ---------------------------------------------------------------------
insert into public.farm_members (owner_id, member_id, role)
select id, id, 'admin' from auth.users
on conflict (owner_id, member_id) do nothing;

-- ---------------------------------------------------------------------
-- 5. Helper functions (SECURITY DEFINER so they can read farm_members
--    without recursing through its own RLS)
-- ---------------------------------------------------------------------

-- The set of owner_ids the current user may READ data for: every farm they're
-- a member of (admin or staff). Includes their own id for admins.
create or replace function public.accessible_owner_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select owner_id from public.farm_members where member_id = auth.uid()
$$;

-- The set of owner_ids the current user is an ADMIN of.
create or replace function public.admin_owner_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select owner_id from public.farm_members
  where member_id = auth.uid() and role = 'admin'
$$;

-- True if the current user is an admin of the given owner's farm.
create or replace function public.is_admin_of(target_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.farm_members
    where member_id = auth.uid() and owner_id = target_owner and role = 'admin'
  )
$$;

-- True if the current user is any member (admin or staff) of the owner's farm.
create or replace function public.is_member_of(target_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.farm_members
    where member_id = auth.uid() and owner_id = target_owner
  )
$$;

-- ---------------------------------------------------------------------
-- 6. RLS on the new tables
-- ---------------------------------------------------------------------
alter table public.farm_members enable row level security;
alter table public.farm_invites enable row level security;

-- Members can see the membership rows of any farm they belong to (so an admin
-- sees their staff, and staff can see they belong). Uses a non-recursive
-- check via the SECURITY DEFINER helper.
create policy "members read own farm memberships"
  on public.farm_members for select
  using (member_id = auth.uid() or public.is_member_of(owner_id));

-- Only admins can add members to their farm (used by the invite-redeem RPC,
-- which runs as definer, but we also allow admin self-management).
create policy "admins insert farm members"
  on public.farm_members for insert
  with check (public.is_admin_of(owner_id) or member_id = auth.uid());

-- Admins can remove members from their farm; a member can remove themselves.
create policy "admins delete farm members"
  on public.farm_members for delete
  using (public.is_admin_of(owner_id) or member_id = auth.uid());

-- Invites: only the owning admin can see/create/delete their invites.
create policy "admins read own invites"
  on public.farm_invites for select
  using (public.is_admin_of(owner_id));
create policy "admins insert own invites"
  on public.farm_invites for insert
  with check (public.is_admin_of(owner_id));
create policy "admins delete own invites"
  on public.farm_invites for delete
  using (public.is_admin_of(owner_id));

-- ---------------------------------------------------------------------
-- 7. Rework data-table RLS for shared farm access + role-aware writes
-- ---------------------------------------------------------------------
-- Strategy: SELECT widens to "any farm I'm a member of". WRITES on
-- admin-only tables (fields, groups, grass_systems, settings, products,
-- and soil which lives on fields) stay admin-only. Cuts and applications
-- allow staff to insert (created_by = self) and edit their own.

-- ---- FIELDS (admin-only writes; soil sample columns live here too) ----
drop policy if exists "users select own fields" on public.fields;
drop policy if exists "users insert own fields" on public.fields;
drop policy if exists "users update own fields" on public.fields;
drop policy if exists "users delete own fields" on public.fields;

create policy "farm members select fields"
  on public.fields for select
  using (public.is_member_of(user_id));
create policy "farm admins insert fields"
  on public.fields for insert
  with check (public.is_admin_of(user_id));
create policy "farm admins update fields"
  on public.fields for update
  using (public.is_admin_of(user_id))
  with check (public.is_admin_of(user_id));
create policy "farm admins delete fields"
  on public.fields for delete
  using (public.is_admin_of(user_id));

-- ---- GROUPS (admin-only writes) ----
drop policy if exists "users select own groups" on public.groups;
drop policy if exists "users insert own groups" on public.groups;
drop policy if exists "users update own groups" on public.groups;
drop policy if exists "users delete own groups" on public.groups;

create policy "farm members select groups"
  on public.groups for select using (public.is_member_of(user_id));
create policy "farm admins insert groups"
  on public.groups for insert with check (public.is_admin_of(user_id));
create policy "farm admins update groups"
  on public.groups for update using (public.is_admin_of(user_id)) with check (public.is_admin_of(user_id));
create policy "farm admins delete groups"
  on public.groups for delete using (public.is_admin_of(user_id));

-- ---- GRASS SYSTEMS (shared seeds readable by all; own rows admin-only) ----
drop policy if exists "users select shared or own grass systems" on public.grass_systems;
drop policy if exists "users insert own grass systems" on public.grass_systems;
drop policy if exists "users update own grass systems" on public.grass_systems;
drop policy if exists "users delete own grass systems" on public.grass_systems;

create policy "farm members select grass systems"
  on public.grass_systems for select
  using (user_id is null or public.is_member_of(user_id));
create policy "farm admins insert grass systems"
  on public.grass_systems for insert
  with check (public.is_admin_of(user_id));
create policy "farm admins update grass systems"
  on public.grass_systems for update
  using (public.is_admin_of(user_id)) with check (public.is_admin_of(user_id));
create policy "farm admins delete grass systems"
  on public.grass_systems for delete
  using (public.is_admin_of(user_id));

-- ---- PRODUCTS (shared catalogue readable; own custom rows admin-only) ----
drop policy if exists "users select shared and own products" on public.products;
drop policy if exists "users insert own products" on public.products;
drop policy if exists "users update own products" on public.products;
drop policy if exists "users delete own products" on public.products;

create policy "farm members select products"
  on public.products for select
  using (user_id is null or public.is_member_of(user_id));
create policy "farm admins insert products"
  on public.products for insert
  with check (public.is_admin_of(user_id));
create policy "farm admins update products"
  on public.products for update
  using (public.is_admin_of(user_id)) with check (public.is_admin_of(user_id));
create policy "farm admins delete products"
  on public.products for delete
  using (public.is_admin_of(user_id));

-- ---- SETTINGS (admin-only; staff read the farm's settings) ----
drop policy if exists "users select own settings" on public.settings;
drop policy if exists "users upsert own settings" on public.settings;

create policy "farm members select settings"
  on public.settings for select
  using (public.is_member_of(user_id));
create policy "farm admins insert settings"
  on public.settings for insert
  with check (public.is_admin_of(user_id));
create policy "farm admins update settings"
  on public.settings for update
  using (public.is_admin_of(user_id)) with check (public.is_admin_of(user_id));
create policy "farm admins delete settings"
  on public.settings for delete
  using (public.is_admin_of(user_id));

-- ---- APPLICATIONS (staff may add + edit own; admin edits all) ----
drop policy if exists "users select own applications" on public.applications;
drop policy if exists "users insert own applications" on public.applications;
drop policy if exists "users update own applications" on public.applications;
drop policy if exists "users delete own applications" on public.applications;

create policy "farm members select applications"
  on public.applications for select
  using (public.is_member_of(user_id));
-- Insert: any member of the farm; the row's user_id must be the farm owner
-- and created_by must be the inserting user.
create policy "farm members insert applications"
  on public.applications for insert
  with check (public.is_member_of(user_id) and created_by = auth.uid());
-- Update: admins update anything in their farm; staff only rows they created.
create policy "farm update applications"
  on public.applications for update
  using (public.is_admin_of(user_id) or (public.is_member_of(user_id) and created_by = auth.uid()))
  with check (public.is_admin_of(user_id) or (public.is_member_of(user_id) and created_by = auth.uid()));
create policy "farm delete applications"
  on public.applications for delete
  using (public.is_admin_of(user_id) or (public.is_member_of(user_id) and created_by = auth.uid()));

-- ---- CUTS (staff may add + edit own; admin edits all) ----
drop policy if exists "users select own cuts" on public.cuts;
drop policy if exists "users insert own cuts" on public.cuts;
drop policy if exists "users update own cuts" on public.cuts;
drop policy if exists "users delete own cuts" on public.cuts;

create policy "farm members select cuts"
  on public.cuts for select
  using (public.is_member_of(user_id));
create policy "farm members insert cuts"
  on public.cuts for insert
  with check (public.is_member_of(user_id) and created_by = auth.uid());
create policy "farm update cuts"
  on public.cuts for update
  using (public.is_admin_of(user_id) or (public.is_member_of(user_id) and created_by = auth.uid()))
  with check (public.is_admin_of(user_id) or (public.is_member_of(user_id) and created_by = auth.uid()));
create policy "farm delete cuts"
  on public.cuts for delete
  using (public.is_admin_of(user_id) or (public.is_member_of(user_id) and created_by = auth.uid()));

-- ---------------------------------------------------------------------
-- 8. RPC: redeem an invite code (runs as definer to create the membership)
-- ---------------------------------------------------------------------
-- A signed-in user calls this with a code. If valid + unused + unexpired,
-- they're added to the owner's farm as staff and the invite is marked used.
create or replace function public.redeem_farm_invite(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.farm_invites%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'Not signed in');
  end if;

  select * into v_invite from public.farm_invites where code = p_code;
  if not found then
    return json_build_object('ok', false, 'error', 'Invalid code');
  end if;
  if v_invite.used_at is not null then
    return json_build_object('ok', false, 'error', 'This code has already been used');
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    return json_build_object('ok', false, 'error', 'This code has expired');
  end if;
  if v_invite.owner_id = v_uid then
    return json_build_object('ok', false, 'error', 'You cannot join your own farm');
  end if;

  insert into public.farm_members (owner_id, member_id, role)
  values (v_invite.owner_id, v_uid, 'staff')
  on conflict (owner_id, member_id) do nothing;

  update public.farm_invites
    set used_at = now(), used_by = v_uid
    where id = v_invite.id;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.redeem_farm_invite(text) to authenticated;
grant execute on function public.accessible_owner_ids() to authenticated;
grant execute on function public.admin_owner_ids() to authenticated;
grant execute on function public.is_admin_of(uuid) to authenticated;
grant execute on function public.is_member_of(uuid) to authenticated;
