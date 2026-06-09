-- =====================================================================
-- Swardly · Job timesheets (Phase 5) — time taken per job, and a farm-name
-- snapshot so a contractor can see which farm each job came from.
-- Run in the Supabase SQL editor before deploying. Idempotent.
-- =====================================================================
--
-- work_started_at : set while a live timer is running (null when stopped).
-- work_minutes    : the recorded time taken, in minutes. Stopping the timer
--                   adds the elapsed session to this; manual entry overwrites it.
-- farm_name       : snapshot of the sending farm's name at creation, so the
--                   contractor (who can't read the farm's private settings)
--                   can see who the job is for.

begin;

alter table public.jobs add column if not exists work_started_at timestamptz;
alter table public.jobs add column if not exists work_minutes integer;
alter table public.jobs add column if not exists farm_name text;

commit;
