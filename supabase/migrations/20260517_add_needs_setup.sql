-- =============================================================================
-- Migration: Add needs_setup flag to fields
-- Purpose:   Mark fields that were created via document import with placeholder
--            acres (0.01) so they can be surfaced for the user to complete.
-- =============================================================================

begin;

alter table public.fields
  add column if not exists needs_setup boolean not null default false;

create index if not exists fields_needs_setup_idx
  on public.fields (user_id, needs_setup)
  where needs_setup = true;

commit;
