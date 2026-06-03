-- =====================================================================
-- AI assistant: feature requests
-- =====================================================================
-- The in-app assistant can pass a user's feature request to the developer.
-- This is the only WRITE the assistant performs; it never touches farm data.
--
-- owner_id   — the farm owner the request belongs to (for grouping per farm)
-- created_by — the signed-in user who asked (admin or staff)
-- summary    — the assistant's one-line summary of the underlying need
-- raw_request— the user's verbatim ask
-- context    — short note on what they were doing when they hit the wall
-- status     — developer-facing workflow column
-- =====================================================================

create table if not exists public.feature_requests (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_by  uuid not null references auth.users(id) on delete cascade,
  summary     text not null,
  raw_request text,
  context     text,
  status      text not null default 'new'
    check (status in ('new', 'considering', 'planned', 'done', 'declined')),
  created_at  timestamptz not null default now()
);

create index if not exists feature_requests_owner_idx
  on public.feature_requests (owner_id, created_at desc);

alter table public.feature_requests enable row level security;

-- Any signed-in member can file a request, but only as themselves.
create policy "members insert own feature requests"
  on public.feature_requests for insert
  to authenticated
  with check (created_by = auth.uid());

-- A user can read requests they filed, and a farm admin can read requests
-- filed on their farm. (The developer reads everything out-of-band via the
-- service role / Supabase dashboard, which bypasses RLS.)
create policy "members read own or own-farm feature requests"
  on public.feature_requests for select
  to authenticated
  using (created_by = auth.uid() or owner_id = auth.uid());
