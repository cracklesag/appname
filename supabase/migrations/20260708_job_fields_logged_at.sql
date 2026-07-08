-- Title: add job_fields.logged_at (per-field commit stamp for safe re-approval)
-- suggested filename: 20260708_job_fields_logged_at.sql
--
-- Lets an admin reopen an APPROVED job to finish more fields without
-- double-logging the ones already written. commitJobRecords stamps each
-- field's logged_at when its record (application / spray / lime) is written,
-- and skips any field already stamped. Reopen → tick the remaining fields →
-- re-approve logs ONLY the newly-done ones, exactly once.
--
-- Backfill: existing approved jobs have their done/partial fields stamped now,
-- so reopening a historically-approved job won't re-log its already-done work.
alter table public.job_fields add column if not exists logged_at timestamptz;

update public.job_fields jf
set logged_at = j.approved_at
from public.jobs j
where jf.job_id = j.id
  and j.status = 'approved'
  and jf.logged_at is null
  and jf.status in ('done', 'partial');
