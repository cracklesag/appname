-- After-cut N dismissal: per-cut stamp saying "I'm happy this cut ran short
-- of N" — suppresses the home-page After-cut N prompt for THIS cut window
-- only. Logging the next cut starts a fresh window, so the prompt returns
-- automatically. Cleared (null) by Undo.
-- suggested filename: 20260706_cuts_n_dismissed.sql
alter table public.cuts add column if not exists n_dismissed_at timestamptz;
