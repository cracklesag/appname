-- =====================================================================
-- Swardly · Spray records — multiple targets per record
-- Run AFTER 20260608_spray_records.sql. Idempotent and safe to re-run.
-- =====================================================================
--
-- A spray often hits more than one weed (e.g. buttercup + chickweed), so the
-- single `target` text column becomes a `targets text[]` array. This migration
-- upgrades an already-applied v1 (which had `target`): it adds the array,
-- copies any existing single target into it, then drops the old column. If
-- you ran the (current) v1 migration, it already created `targets` and this is
-- a harmless no-op.

begin;

alter table public.spray_records add column if not exists targets text[];

do $$
begin
  -- Backfill from the old single-target column only if it still exists.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'spray_records' and column_name = 'target'
  ) then
    update public.spray_records
      set targets = array[target]
      where target is not null and target <> '' and (targets is null or array_length(targets, 1) is null);
    alter table public.spray_records drop column target;
  end if;
end $$;

commit;
