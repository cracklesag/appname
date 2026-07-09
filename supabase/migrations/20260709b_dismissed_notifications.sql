-- Title: dismissed_notifications — admin acknowledgements of computed warnings
-- suggested filename: 20260709b_dismissed_notifications.sql
--
-- Home-page warnings (e.g. duplicate slurry within 7 days) are COMPUTED live
-- from applications, not stored. This table records only which warnings an
-- admin has dismissed, keyed by the warning's deterministic id. Dismissing a
-- warning hides it for the whole farm (owner scope), for all admins.
create table if not exists public.dismissed_notifications (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  warning_id   text not null,
  dismissed_by uuid references auth.users(id) on delete set null,
  dismissed_at timestamptz not null default now(),
  unique (owner_id, warning_id)
);

alter table public.dismissed_notifications enable row level security;

-- Admins of the farm can see and manage its dismissals.
drop policy if exists "admins select dismissed_notifications" on public.dismissed_notifications;
create policy "admins select dismissed_notifications" on public.dismissed_notifications
  for select using (public.is_admin_of(owner_id));

drop policy if exists "admins insert dismissed_notifications" on public.dismissed_notifications;
create policy "admins insert dismissed_notifications" on public.dismissed_notifications
  for insert with check (public.is_admin_of(owner_id));

drop policy if exists "admins delete dismissed_notifications" on public.dismissed_notifications;
create policy "admins delete dismissed_notifications" on public.dismissed_notifications
  for delete using (public.is_admin_of(owner_id));

create index if not exists dismissed_notifications_owner_idx
  on public.dismissed_notifications (owner_id);
