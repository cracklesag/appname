-- =====================================================================
-- Swardly · Job sheets — push work to staff or contractors.
-- Run in the Supabase SQL editor BEFORE deploying the dependent code.
-- Idempotent. Columns for ALL phases are included now so later phases
-- (share link, contractor accounts) need no further migration.
-- =====================================================================
--
-- jobs        : one job sheet (a type + an instruction + a recipient).
-- job_fields  : the fields on that sheet, each a SELF-CONTAINED SNAPSHOT
--               (name + boundary geometry + area) so a share-link recipient
--               can see the map without any access to the farm's data, plus
--               the recipient's completion (done / partial / skipped + the
--               actual rate they applied).
--
-- Access:
--   • admins of the farm  → full control of the farm's jobs
--   • the assigned member → can read their job and record completion
--   • share-link visitors → handled later by a SECURITY DEFINER function
--     keyed on share_token (no row policy can cover an anonymous user).

begin;

create table if not exists public.jobs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,  -- farm owner (RLS anchor)
  created_by        uuid references auth.users(id) on delete set null,
  title             text not null,
  job_type          text not null,            -- registry id: slurry | manure | fertiliser | lime | spray | generic
  status            text not null default 'sent' check (status in ('draft','sent','submitted','approved','archived')),
  -- Instruction (one per job, applied to every field on it):
  product_id        integer references public.products(id) on delete set null,  -- application-based types
  rate_value        numeric,
  rate_unit         text,
  water_l_per_ha    numeric,                  -- spray
  spray_spec        jsonb,                    -- spray tank mix: [{ name, spray_product_id, l_per_ha }]
  instruction       text,                     -- generic / free-text instruction
  notes             text,
  due_date          date,
  -- Recipient — exactly one path is used per job:
  assignee_user_id  uuid references auth.users(id) on delete set null,          -- staff / contractor account (phase 4)
  contractor_label  text,                     -- free-text who it's for (e.g. "AN Other Contracting")
  share_token       text unique,              -- no-account share link (phase 3)
  share_pin         text,
  share_expires_at  timestamptz,
  -- Lifecycle:
  submitted_at      timestamptz,
  approved_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists jobs_user_idx     on public.jobs (user_id);
create index if not exists jobs_assignee_idx on public.jobs (assignee_user_id);
create index if not exists jobs_token_idx    on public.jobs (share_token);

create table if not exists public.job_fields (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.jobs(id) on delete cascade,
  field_id            uuid references public.fields(id) on delete set null,  -- real field (for commit); kept even if field later deleted
  field_name          text not null,          -- snapshot
  boundary            jsonb,                  -- snapshot geometry for the map (share-link needs this)
  area_ha             numeric,                -- snapshot
  planned_rate_value  numeric,                -- mirrors the job rate (per-field override possible in future)
  planned_rate_unit   text,
  -- Recipient completion:
  status              text not null default 'pending' check (status in ('pending','done','partial','skipped')),
  actual_rate_value   numeric,
  completion_note     text,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now()
);
create index if not exists job_fields_job_idx on public.job_fields (job_id);

alter table public.jobs       enable row level security;
alter table public.job_fields enable row level security;

-- jobs: admins manage; assignee can read + update (to submit)
drop policy if exists "admins select jobs" on public.jobs;
create policy "admins select jobs" on public.jobs for select using (public.is_admin_of(user_id) or assignee_user_id = auth.uid());
drop policy if exists "admins insert jobs" on public.jobs;
create policy "admins insert jobs" on public.jobs for insert with check (public.is_admin_of(user_id));
drop policy if exists "self insert jobs fallback" on public.jobs;
create policy "self insert jobs fallback" on public.jobs for insert with check (user_id = auth.uid() and public.has_no_membership());
drop policy if exists "manage update jobs" on public.jobs;
create policy "manage update jobs" on public.jobs for update using (public.is_admin_of(user_id) or assignee_user_id = auth.uid()) with check (public.is_admin_of(user_id) or assignee_user_id = auth.uid());
drop policy if exists "admins delete jobs" on public.jobs;
create policy "admins delete jobs" on public.jobs for delete using (public.is_admin_of(user_id));

-- job_fields: follow the parent job (admin of its farm, or its assignee)
drop policy if exists "members select job_fields" on public.job_fields;
create policy "members select job_fields" on public.job_fields for select
  using (exists (select 1 from public.jobs j where j.id = job_fields.job_id and (public.is_admin_of(j.user_id) or j.assignee_user_id = auth.uid())));
drop policy if exists "members insert job_fields" on public.job_fields;
create policy "members insert job_fields" on public.job_fields for insert
  with check (exists (select 1 from public.jobs j where j.id = job_fields.job_id and public.is_admin_of(j.user_id)));
drop policy if exists "members update job_fields" on public.job_fields;
create policy "members update job_fields" on public.job_fields for update
  using (exists (select 1 from public.jobs j where j.id = job_fields.job_id and (public.is_admin_of(j.user_id) or j.assignee_user_id = auth.uid())))
  with check (exists (select 1 from public.jobs j where j.id = job_fields.job_id and (public.is_admin_of(j.user_id) or j.assignee_user_id = auth.uid())));
drop policy if exists "admins delete job_fields" on public.job_fields;
create policy "admins delete job_fields" on public.job_fields for delete
  using (exists (select 1 from public.jobs j where j.id = job_fields.job_id and public.is_admin_of(j.user_id)));

commit;
