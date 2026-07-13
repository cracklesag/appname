-- Title: spray record hardening — operator + start/finish times
-- suggested filename: 20260713_spray_record_hardening.sql
--
-- Optional fields strengthening spray records toward assurance-scheme and
-- structured-record expectations (operator name, application start/finish).
-- GB law today needs product/time/dose/area/crop; NI already mandates a
-- structured electronic format and GB is expected to follow — cheap to
-- capture now, painful to backfill later. All nullable; nothing breaks.
alter table public.spray_records
  add column if not exists operator_name text,
  add column if not exists start_time text,
  add column if not exists finish_time text;
