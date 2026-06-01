-- =============================================================================
-- Migration: Optional management profile on field groups
-- Purpose:   Let a group (block of land) carry agronomic defaults — management
--            type, earliest fertiliser date, a low-input N cap, and an NVZ /
--            closed-period flag. These drive SOFT WARNINGS only (they never
--            change the recommended numbers) and are entirely OPTIONAL: a group
--            with no profile behaves exactly as before. A field reads its
--            current group's profile live, so moving a field between groups
--            changes which warnings apply with nothing copied or stale.
-- Scope:     All columns nullable/additive on public.groups. RLS already farm-
--            aware (members read, admins write) — no policy changes needed.
--            Safe to re-run.
-- =============================================================================

-- Management type: how the block is run. Null = unset (treated as general).
--   'silage'      — cut for silage/hay (the implicit default elsewhere)
--   'rotational'  — rotational grazing
--   'maintenance' — maintenance / low-input grazing
alter table public.groups
  add column if not exists management_type text
    check (management_type in ('silage', 'rotational', 'maintenance'));

-- Earliest date fertiliser should go on this block (month-day or full date).
-- Stored as text 'MM-DD' so it repeats every year (e.g. '02-15' = 15 Feb).
alter table public.groups
  add column if not exists earliest_fert_md text;

-- Low-input flag + optional max N (kg/ha) per application. When set, a planned
-- dressing above this is flagged. Null cap = no cap even if low_input is on.
alter table public.groups
  add column if not exists low_input boolean not null default false;
alter table public.groups
  add column if not exists max_n_kg_per_ha numeric;

-- NVZ / closed-period flag. When true, spreading in the NVZ closed period (or
-- whatever window the warning uses) is flagged for this block.
alter table public.groups
  add column if not exists nvz boolean not null default false;

-- Free-text note shown alongside the block's warnings (optional).
alter table public.groups
  add column if not exists profile_note text;
