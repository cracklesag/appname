-- =============================================================================
-- Migration: Expanded default bag-fertiliser catalogue
-- Purpose:   The shipped catalogue had only three bag ferts (25-5-5+S,
--            CAN+S 27%N, MOP 60%K), which left the planner with no straight
--            phosphate and no plain N straight. Add the common UK grassland
--            grades so a new user lands on a usable set and the source picker
--            (34.5N / urea / etc.) has real options.
-- Scope:     Shared catalogue rows (user_id IS NULL), hardcoded IDs in the
--            reserved 1-99 range. Custom user products auto-allocate from 1000
--            so there is no collision. `on conflict (id) do nothing` makes this
--            safe to re-run and means it never overwrites a row a user edited.
-- Sulphur:   s_pct is the DECLARED SO3 % (UK bag labelling, e.g. "+S(8)" = 8%
--            SO3), matching how the app reads it in calcNutrients.
-- Analyses:  Standard UK grades — AN 34.5%N, urea 46-0-0, ammonium sulphate
--            21%N + 60% SO3 (24% S), TSP 0-46-0, DAP 18-46-0, plus a balanced
--            20-10-10 grassland compound and a 0-24-24 PK for maintenance.
-- =============================================================================

begin;

insert into public.products (id, name, type, category, sort_order,
  n_pct, p2o5_pct, k2o_pct, s_pct) values
  -- Nitrogen straights
  (6,  'Ammonium Nitrate (34.5%N)', 'bag_fert', 'bag_fert', 6,  34.5, 0,  0,  null),
  (7,  'Urea (46%N)',               'bag_fert', 'bag_fert', 7,  46,   0,  0,  null),
  (8,  'Ammonium Sulphate (21%N+S)','bag_fert', 'bag_fert', 8,  21,   0,  0,  60),
  -- Phosphate sources
  (9,  'TSP (46% P₂O₅)',            'bag_fert', 'bag_fert', 9,  0,    46, 0,  null),
  (10, 'DAP (18-46-0)',             'bag_fert', 'bag_fert', 10, 18,   46, 0,  null),
  -- Compounds
  (11, '20-10-10',                  'bag_fert', 'bag_fert', 11, 20,   10, 10, null),
  (12, '0-24-24 (PK)',              'bag_fert', 'bag_fert', 12, 0,    24, 24, null)
on conflict (id) do nothing;

-- Keep the sequence safely above the reserved range so future custom inserts
-- (which start at 1000) are unaffected; this is a no-op in practice but guards
-- against an environment where the sequence was created low.
select setval('public.products_id_seq',
  greatest(1000, coalesce((select max(id) from public.products where id < 1000), 0) + 1),
  false);

commit;
