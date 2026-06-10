-- =====================================================================
-- Swardly · Assistant Q&A log — every question and answer, for analysis
-- (what users ask, how-to vs data split, model comparison, error rate).
-- Run in the Supabase SQL editor before deploying. Idempotent.
-- =====================================================================
--
-- Written server-side on every assistant turn. The app never reads it back;
-- analysis happens in the Supabase SQL editor (service role sees all rows).
-- RLS lets a user insert/see only their own rows.

begin;

create table if not exists public.assistant_logs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  owner_id        uuid,                 -- farm context (groups staff with their farm)
  account_type    text,                 -- 'farm' | 'contractor'
  conversation_id text,                 -- client-generated per chat session
  turn            integer,              -- nth user message in the conversation
  question        text not null,
  answer          text,
  model           text,
  tools_used      text[] not null default '{}',
  duration_ms     integer,
  error           text,                 -- set when the turn failed
  created_at      timestamptz not null default now()
);

create index if not exists assistant_logs_created_idx on public.assistant_logs (created_at desc);
create index if not exists assistant_logs_user_idx on public.assistant_logs (user_id, created_at desc);
create index if not exists assistant_logs_convo_idx on public.assistant_logs (conversation_id);

alter table public.assistant_logs enable row level security;

drop policy if exists "own assistant logs insert" on public.assistant_logs;
create policy "own assistant logs insert" on public.assistant_logs
  for insert with check (user_id = auth.uid());

drop policy if exists "own assistant logs select" on public.assistant_logs;
create policy "own assistant logs select" on public.assistant_logs
  for select using (user_id = auth.uid());

commit;
