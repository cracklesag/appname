-- =====================================================================
-- Swardly · Dairy slurry K₂O default 3.2 → 2.5 (RB209 2023)
-- Run in the Supabase SQL editor. Idempotent and safe to re-run.
-- =====================================================================
--
-- WHY: the original "Cattle slurry (6% DM)" catalogue default carried
-- K₂O 3.2 kg/m³. RB209 (2023) typical values put 6% DM cattle slurry at
-- ~2.5 kg/m³. This corrects the default everywhere it's still on 3.2.
--
-- TWO PLACES, because of how analyses work:
--   1. products.k2o_kg_per_m3            — the product's base value
--   2. product_analyses.k2o_kg_per_m3    — the dated-analysis rows that the
--      planner actually reads (effectiveProductOn prefers an analysis row
--      over the base column). The 20260607 migration backfilled a v1 row
--      (dated 2000-01-01) for every existing product from its base columns,
--      so most dairy-slurry products have a 3.2 sitting in analyses too.
--      Updating only the base column would leave plans unchanged.
--
-- SAFETY: both updates are guarded with "= 3.2", so they ONLY touch rows
-- still on the old default. Anyone who entered their own measured lab value
-- (e.g. 2.8, 3.4) is left untouched.
--
-- NOTE ON HISTORY: 3.2 was an erroneous default, not a measurement, so this
-- corrects it in place — past applications recompute at 2.5. If instead you
-- want past applications to keep 3.2 and only new ones to use 2.5, do NOT run
-- the product_analyses update below; add a fresh dated analysis (effective
-- today, K₂O 2.5) from the product screen instead.

begin;

-- 1. Base product value.
update public.products
set k2o_kg_per_m3 = 2.5
where category = 'dairy_slurry'
  and k2o_kg_per_m3 = 3.2;

-- 2. Dated analysis rows for dairy-slurry products still on the old default.
update public.product_analyses a
set k2o_kg_per_m3 = 2.5
from public.products p
where a.product_id = p.id
  and p.category = 'dairy_slurry'
  and a.k2o_kg_per_m3 = 3.2;

commit;
