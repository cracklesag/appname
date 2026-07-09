-- Title: link applications back to the job sheet that created them
-- suggested filename: 20260709_applications_job_link.sql
--
-- Lets an admin edit a logged job's completion date and have the change
-- cascade to the application records it wrote (date_applied), and underpins
-- job → records traceability. Nullable: hand-logged applications have no job.
alter table public.applications
  add column if not exists job_id uuid references public.jobs(id) on delete set null;

create index if not exists applications_job_idx on public.applications (job_id);
