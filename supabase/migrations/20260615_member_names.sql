-- =====================================================================
-- Swardly · Staff/operator names — a display name on farm membership so
-- "Staff member 1" becomes "Tom" in Send-to, forwarding, Team and records.
-- Run in the Supabase SQL editor before deploying. Idempotent.
-- =====================================================================

begin;

alter table public.farm_members add column if not exists member_name text;

-- New: members may update their own row; admins may update their farm's rows
-- (there was previously no update policy at all).
drop policy if exists "members update own or admin" on public.farm_members;
create policy "members update own or admin" on public.farm_members
  for update
  using (member_id = auth.uid() or public.is_admin_of(owner_id))
  with check (member_id = auth.uid() or public.is_admin_of(owner_id));

commit;
