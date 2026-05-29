-- =====================================================================
-- Product picker redesign: granular vs liquid bag fert
-- =====================================================================
--
-- Bag fertiliser can be granular (rate in kg/ha, analysis as % w/w) or liquid
-- (rate in L/ha, analysis still as % w/w but converted via density kg/L).
--
--   liquid: kg nutrient/ha = rate(L/ha) × density(kg/L) × (nutrient% / 100)
--
-- `form` distinguishes the two. `density_kg_per_l` is required for liquids
-- (typical UK liquid N ~1.25–1.30 kg/L). Granular rows leave density null and
-- default form 'granular'. Only meaningful for type = 'bag_fert'.

alter table public.products
  add column if not exists form text
    check (form is null or form in ('granular', 'liquid'));

alter table public.products
  add column if not exists density_kg_per_l numeric;

-- Existing bag_fert rows are granular; everything else leave null.
update public.products
  set form = 'granular'
  where type = 'bag_fert' and form is null;
