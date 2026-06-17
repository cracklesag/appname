-- =====================================================================
-- Allocation types: per-type "dressing rhythm".
--
-- Controls how a type drives the home prompts, replacing the single global
-- behaviour:
--   after_cut  — nitrogen prompt after each cut (silage, maintenance top-up)
--   recurring  — a dressing every N days from the last spread date (grazing)
--   none       — no automatic prompt; surfaces in the Low input review instead
--
-- Existing rows (seeds + customs) get sensible defaults by kind. New columns
-- default to 'after_cut' so a fresh insert is never null.
-- =====================================================================

alter table public.allocation_types
  add column if not exists dressing_rhythm text not null default 'after_cut'
  check (dressing_rhythm in ('after_cut', 'recurring', 'none'));

-- Defaults by kind for rows that exist already.
update public.allocation_types set dressing_rhythm = 'recurring' where kind = 'grazing';
update public.allocation_types set dressing_rhythm = 'none'      where kind = 'low_input';
-- silage, maintenance and custom keep the 'after_cut' default.
