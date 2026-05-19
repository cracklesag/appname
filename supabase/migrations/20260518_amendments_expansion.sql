-- =============================================================================
-- Migration: Expand product catalogue to cover RB209 (2023) organic amendments
-- Purpose:   Add cattle FYM, pig FYM, pig slurry, separated cattle slurry,
--            poultry manure (4 sources), digestate (3 forms × 2 feedstocks),
--            biosolids cake.
-- Adds:      DM%, MgO, SO₃ defaults; expands type enum with 'solid_manure';
--            corrects dairy slurry K₂O 3.2 → 2.5 per RB209 (2023) revision.
-- See AMENDMENTS_REFERENCE.md for the full sourced rationale.
-- =============================================================================

begin;

-- 1. Replace the type check to include 'solid_manure'. Keep 'slurry' for
-- liquids (covers cattle/pig slurry, separated-slurry liquor, and all whole +
-- liquor digestate variants).
alter table public.products drop constraint products_type_check;
alter table public.products add constraint products_type_check
  check (type in ('bag_fert', 'slurry', 'solid_manure', 'lime'));

-- 2. Add the missing nutrient columns and metadata.
--    Slurry side gains SO₃ and MgO (RB209 2023 tabulates both).
--    Solid-manure side gets its own per-tonne nutrient columns.
--    DM%, category and sort_order are common metadata for menu grouping.
alter table public.products
  add column if not exists so3_kg_per_m3 numeric,
  add column if not exists mgo_kg_per_m3 numeric,
  add column if not exists n_kg_per_t    numeric,
  add column if not exists p2o5_kg_per_t numeric,
  add column if not exists k2o_kg_per_t  numeric,
  add column if not exists so3_kg_per_t  numeric,
  add column if not exists mgo_kg_per_t  numeric,
  add column if not exists dm_pct        numeric,
  add column if not exists category      text,
  add column if not exists sort_order    int not null default 0;

-- 3. Correct existing dairy slurry (id=4): K₂O 3.2 → 2.5 per RB209 (2023)
-- Table 2.10, add S/Mg/DM% defaults and category for grouping.
update public.products set
  k2o_kg_per_m3 = 2.5,
  so3_kg_per_m3 = 0.7,
  mgo_kg_per_m3 = 0.6,
  dm_pct        = 6,
  category      = 'dairy_slurry',
  sort_order    = 2          -- positions between 2% (sort 1) and 10% (sort 3)
where id = 4;

-- Backfill category + sort_order for existing bag-fert and lime rows so the
-- menu groups them sensibly.
update public.products set category = 'bag_fert', sort_order = id
  where type = 'bag_fert' and category is null;
update public.products set category = 'lime',     sort_order = 1
  where type = 'lime' and category is null;

-- 4. Insert new products. IDs are deliberately spaced:
--      1- 5  existing (1-3 bag, 4 dairy slurry 6% DM, 5 lime)
--      6- 9  dairy slurry DM-band variants
--     10-14  pig slurry (default + DM-band variants)
--     15-19  separated cattle slurry (liquid + solid)
--     20-29  solid manures (FYM, poultry, biosolids)
--     30-39  digestates (both feedstocks × 3 forms)
--   This leaves room for future additions without renumbering historical data.

-- Dairy slurry DM-band variants (id 4 covers the 6% default).
insert into public.products
  (id, name, type, category, sort_order, dm_pct,
   n_kg_per_m3, p2o5_kg_per_m3, k2o_kg_per_m3, so3_kg_per_m3, mgo_kg_per_m3) values
  (6, 'Dairy slurry (2% DM)',  'slurry', 'dairy_slurry', 1,  2,
    1.6, 0.6, 1.7, 0.3, 0.2),
  (7, 'Dairy slurry (10% DM)', 'slurry', 'dairy_slurry', 3, 10,
    3.6, 1.8, 3.4, 1.0, 0.9)
on conflict (id) do nothing;

