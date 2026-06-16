-- =====================================================================
-- Swardly · Allocation type FK on fields (public.fields.allocation_type_id)
-- Run AFTER 20260625_allocation_types.sql. Idempotent; one txn.
-- =====================================================================
--
-- One allocation type per field (the middle axis). Nullable / additive — a
-- field with no type behaves exactly as before. ON DELETE SET NULL so deleting
-- a custom type un-assigns its fields rather than failing. RLS on fields is
-- already farm-aware; no policy change needed.

begin;

alter table public.fields
  add column if not exists allocation_type_id uuid
    references public.allocation_types(id) on delete set null;

create index if not exists fields_allocation_type_idx on public.fields (allocation_type_id);

commit;
