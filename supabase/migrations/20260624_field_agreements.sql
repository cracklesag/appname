-- =====================================================================
-- Swardly · Field ↔ agreement membership (public.field_agreements)
-- Run in the Supabase SQL editor BEFORE deploying. Idempotent; one
-- transaction. Run AFTER 20260623_agreements.sql (this FKs to it).
-- =====================================================================
--
-- The MANY-to-many link for the agreements axis: a field can sit in several
-- SFI/CS/ES agreements at once, and an agreement covers many fields. This is
-- the key difference from blocks and allocation types, which are one-per-field.
--
-- Membership is the unit (not a dated allocation like crops) — adding/removing
-- a row is the whole operation. Deleting a (custom) agreement cascades its
-- memberships away. Seeded agreements can't be deleted (RLS), so their rows
-- persist until the user unticks them.
--
-- RLS: read = any farm member (incl. agronomist); write = admin/staff
-- (can_log_of) — assigning a field to a scheme is a logging-style action, so
-- the read-only agronomist is excluded, consistent with crop allocations.

begin;

-- ---------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------
create table if not exists public.field_agreements (
  id            uuid primary key default gen_random_uuid(),
  -- Farm owner (admin) — all shared farm data is owned by this id.
  user_id       uuid not null references auth.users(id) on delete cascade,
  field_id      uuid not null references public.fields(id) on delete cascade,
  agreement_id  uuid not null references public.agreements(id) on delete cascade,
  -- Who created the membership (admin or staff).
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  -- A field is either in an agreement or not — no duplicates.
  unique (field_id, agreement_id)
);

create index if not exists field_agreements_field_idx on public.field_agreements (field_id);
create index if not exists field_agreements_agreement_idx on public.field_agreements (agreement_id);
create index if not exists field_agreements_user_idx on public.field_agreements (user_id);

-- ---------------------------------------------------------------------
-- 2. RLS — read any member; write admin/staff (can_log_of) with
--    created_by = self; admin override on update/delete; solo-owner
--    fallback via has_no_membership().
-- ---------------------------------------------------------------------
alter table public.field_agreements enable row level security;

drop policy if exists "field_agreements read members" on public.field_agreements;
create policy "field_agreements read members" on public.field_agreements
  for select using (
    public.is_member_of(user_id)
    or (user_id = auth.uid() and public.has_no_membership())
  );

drop policy if exists "field_agreements insert loggers" on public.field_agreements;
create policy "field_agreements insert loggers" on public.field_agreements
  for insert with check (
    created_by = auth.uid()
    and (
      public.can_log_of(user_id)
      or (user_id = auth.uid() and public.has_no_membership())
    )
  );

drop policy if exists "field_agreements update loggers" on public.field_agreements;
create policy "field_agreements update loggers" on public.field_agreements
  for update using (
    public.is_admin_of(user_id)
    or (public.can_log_of(user_id) and created_by = auth.uid())
    or (user_id = auth.uid() and public.has_no_membership())
  ) with check (
    public.is_admin_of(user_id)
    or (public.can_log_of(user_id) and created_by = auth.uid())
    or (user_id = auth.uid() and public.has_no_membership())
  );

drop policy if exists "field_agreements delete loggers" on public.field_agreements;
create policy "field_agreements delete loggers" on public.field_agreements
  for delete using (
    public.is_admin_of(user_id)
    or (public.can_log_of(user_id) and created_by = auth.uid())
    or (user_id = auth.uid() and public.has_no_membership())
  );

commit;
