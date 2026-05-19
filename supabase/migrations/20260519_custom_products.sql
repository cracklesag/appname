-- =============================================================================
-- Migration: Custom (user-owned) products
-- Purpose:   Allow users to add their own product rows alongside the shared
--            RB209 catalogue, with custom name and custom nutrient values.
-- Approach:  Add nullable user_id to products. user_id IS NULL → shared
--            catalogue row, visible to everyone. user_id = auth.uid() → that
--            user's custom row. RLS rewritten accordingly.
-- ID range:  Shared rows keep hardcoded IDs 1-99. Custom inserts auto-allocate
--            from a sequence starting at 1000 so the two never collide.
-- =============================================================================

begin;

-- 1. Add the ownership column.
alter table public.products
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists products_user_id_idx on public.products (user_id);

-- 2. Sequence for auto-allocating custom product IDs.
create sequence if not exists public.products_id_seq
  as integer
  start with 1000
  owned by public.products.id;

-- Reset the sequence in case it was created earlier with a different start
-- (e.g. by a prior partial apply). Safe to skip if not needed but cheap.
select setval('public.products_id_seq', greatest(1000, coalesce((select max(id) from public.products), 0) + 1), false);

-- Make new inserts auto-allocate from the sequence when id is omitted.
alter table public.products alter column id set default nextval('public.products_id_seq');

-- 3. Replace the read policy so users see shared rows + their own.
drop policy if exists "products are readable by all authed users" on public.products;

create policy "users select shared and own products"
  on public.products for select
  to authenticated
  using (user_id is null or user_id = auth.uid());

-- 4. Allow users to manage their own custom rows (shared rows remain
-- read-only because user_id IS NULL fails the equality check).
create policy "users insert own products"
  on public.products for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users update own products"
  on public.products for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users delete own products"
  on public.products for delete
  to authenticated
  using (user_id = auth.uid());

commit;
