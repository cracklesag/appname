-- =====================================================================
-- Roles fix: new signups must become admin of their own farm
-- =====================================================================
--
-- The original farm_roles migration backfilled EXISTING users as admins of
-- their own farm, but users who sign up AFTER it ran never got that self-admin
-- membership. Because the reworked RLS write policies require
-- is_admin_of(user_id), a brand-new user could not create their own settings,
-- fields, groups, etc. — onboarding failed with:
--   "new row violates row-level security policy for table settings"
--
-- Fix has two parts:
--   1. A trigger that inserts a self-admin farm_members row whenever a new
--      auth.users row is created (so all future signups are admins of self).
--   2. Backfill any users who already signed up post-migration and are missing
--      their self-admin row.
--   3. Belt-and-braces: allow a user to write their OWN data rows when they
--      have no membership yet, so onboarding can never deadlock on RLS again.

-- ---------------------------------------------------------------------
-- 1. Trigger: new auth user → self-admin membership
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user_farm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.farm_members (owner_id, member_id, role)
  values (new.id, new.id, 'admin')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_farm on auth.users;
create trigger on_auth_user_created_farm
  after insert on auth.users
  for each row execute function public.handle_new_user_farm();

-- ---------------------------------------------------------------------
-- 2. Backfill anyone who signed up after the first migration and is
--    missing their self-admin row.
-- ---------------------------------------------------------------------
insert into public.farm_members (owner_id, member_id, role)
select u.id, u.id, 'admin'
from auth.users u
where not exists (
  select 1 from public.farm_members m
  where m.member_id = u.id and m.owner_id = u.id
)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. Fallback policies: a user may always write their OWN data rows when
--    they have no membership yet. is_admin_of() stays the primary path;
--    this just removes the chicken-and-egg for brand-new accounts.
--    "has_no_membership" is true only before the self-admin row exists.
-- ---------------------------------------------------------------------
create or replace function public.has_no_membership()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.farm_members where member_id = auth.uid()
  )
$$;

-- SETTINGS: allow self-write when membership not yet established.
create policy "self insert settings fallback"
  on public.settings for insert
  with check (user_id = auth.uid() and public.has_no_membership());
create policy "self update settings fallback"
  on public.settings for update
  using (user_id = auth.uid() and public.has_no_membership())
  with check (user_id = auth.uid() and public.has_no_membership());

-- FIELDS
create policy "self insert fields fallback"
  on public.fields for insert
  with check (user_id = auth.uid() and public.has_no_membership());

-- GROUPS
create policy "self insert groups fallback"
  on public.groups for insert
  with check (user_id = auth.uid() and public.has_no_membership());
