-- =====================================================================
-- AI assistant: bug reports
-- =====================================================================
-- Companion to feature_requests. When a user tells the in-app assistant that
-- something is broken / erroring / not recording, and the assistant cannot
-- resolve it from the documented rules + read-only data tools, it files a bug
-- report here and tells the user it has gone to the developers.
--
-- This is a WRITE the assistant performs on the user's behalf; like feature
-- requests it never touches farm data. Idempotent; self-wrapped so it can be
-- pasted alongside other migrations.
--
-- owner_id      — the farm owner the report belongs to (grouping per farm)
-- created_by    — the signed-in user who reported it
-- summary       — the assistant's one-line summary of the problem
-- what_happened — the symptom in the user's own words
-- steps         — what they were doing when it happened (repro / context)
-- area          — rough feature area (spray, cuts, plan, import, jobs, login, …)
-- error_text    — any on-screen error message the user quoted (optional)
-- status        — developer-facing workflow column
-- =====================================================================

begin;

create table if not exists public.bug_reports (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  created_by    uuid not null references auth.users(id) on delete cascade,
  summary       text not null,
  what_happened text,
  steps         text,
  area          text,
  error_text    text,
  status        text not null default 'new'
    check (status in ('new', 'investigating', 'fixed', 'cant_reproduce', 'wont_fix')),
  created_at    timestamptz not null default now()
);

create index if not exists bug_reports_owner_idx
  on public.bug_reports (owner_id, created_at desc);

alter table public.bug_reports enable row level security;

-- Any signed-in member can file a report, but only as themselves.
drop policy if exists "members insert own bug reports" on public.bug_reports;
create policy "members insert own bug reports"
  on public.bug_reports for insert
  to authenticated
  with check (created_by = auth.uid());

-- A user can read reports they filed, and a farm admin can read reports filed
-- on their farm. (The developer reads everything out-of-band via the service
-- role / Supabase dashboard, which bypasses RLS.)
drop policy if exists "members read own or own-farm bug reports" on public.bug_reports;
create policy "members read own or own-farm bug reports"
  on public.bug_reports for select
  to authenticated
  using (created_by = auth.uid() or owner_id = auth.uid());

commit;
