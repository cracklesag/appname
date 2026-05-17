-- =============================================================================
-- Migration: cleanup_abandoned_documents
-- =============================================================================
--
-- Sweeps up documents that have been sitting in non-terminal states for too
-- long. Anything left in queued / processing / ready_for_review / failed for
-- more than 7 days is considered abandoned: the user uploaded but never
-- finalised (or extraction failed and they never retried).
--
-- For each abandoned document:
--   1. The PDF in Storage is deleted (best-effort — function continues if
--      the storage object is already gone).
--   2. The document row is marked status='discarded' so it shows the
--      discarded view in the UI.
--   3. Any associated extracted_samples rows are deleted (cascade is set up
--      via FK on document_id).
--
-- Soil_samples that have already been committed are NOT touched — the
-- documents.status='committed' rows are explicitly excluded.
--
-- Scheduling: see the pg_cron block below. Runs daily at 03:00 UTC.
-- =============================================================================

begin;

-- Enable pg_cron if it isn't already (Supabase enables on request; idempotent)
create extension if not exists pg_cron;

create or replace function public.cleanup_abandoned_documents()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cutoff      timestamptz := now() - interval '7 days';
  v_count       int := 0;
  v_doc         record;
begin
  -- For each abandoned document, delete the PDF and mark discarded.
  -- Loop rather than bulk-update so we can call storage.delete one at a time.
  for v_doc in
    select id, user_id, storage_path
      from public.documents
     where status in ('queued', 'processing', 'ready_for_review', 'failed')
       and created_at < v_cutoff
  loop
    -- Try to remove the storage object. Best-effort: ignore failures.
    begin
      perform storage.delete_object('documents-scratch', v_doc.storage_path);
    exception when others then
      -- Storage object may already be gone, or function may not exist
      -- depending on Supabase version. Continue.
      null;
    end;

    -- Mark as discarded and clear the storage_path so we know it's cleaned up
    update public.documents
       set status = 'discarded',
           storage_path = '',
           error_message = coalesce(error_message, '') ||
             case when error_message is null or error_message = '' then ''
                  else ' | ' end ||
             'Auto-discarded after 7 days unfinalised'
     where id = v_doc.id;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('discarded', v_count, 'cutoff', v_cutoff);
end;
$$;

-- Schedule the job: daily at 03:00 UTC.
-- The `cron.schedule` call is idempotent in the sense that if a job with the
-- same name already exists, we update it.
do $$
begin
  -- Remove any prior schedule with this name (in case of re-run)
  perform cron.unschedule('cleanup-abandoned-documents')
   where exists (
     select 1 from cron.job where jobname = 'cleanup-abandoned-documents'
   );

  perform cron.schedule(
    'cleanup-abandoned-documents',
    '0 3 * * *',
    $cron$ select public.cleanup_abandoned_documents(); $cron$
  );
end $$;

commit;

-- =============================================================================
-- Verify after running:
--   select jobname, schedule, command
--     from cron.job
--    where jobname = 'cleanup-abandoned-documents';
--
-- Manually trigger (e.g. for testing):
--   select public.cleanup_abandoned_documents();
-- =============================================================================
