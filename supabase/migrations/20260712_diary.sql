-- Title: Diary — farm to-dos and notes
-- suggested filename: 20260712_diary.sql
--
-- Two small tables behind the new /diary section:
--   todos       — farm to-do items; admins manage, items can be assigned to a
--                 staff member, staff tick their own off.
--   farm_notes  — freeform admin notes (pinnable).
-- The calendar view stores nothing: it derives events live from applications,
-- cuts, jobs and dated to-dos.
--
-- Scoping follows the house pattern: user_id = the farm owner's id;
-- created_by = the author. RLS via is_admin_of / auth.uid().

create table if not exists public.todos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_by  uuid references auth.users(id) on delete set null,
  title       text not null check (char_length(title) between 1 and 300),
  notes       text check (char_length(notes) <= 2000),
  -- Null = the admin's own/unassigned list. Set = pushed to that member.
  assigned_to uuid references auth.users(id) on delete set null,
  due_date    date,
  done_at     timestamptz,
  done_by     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists todos_owner_idx    on public.todos (user_id);
create index if not exists todos_assigned_idx on public.todos (assigned_to);

alter table public.todos enable row level security;

-- Admins: full control of their farm's todos.
drop policy if exists "admins manage todos" on public.todos;
create policy "admins manage todos" on public.todos
  for all using (public.is_admin_of(user_id))
  with check (public.is_admin_of(user_id));

-- Staff: can see and update (tick off) todos assigned to them. The server
-- action only ever flips done_at/done_by on this path.
drop policy if exists "staff read assigned todos" on public.todos;
create policy "staff read assigned todos" on public.todos
  for select using (assigned_to = auth.uid());

drop policy if exists "staff tick assigned todos" on public.todos;
create policy "staff tick assigned todos" on public.todos
  for update using (assigned_to = auth.uid())
  with check (assigned_to = auth.uid());

create table if not exists public.farm_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  body       text not null check (char_length(body) between 1 and 8000),
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists farm_notes_owner_idx on public.farm_notes (user_id);

alter table public.farm_notes enable row level security;

-- Notes are an admin surface (staff view is the to-do list only).
drop policy if exists "admins manage farm_notes" on public.farm_notes;
create policy "admins manage farm_notes" on public.farm_notes
  for all using (public.is_admin_of(user_id))
  with check (public.is_admin_of(user_id));
