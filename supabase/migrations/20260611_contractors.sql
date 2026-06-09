-- =====================================================================
-- Swardly · Contractors (Phase 4) — receive jobs by ID across farms, and
-- forward a received job to one of your own operators.
-- Run in the Supabase SQL editor BEFORE deploying the dependent code.
-- Idempotent.
-- =====================================================================
--
-- contractor_profiles : a user opts in to being a contractor and gets a
--                       shareable CODE. Farms connect to that code to send work.
-- farm_contractors    : a farm's address book of contractors it sends to.
-- jobs.delegated_to_user_id : when a contractor admin forwards a received job
--                       to one of their operators. The operator and the
--                       contractor admin and the farm admin can all see it.
--
-- A contractor's own staff reuse the existing farm_members/invite machinery
-- (the contractor is just an account owner with staff) — no new staff table.

begin;

create table if not exists public.contractor_profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  code          text not null unique,
  business_name text,
  created_at    timestamptz not null default now()
);

create table if not exists public.farm_contractors (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users(id) on delete cascade,  -- the farm
  contractor_user_id  uuid not null references auth.users(id) on delete cascade,  -- the contractor account
  label               text,
  created_at          timestamptz not null default now(),
  unique (owner_id, contractor_user_id)
);
create index if not exists farm_contractors_owner_idx on public.farm_contractors (owner_id);
create index if not exists farm_contractors_contractor_idx on public.farm_contractors (contractor_user_id);

-- Forwarding target on a job.
alter table public.jobs add column if not exists delegated_to_user_id uuid references auth.users(id) on delete set null;
create index if not exists jobs_delegate_idx on public.jobs (delegated_to_user_id);

alter table public.contractor_profiles enable row level security;
alter table public.farm_contractors    enable row level security;

-- contractor_profiles: a user only ever sees / manages their OWN profile.
-- (Code lookups when connecting are done server-side with the service client,
--  so no broad read policy is needed — profiles stay private.)
drop policy if exists "own contractor profile select" on public.contractor_profiles;
create policy "own contractor profile select" on public.contractor_profiles for select using (user_id = auth.uid());
drop policy if exists "own contractor profile insert" on public.contractor_profiles;
create policy "own contractor profile insert" on public.contractor_profiles for insert with check (user_id = auth.uid());
drop policy if exists "own contractor profile update" on public.contractor_profiles;
create policy "own contractor profile update" on public.contractor_profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own contractor profile delete" on public.contractor_profiles;
create policy "own contractor profile delete" on public.contractor_profiles for delete using (user_id = auth.uid());

-- farm_contractors: the farm's admins manage it; the contractor can see rows
-- that point at them (so they know who's connected).
drop policy if exists "admins manage farm_contractors" on public.farm_contractors;
create policy "admins manage farm_contractors" on public.farm_contractors for all
  using (public.is_admin_of(owner_id) or contractor_user_id = auth.uid())
  with check (public.is_admin_of(owner_id));

-- ---- Re-issue jobs / job_fields policies to include the delegate -------
drop policy if exists "admins select jobs" on public.jobs;
create policy "admins select jobs" on public.jobs for select
  using (public.is_admin_of(user_id) or assignee_user_id = auth.uid() or delegated_to_user_id = auth.uid());
drop policy if exists "manage update jobs" on public.jobs;
create policy "manage update jobs" on public.jobs for update
  using (public.is_admin_of(user_id) or assignee_user_id = auth.uid() or delegated_to_user_id = auth.uid())
  with check (public.is_admin_of(user_id) or assignee_user_id = auth.uid() or delegated_to_user_id = auth.uid());

drop policy if exists "members select job_fields" on public.job_fields;
create policy "members select job_fields" on public.job_fields for select
  using (exists (select 1 from public.jobs j where j.id = job_fields.job_id and (public.is_admin_of(j.user_id) or j.assignee_user_id = auth.uid() or j.delegated_to_user_id = auth.uid())));
drop policy if exists "members update job_fields" on public.job_fields;
create policy "members update job_fields" on public.job_fields for update
  using (exists (select 1 from public.jobs j where j.id = job_fields.job_id and (public.is_admin_of(j.user_id) or j.assignee_user_id = auth.uid() or j.delegated_to_user_id = auth.uid())))
  with check (exists (select 1 from public.jobs j where j.id = job_fields.job_id and (public.is_admin_of(j.user_id) or j.assignee_user_id = auth.uid() or j.delegated_to_user_id = auth.uid())));

commit;