-- Pig slurry — RB209 default is 4% DM (thinner than dairy).
insert into public.products
  (id, name, type, category, sort_order, dm_pct,
   n_kg_per_m3, p2o5_kg_per_m3, k2o_kg_per_m3, so3_kg_per_m3, mgo_kg_per_m3) values
  (10, 'Pig slurry (2% DM)',  'slurry', 'pig_slurry', 1, 2,
    3.0, 0.8, 1.8, 0.4, 0.4),
  (11, 'Pig slurry (4% DM)',  'slurry', 'pig_slurry', 2, 4,
    3.6, 1.5, 2.2, 0.7, 0.7),
  (12, 'Pig slurry (6% DM)',  'slurry', 'pig_slurry', 3, 6,
    4.4, 2.2, 2.6, 1.0, 1.0)
on conflict (id) do nothing;

-- Separated cattle slurry — liquid fraction (mechanical separator default).
-- Solid fraction is below in the solid_manure block. RB209 gives no S/Mg
-- data ("ND") for separated cattle slurry — left null.
insert into public.products
  (id, name, type, category, sort_order, dm_pct,
   n_kg_per_m3, p2o5_kg_per_m3, k2o_kg_per_m3) values
  (15, 'Separated cattle slurry — liquid', 'slurry', 'separated_slurry', 1, 4,
    3.0, 1.2, 2.8)
on conflict (id) do nothing;

-- Digestate liquid forms (whole + liquor, × 2 feedstocks).
-- Farm-sourced shown first per doc; food-based after.
insert into public.products
  (id, name, type, category, sort_order, dm_pct,
   n_kg_per_m3, p2o5_kg_per_m3, k2o_kg_per_m3, so3_kg_per_m3, mgo_kg_per_m3) values
  (30, 'Digestate — whole (farm-sourced)',  'slurry', 'digestate', 1, 5.5,
    3.6, 1.7, 4.4, 0.8, 0.6),
  (31, 'Digestate — liquor (farm-sourced)', 'slurry', 'digestate', 2, 3.0,
    1.9, 0.6, 2.5, 0.1, 0.4),
  (33, 'Digestate — whole (food-based)',    'slurry', 'digestate', 4, 4.1,
    4.8, 1.1, 2.4, 0.7, 0.2),
  (34, 'Digestate — liquor (food-based)',   'slurry', 'digestate', 5, 3.8,
    4.5, 1.0, 2.8, 1.0, 0.2)
on conflict (id) do nothing;

-- Solid manures (all values kg per tonne fresh weight).
insert into public.products
  (id, name, type, category, sort_order, dm_pct,
   n_kg_per_t, p2o5_kg_per_t, k2o_kg_per_t, so3_kg_per_t, mgo_kg_per_t) values
  (20, 'Cattle FYM',                              'solid_manure', 'fym',              1, 25,
    6.0,  3.2,  9.4, 2.4, 1.8),
  (21, 'Pig FYM',                                 'solid_manure', 'fym',              2, 25,
    7.0,  6.0,  8.0, 3.4, 1.8),
  (16, 'Separated cattle slurry — solid',         'solid_manure', 'separated_slurry', 2, 20,
    4.0,  2.0,  3.3, null, null),
  (23, 'Layer manure (loose, fresh)',             'solid_manure', 'poultry',          1, 20,
    9.4,  8.0,  8.5, 3.0, 2.7),
  (24, 'Layer manure (housed, stored)',           'solid_manure', 'poultry',          2, 40,
    19.0, 12.0, 15.0, 5.6, 4.3),
  (25, 'Broiler/turkey litter',                   'solid_manure', 'poultry',          3, 60,
    28.0, 17.0, 21.0, 8.2, 5.9),
  (26, 'Deep-pit / dried poultry manure',         'solid_manure', 'poultry',          4, 80,
    37.0, 21.0, 27.0, 11.0, 7.5),
  (27, 'Biosolids — digested cake',               'solid_manure', 'biosolids',        1, 25,
    11.0, 11.0, 0.6,  8.2, 1.6),
  (32, 'Digestate — fibre (farm-sourced)',        'solid_manure', 'digestate',        3, 24,
    5.6,  4.7,  6.0,  2.1, 1.8),
  (35, 'Digestate — fibre (food-based)',          'solid_manure', 'digestate',        6, 27,
    8.9, 10.0,  3.0,  4.1, 2.2)
on conflict (id) do nothing;

-- 5. Index on (type, category, sort_order) for menu grouping queries.
create index if not exists products_type_category_sort_idx
  on public.products (type, category, sort_order);

commit;
