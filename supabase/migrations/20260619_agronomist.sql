-- =====================================================================
-- Swardly · Agronomist accounts — security foundation (Phase A)
-- Run in the Supabase SQL editor. Idempotent. Runs in one transaction, so
-- if any step fails the whole thing rolls back (no table is left without
-- policies).
-- =====================================================================
--
-- An agronomist is an advisor linked to MANY farms. Model: a farm_members row
-- with role='agronomist'. That gives them READ access everywhere the app's
-- SELECT policies use is_member_of (which is every farm table) — exactly what
-- "review each farm" needs.
--
-- THE RISK this migration closes: is_member_of returns true for ANY role, and
-- the staff LOGGING policies (insert/update/delete on applications, cuts,
-- application_areas, spray_records, grazing_events, plate_readings) are written
-- as "is_member_of(user_id) AND created_by = auth.uid()". As-is, an agronomist
-- would inherit staff logging rights. We must not allow that.
--
-- FIX: a new can_log_of(owner) = member with role in ('admin','staff'). Every
-- logging WRITE policy switches from is_member_of → can_log_of. For admin/staff
-- this is identical to today (only those two roles exist now); it simply
-- excludes the new agronomist role from creating/editing/deleting log records.
--
-- Admin-only writes (fields, settings, products, groups, grass_systems, jobs,
-- spray catalogue, field_events) already use is_admin_of, so the agronomist is
-- already blocked there. Agronomist edits to the agronomic data they ARE
-- allowed (field soil/grass columns + agronomy config) happen through dedicated
-- server actions (service client, column-scoped) — NOT through RLS — so no
-- agronomist write policy is granted here.

begin;

-- ---------------------------------------------------------------------
-- 1. Allow the new role on memberships and invites.
-- ---------------------------------------------------------------------
alter table public.farm_members drop constraint if exists farm_members_role_check;
alter table public.farm_members add constraint farm_members_role_check
  check (role in ('admin', 'staff', 'agronomist'));

alter table public.farm_invites drop constraint if exists farm_invites_role_check;
alter table public.farm_invites add constraint farm_invites_role_check
  check (role in ('staff', 'agronomist'));

-- ---------------------------------------------------------------------
-- 2. Helpers: the new agronomist check, and the "may log" check that
--    replaces is_member_of on write policies.
-- ---------------------------------------------------------------------
create or replace function public.is_agronomist_of(target_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.farm_members
    where member_id = auth.uid() and owner_id = target_owner and role = 'agronomist'
  )
$$;

-- Members who may create log records: admin or staff (NOT agronomist).
create or replace function public.can_log_of(target_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.farm_members
    where member_id = auth.uid() and owner_id = target_owner and role in ('admin', 'staff')
  )
$$;

grant execute on function public.is_agronomist_of(uuid) to authenticated;
grant execute on function public.can_log_of(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Re-base the LOGGING tables' policies on can_log_of.
--    These six tables carry created_by + user_id and share the same
--    staff-write shape. We DROP every existing policy on each and recreate
--    a known-good set: read for any member (incl. agronomist), write for
--    admin/staff only. Doing it by drop-all-then-recreate makes this robust
--    to the live policy names (grazing_events / plate_readings were created
--    outside the migrations and their policy names aren't known here).
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  pol record;
  logged_tables text[] := array[
    'applications', 'cuts', 'application_areas', 'spray_records', 'grazing_events', 'plate_readings'
  ];
begin
  foreach t in array logged_tables loop
    -- Skip a table that doesn't exist on this database.
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    -- Drop every existing policy on the table (we fully redefine them).
    for pol in
      select policyname from pg_policies where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;

    execute format($q$
      create policy "members read %1$s" on public.%1$I
        for select using (public.is_member_of(user_id))
    $q$, t);

    execute format($q$
      create policy "loggers insert %1$s" on public.%1$I
        for insert with check (public.can_log_of(user_id) and created_by = auth.uid())
    $q$, t);

    execute format($q$
      create policy "loggers update %1$s" on public.%1$I
        for update
        using (public.is_admin_of(user_id) or (public.can_log_of(user_id) and created_by = auth.uid()))
        with check (public.is_admin_of(user_id) or (public.can_log_of(user_id) and created_by = auth.uid()))
    $q$, t);

    execute format($q$
      create policy "loggers delete %1$s" on public.%1$I
        for delete
        using (public.is_admin_of(user_id) or (public.can_log_of(user_id) and created_by = auth.uid()))
    $q$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. redeem_farm_invite: honour the invite's role (was hard-coded 'staff'),
--    so an agronomist invite creates an agronomist membership.
-- ---------------------------------------------------------------------
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
  values (v_invite.owner_id, v_uid, coalesce(v_invite.role, 'staff'))
  on conflict (owner_id, member_id) do nothing;

  update public.farm_invites
    set used_at = now(), used_by = v_uid
    where id = v_invite.id;

  return json_build_object('ok', true, 'role', coalesce(v_invite.role, 'staff'));
end;
$$;

commit;
