-- =====================================================================
-- Swardly · Job security hardening
-- Run in the Supabase SQL editor BEFORE deploying the dependent code.
-- Idempotent.
-- =====================================================================
--
-- 1) COLUMN GUARD on jobs / job_fields.
--    The RLS update policies (20260611) let the assignee or delegate update
--    a job row — but RLS is row-level, so a contractor with their own access
--    token could rewrite ANY column via PostgREST: self-approve the job,
--    change rates/products/instructions, mint a share link, or set user_id
--    to themselves and steal the row. The app UI never offers this; the
--    database now refuses it. BEFORE UPDATE triggers allow farm members
--    (admin or staff — the trusted team) full update, and restrict everyone
--    else (outside contractors / their operators) to progress fields only:
--      jobs       : status (→ 'submitted' only), submitted_at,
--                   work_started_at, work_minutes,
--                   delegated_to_user_id (assignee → own team only)
--      job_fields : status, actual_rate_value, completion_note
--    Service-role sessions (auth.uid() IS NULL — server code, the share-link
--    path, migrations) are unrestricted, matching today's behaviour.
--
-- 2) SHARE-PIN LOCKOUT columns. The share link token is 144-bit and fine;
--    the optional PIN was brute-forceable because nothing counted attempts.
--    These columns back the lockout logic in lib/actions.ts (10 wrong PINs
--    → 15-minute lock, reset on success or new link).

begin;

-- ---------------------------------------------------------------------
-- 1a. jobs guard
-- ---------------------------------------------------------------------
create or replace function public.guard_job_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service client / no JWT (server code, share-link path): unrestricted.
  if auth.uid() is null then
    return new;
  end if;

  -- The farm's own team (admin or staff) is trusted in full — this matches
  -- saveJobCompletion(), where a farm member's tick-off logs immediately.
  if public.is_member_of(old.user_id) then
    return new;
  end if;

  -- Anyone else who got through RLS is the assignee or delegate (an outside
  -- contractor or their operator). Spec / ownership / sharing columns are
  -- frozen for them:
  if new.user_id              is distinct from old.user_id
    or new.created_by         is distinct from old.created_by
    or new.title              is distinct from old.title
    or new.job_type           is distinct from old.job_type
    or new.product_id         is distinct from old.product_id
    or new.rate_value         is distinct from old.rate_value
    or new.rate_unit          is distinct from old.rate_unit
    or new.water_l_per_ha     is distinct from old.water_l_per_ha
    or new.spray_spec         is distinct from old.spray_spec
    or new.instruction        is distinct from old.instruction
    or new.notes              is distinct from old.notes
    or new.due_date           is distinct from old.due_date
    or new.assignee_user_id   is distinct from old.assignee_user_id
    or new.contractor_label   is distinct from old.contractor_label
    or new.share_token        is distinct from old.share_token
    or new.share_pin          is distinct from old.share_pin
    or new.share_expires_at   is distinct from old.share_expires_at
    or new.share_pin_attempts is distinct from old.share_pin_attempts
    or new.share_pin_locked_until is distinct from old.share_pin_locked_until
    or new.approved_at        is distinct from old.approved_at
    or new.farm_name          is distinct from old.farm_name
    or new.created_at         is distinct from old.created_at
  then
    raise exception 'Contractors can only update job progress (completion, time, forwarding)';
  end if;

  -- Status: an outside contractor can submit for approval — never approve,
  -- archive, reopen or re-draft.
  if new.status is distinct from old.status and new.status <> 'submitted' then
    raise exception 'Only the farm can set a job to "%"', new.status;
  end if;

  -- Forwarding: only the assignee may change the delegate, and only to a
  -- member of their own team (or clear it / take it back themselves).
  if new.delegated_to_user_id is distinct from old.delegated_to_user_id then
    if auth.uid() is distinct from old.assignee_user_id then
      raise exception 'Only the contractor this job was sent to can forward it';
    end if;
    if new.delegated_to_user_id is not null
      and new.delegated_to_user_id <> auth.uid()
      and not exists (
        select 1 from public.farm_members
        where owner_id = auth.uid() and member_id = new.delegated_to_user_id
      )
    then
      raise exception 'You can only forward a job to your own team';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_job_update on public.jobs;
create trigger guard_job_update
  before update on public.jobs
  for each row execute function public.guard_job_update();

-- ---------------------------------------------------------------------
-- 1b. job_fields guard
-- ---------------------------------------------------------------------
create or replace function public.guard_job_field_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if exists (
    select 1 from public.jobs j
    where j.id = old.job_id and public.is_member_of(j.user_id)
  ) then
    return new;
  end if;

  -- Outside contractor / operator: snapshot + plan columns are frozen.
  if new.job_id                 is distinct from old.job_id
    or new.field_id             is distinct from old.field_id
    or new.field_name           is distinct from old.field_name
    or new.boundary             is distinct from old.boundary
    or new.area_ha              is distinct from old.area_ha
    or new.planned_rate_value   is distinct from old.planned_rate_value
    or new.planned_rate_unit    is distinct from old.planned_rate_unit
    or new.sort_order           is distinct from old.sort_order
    or new.created_at           is distinct from old.created_at
  then
    raise exception 'Contractors can only record completion on a job field';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_job_field_update on public.job_fields;
create trigger guard_job_field_update
  before update on public.job_fields
  for each row execute function public.guard_job_field_update();

-- ---------------------------------------------------------------------
-- 2. Share-PIN attempt lockout
-- ---------------------------------------------------------------------
alter table public.jobs add column if not exists share_pin_attempts integer not null default 0;
alter table public.jobs add column if not exists share_pin_locked_until timestamptz;

commit;
