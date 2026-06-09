-- =====================================================================
-- Swardly · Spray records — hold a tank mix (multiple products) in ONE
-- record, so a field spray is always a single entry. Idempotent.
-- Run in the Supabase SQL editor before deploying the dependent code.
-- =====================================================================
-- products = [{ name, spray_product_id, litres }]. Stock draws down per
-- entry in this array. Older single-product records (products = null)
-- keep working via the existing product_litres / spray_product_id columns.

begin;

alter table public.spray_records add column if not exists products jsonb;

commit;
