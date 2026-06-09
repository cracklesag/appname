-- =====================================================================
-- Swardly · Spray stock — products, purchases, and stock link on records
-- Run in the Supabase SQL editor BEFORE deploying the dependent code.
-- Idempotent. Run AFTER 20260608_spray_records.sql / 20260608b.
-- =====================================================================
--
-- spray_products  : the farm's spray store (one row per product) + the typical
--                   rate (L/ha) used to pre-fill the calculator.
-- spray_purchases : purchase history (adds to stock).
-- Current stock of a product = SUM(purchases.litres)
--                              − SUM(spray_records.product_litres WHERE that
--                                record's spray_product_id = the product).
-- So logging a spray against a listed product draws its stock down; free-text
-- one-off sprays don't touch stock. Stock is COMPUTED in code, not stored, so
-- it can never drift from the underlying purchase/usage rows.
--
-- Catalogue + purchases are farm configuration → members read, admins write
-- (mirrors the nutrient product catalogue). Sprayer settings live in the
-- settings JSON blob, not here.

begin;

create table if not exists public.spray_products (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  created_by       uuid references auth.users(id) on delete set null,
  name             text not null,
  default_l_per_ha numeric,         -- typical product rate, pre-fills the calculator
  notes            text,
  created_at       timestamptz not null default now()
);
create index if not exists spray_products_user_idx on public.spray_products (user_id);

create table if not exists public.spray_purchases (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_by    uuid references auth.users(id) on delete set null,
  product_id    uuid not null references public.spray_products(id) on delete cascade,
  purchase_date date not null,
  litres        numeric not null,
  unit_cost     numeric,            -- optional £/litre
  supplier      text,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists spray_purchases_product_idx on public.spray_purchases (product_id);
create index if not exists spray_purchases_user_idx on public.spray_purchases (user_id);

-- Link a spray record to a catalogue product so usage draws down stock.
alter table public.spray_records add column if not exists spray_product_id uuid references public.spray_products(id) on delete set null;
create index if not exists spray_records_product_idx on public.spray_records (spray_product_id);

alter table public.spray_products  enable row level security;
alter table public.spray_purchases enable row level security;

-- spray_products: members read, admins write
drop policy if exists "members select spray_products" on public.spray_products;
create policy "members select spray_products" on public.spray_products for select using (public.is_member_of(user_id));
drop policy if exists "admins insert spray_products" on public.spray_products;
create policy "admins insert spray_products" on public.spray_products for insert with check (public.is_admin_of(user_id));
drop policy if exists "admins update spray_products" on public.spray_products;
create policy "admins update spray_products" on public.spray_products for update using (public.is_admin_of(user_id)) with check (public.is_admin_of(user_id));
drop policy if exists "admins delete spray_products" on public.spray_products;
create policy "admins delete spray_products" on public.spray_products for delete using (public.is_admin_of(user_id));
drop policy if exists "self insert spray_products fallback" on public.spray_products;
create policy "self insert spray_products fallback" on public.spray_products for insert with check (user_id = auth.uid() and public.has_no_membership());

-- spray_purchases: members read, admins write
drop policy if exists "members select spray_purchases" on public.spray_purchases;
create policy "members select spray_purchases" on public.spray_purchases for select using (public.is_member_of(user_id));
drop policy if exists "admins insert spray_purchases" on public.spray_purchases;
create policy "admins insert spray_purchases" on public.spray_purchases for insert with check (public.is_admin_of(user_id));
drop policy if exists "admins update spray_purchases" on public.spray_purchases;
create policy "admins update spray_purchases" on public.spray_purchases for update using (public.is_admin_of(user_id)) with check (public.is_admin_of(user_id));
drop policy if exists "admins delete spray_purchases" on public.spray_purchases;
create policy "admins delete spray_purchases" on public.spray_purchases for delete using (public.is_admin_of(user_id));
drop policy if exists "self insert spray_purchases fallback" on public.spray_purchases;
create policy "self insert spray_purchases fallback" on public.spray_purchases for insert with check (user_id = auth.uid() and public.has_no_membership());

commit;
