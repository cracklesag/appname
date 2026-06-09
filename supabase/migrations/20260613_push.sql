-- =====================================================================
-- Swardly · Web push subscriptions (Phase 5) — lets a contractor (or anyone)
-- get a phone notification when a new job is sent or forwarded to them.
-- Run in the Supabase SQL editor before deploying. Idempotent.
-- =====================================================================
--
-- One row per browser/device the user has opted in on. Sends are performed
-- server-side with the service client (which can read another user's rows to
-- notify them); each user only ever sees/manages their own subscriptions.

begin;

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "own push subs select" on public.push_subscriptions;
create policy "own push subs select" on public.push_subscriptions for select using (user_id = auth.uid());
drop policy if exists "own push subs insert" on public.push_subscriptions;
create policy "own push subs insert" on public.push_subscriptions for insert with check (user_id = auth.uid());
drop policy if exists "own push subs update" on public.push_subscriptions;
create policy "own push subs update" on public.push_subscriptions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own push subs delete" on public.push_subscriptions;
create policy "own push subs delete" on public.push_subscriptions for delete using (user_id = auth.uid());

commit;
