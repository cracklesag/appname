-- =====================================================================
-- Swardly · Decline-a-job
-- Run in the Supabase SQL editor. Idempotent.
-- =====================================================================
-- Lets the contractor/operator a job was SENT to decline it instead of
-- completing it. Adds the 'declined' status, an optional reason + timestamp,
-- and widens the job-update guard so an outside contractor may move a job
-- sent to them to 'declined' (as well as 'submitted'), but nothing else.

begin;

-- 1. Allow the new status.
alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('draft','sent','submitted','approved','archived','declined'));

-- 2. Decline metadata. (Not in the guard's frozen-column list, so a contractor
-- setting them as part of declining is allowed.)
alter table public.jobs add column if not exists declined_reason text;
alter table public.jobs add column if not exists declined_at timestamptz;

-- 3. Re-create the guard with the status rule widened to permit 'declined'.
create or replace function public.guard_job_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if public.is_member_of(old.user_id) then
    return new;
  end if;

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
    raise exception 'Contractors can only update job progress (completion, time, forwarding, decline)';
  end if;

  -- An outside contractor can submit for approval or decline — never approve,
  -- archive, reopen or re-draft.
  if new.status is distinct from old.status and new.status not in ('submitted', 'declined') then
    raise exception 'Only the farm can set a job to "%"', new.status;
  end if;

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

commit;
