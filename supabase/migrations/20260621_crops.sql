-- =====================================================================
-- Swardly · Crops catalogue (public.crops)
-- Run in the Supabase SQL editor BEFORE deploying. Idempotent; one
-- transaction (rolls back wholesale on any error).
-- =====================================================================
--
-- The user-editable knowledge base behind the Crops section — the non-grass
-- parallel to public.grass_systems. Design mirrors grass_systems exactly:
--   * shared SEED rows (user_id = null) with a stable seed_key, and
--   * user-owned forks/customs (user_id set, seed_key null).
-- A field's crop allocation FKs to a row here (see 20260622_field_crop_allocations).
--
-- The row is a superset of the in-memory CropProfile (lib/crops.ts), so it maps
-- straight onto the engine shape. Mg / Na / S / micros live here (and in crop
-- screens) only — same containment as the grass side.
--
-- The seed block at the bottom is GENERATED from lib/crops.ts by
-- scripts/gen-crops-seed.ts and uses ON CONFLICT (seed_key) DO UPDATE, so
-- re-running this migration re-syncs every shared crop to the current code.

begin;

-- ---------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------
create table if not exists public.crops (
  id                    uuid primary key default gen_random_uuid(),
  -- null = shared seed; set = a user's fork/custom crop.
  user_id               uuid references auth.users(id) on delete cascade,
  -- Stable key per shared seed so the engine/rotation code can find a crop
  -- without hardcoding a uuid. NULL for user customs.
  seed_key              text,
  label                 text not null,
  category              text not null check (category in ('forage', 'cereal_grain', 'catch')),
  yield_default         numeric not null,
  yield_unit            text not null,
  yield_range           text not null,
  -- { n?, p2o5, k2o, mgo?, na2o?, basis } — nutrient removal per unit yield.
  offtake               jsonb not null,
  total_n               text not null,
  -- SNS-moderate anchor N (kg N/ha); a CEILING for seedbed_low_index_only crops.
  n_target_kg_per_ha    numeric not null,
  pk_regime             text not null check (pk_regime in ('offtake_replacement', 'seedbed_low_index_only')),
  -- [{ label, timing, note? }] — stage-based N plan (replaces the per-cut model).
  n_stages              jsonb not null,
  target_ph             numeric not null,
  ph_note               text,
  soil_fit              text not null,
  manure_fit            text not null,
  needs_mg              boolean not null default false,
  needs_na              boolean not null default false,
  needs_s               boolean not null default false,
  sulphur_note          text,
  -- [{ nutrient, note, kgPerHa? }] — micronutrient advisories (e.g. boron).
  micros                jsonb,
  -- Crop family — triggers the brassica clubroot (5-year-break) warning.
  family                text check (family in ('brassica')),
  k_lift_top_up_note    text,
  evidence              text not null check (evidence in ('rb209', 'rb209_plus_trial', 'trial')),
  sources               text not null,
  summary               text not null,
  sort_order            int not null default 0,
  created_at            timestamptz not null default now(),
  -- A user can't have two crops with the same label; shared rows may coexist
  -- with a user's identically-labelled fork.
  unique (user_id, label),
  -- One shared seed per key.
  unique (seed_key)
);

create index if not exists crops_user_idx on public.crops (user_id, sort_order, label);

-- ---------------------------------------------------------------------
-- 2. RLS — read shared + own (+ farm members read the admin's customs);
--    writes are admin-only, exactly like grass_systems. Editing a shared
--    seed is not allowed: the app forks it (insert a copy) instead. A solo
--    owner with no farm_members row yet is covered by has_no_membership().
-- ---------------------------------------------------------------------
alter table public.crops enable row level security;

drop policy if exists "crops read shared and own" on public.crops;
create policy "crops read shared and own" on public.crops
  for select using (
    user_id is null
    or user_id = auth.uid()
    or public.is_member_of(user_id)
  );

drop policy if exists "crops insert own" on public.crops;
create policy "crops insert own" on public.crops
  for insert with check (
    user_id = auth.uid()
    and (public.is_admin_of(auth.uid()) or public.has_no_membership())
  );

drop policy if exists "crops update own" on public.crops;
create policy "crops update own" on public.crops
  for update using (
    user_id = auth.uid()
    and (public.is_admin_of(auth.uid()) or public.has_no_membership())
  ) with check (
    user_id = auth.uid()
    and (public.is_admin_of(auth.uid()) or public.has_no_membership())
  );

drop policy if exists "crops delete own" on public.crops;
create policy "crops delete own" on public.crops
  for delete using (
    user_id = auth.uid()
    and (public.is_admin_of(auth.uid()) or public.has_no_membership())
  );

-- ---------------------------------------------------------------------
-- 3. Seed shared crops (GENERATED from lib/crops.ts — do not hand-edit;
--    regenerate with: npx tsx scripts/gen-crops-seed.ts). Re-runnable.
-- ---------------------------------------------------------------------
insert into public.crops
  (user_id, seed_key, label, category, yield_default, yield_unit, yield_range, offtake, total_n, n_target_kg_per_ha, pk_regime, n_stages, target_ph, ph_note, soil_fit, manure_fit, needs_mg, needs_na, needs_s, sulphur_note, micros, family, k_lift_top_up_note, evidence, sources, summary, sort_order)
values
  (null, 'forage_maize', 'Forage maize', 'forage', 12, 't DM/ha', '10–16 t DM/ha', '{"n":14.6,"p2o5":6.2,"k2o":24.3,"basis":"per t DM (measured forage trial)"}'::jsonb, 'RB209 SNS-based — typically ~80–150 kg N/ha, much of which can come from spring slurry. Place all the phosphate plus 10–15 kg N/ha in the seedbed below the seed, then top-dress the balance as the crop emerges.', 120, 'offtake_replacement', '[{"label":"Seedbed starter","timing":"At drilling","note":"All P₂O₅ + 10–15 kg N/ha placed below the seed"},{"label":"Early top-dress","timing":"Crop emergence (2–6 leaf)","note":"Balance of the nitrogen"}]'::jsonb, 6.5, 'No lime needed above pH 6.5; maize struggles below about pH 5.0.', 'Best on warm, medium-textured, free-draining ground. Poor on heavy, wet or compacted soils, and marginal on exposed western sites.', 'Excellent spring slurry / FYM / digestate crop — but easy to overload P and K, so account for the manure nutrients.', true, false, true, 'Maize on light, low-organic-matter land can respond to 25–40 kg SO₃/ha in spring.', null, null, null, 'rb209_plus_trial', 'AHDB forage maize guide; PDA/AHDB forage nutrient-removal trial.', 'A great manure crop, but field choice matters.', 0),
  (null, 'fodder_beet', 'Fodder beet', 'forage', 16, 't DM/ha (roots)', '50–100+ t fresh/ha roots', '{"n":9,"p2o5":4.4,"k2o":24.9,"mgo":3.8,"na2o":7.5,"basis":"per t DM, roots only (PDA)"}'::jsonb, 'About 120–130 kg N/ha on light sandy soils, 100–120 kg N/ha on medium and heavier soils. Roughly 45 kg N/ha at drilling, then the balance in early May once the crop is established.', 120, 'offtake_replacement', '[{"label":"At drilling","timing":"Sowing","note":"~45 kg N/ha"},{"label":"Balance","timing":"Early May, once established","note":"Remainder of the nitrogen"}]'::jsonb, 6.8, 'Likes a high pH — broadly 6.5–7.0+.', 'Needs deep, well-drained, free-draining light-to-medium soil and a fine but firm seedbed.', 'Excellent slurry / FYM opportunity — but cap it so K and P don’t build above Index 3.', true, true, false, null, null, null, 'If roots are lifted and tops carted off, potash offtake rises sharply — apply up to +150 kg K₂O/ha. Grazed in situ returns most nutrients, so no top-up.', 'rb209_plus_trial', 'RB209 Section 4; PDA fodder beet nutrient-removal leaflet.', 'A high-K, high-Mg, often sodium-responsive root crop — K demand peaks fast in midsummer.', 1),
  (null, 'cereal_wheat', 'Winter / spring wheat (grain)', 'cereal_grain', 10, 't grain/ha', 'Winter ~10.4, spring ~7.5 t/ha', '{"p2o5":7.8,"k2o":5.6,"basis":"per t grain at 85% DM (grain only). Removing straw adds ~1.5 kg P₂O₅ and ~9–10 kg K₂O per tonne of straw (~0.5 t straw per t grain)."}'::jsonb, 'RB209 Section 4, driven by your SNS index. Feed wheat commonly works out around ~185 kg N/ha total (AHDB trials), split early-spring → stem extension → flag leaf. Add nitrogen for milling, and adjust down at higher SNS.', 185, 'offtake_replacement', '[{"label":"Early spring","timing":"GS25–30 (tillering)","note":"First split"},{"label":"Stem extension","timing":"GS30–32","note":"Main dressing"},{"label":"Flag leaf","timing":"GS37–39","note":"Final split / grain quality"}]'::jsonb, 6.5, 'Prefers a well-limed seedbed around pH 6.5.', 'Fertile, well-drained clay and loam.', 'Moderate — autumn or early-spring organics, watching nitrogen timing.', false, false, true, 'Cereals on light land are increasingly S-responsive — 25–50 kg SO₃/ha in spring is common insurance.', null, null, null, 'rb209', 'RB209 Section 4; AHDB feed-wheat N optimisation trials.', 'Feed wheat ~185 kg N/ha; P and K replace grain (and straw) offtake.', 2),
  (null, 'cereal_barley', 'Winter / spring barley (grain)', 'cereal_grain', 7.5, 't grain/ha', 'Winter ~9.4, spring ~7.4 t/ha', '{"p2o5":7.8,"k2o":5.6,"basis":"per t grain at 85% DM (grain only); straw removal adds potash as for wheat."}'::jsonb, 'RB209 Section 4 by SNS index. Feed barley commonly works out around ~162 kg N/ha total (AHDB trials); winter barley needs more than spring. Keep the early split firm — barley sets yield early.', 162, 'offtake_replacement', '[{"label":"Early spring","timing":"GS25–30","note":"Firm first split"},{"label":"Stem extension","timing":"GS30–31","note":"Balance of nitrogen"}]'::jsonb, 6.2, 'Barley is sensitive to low pH — keep at or above pH 6.2 (up to 7.0 is justified).', 'Grows well on lighter soils and loams, but punishes acidity.', 'Moderate; spring organics fit spring barley well.', false, false, true, 'As for wheat — consider 25–50 kg SO₃/ha on lighter land.', null, null, null, 'rb209', 'RB209 Section 4; AHDB feed-barley N optimisation trials.', 'Feed barley ~162 kg N/ha; pH-sensitive — keep the lime up.', 3),
  (null, 'cereal_oats', 'Winter / spring oats (grain)', 'cereal_grain', 8, 't grain/ha', 'Winter ~8.4, spring ~8.2 t/ha', '{"p2o5":7.8,"k2o":5.6,"basis":"per t grain at 85% DM (grain only); straw is potash-rich if removed."}'::jsonb, 'RB209 Section 4 (oats now have their own N economics table). Generally lower N than wheat — push it too hard and oats lodge.', 120, 'offtake_replacement', '[{"label":"Early spring","timing":"GS25–30","note":"First split"},{"label":"Stem extension","timing":"GS30–31","note":"Balance — keep modest to avoid lodging"}]'::jsonb, 5.8, 'The most acid-tolerant cereal — grows down to about pH 5.5.', 'Tolerant of a range of soils and lower pH than wheat or barley.', 'Moderate; tolerant crop, fits organics reasonably.', false, false, true, 'Lower demand than wheat/barley, but light-land crops still benefit from spring S.', null, null, null, 'rb209', 'RB209 Section 4 (oats N table).', 'A lower-N, acid-tolerant cereal — mind lodging.', 4),
  (null, 'wholecrop_wheat', 'Wholecrop wheat', 'forage', 11, 't DM/ha', '10–12 t DM/ha (winter)', '{"n":12.6,"p2o5":4.8,"k2o":14.7,"basis":"per t DM (measured). RB209 uses a generic wholecrop-cereal P/K basis — about 55 kg P₂O₅ and 160 kg K₂O/ha at Index 2 for a 30 t fresh/ha crop."}'::jsonb, 'Uses the grain-wheat N table (winter or spring) because it’s cut late — early-spring nitrogen then a GS30–32 top-up.', 180, 'offtake_replacement', '[{"label":"Early spring","timing":"GS25–30","note":"First split"},{"label":"Stem extension","timing":"GS30–32","note":"Top-up"}]'::jsonb, 6.5, null, 'As for wheat — fertile, well-drained clay and loam.', 'Good with planned spring organics.', false, false, true, 'As for grain wheat on lighter land.', null, null, null, 'rb209', 'RB209 Section 3 (wholecrop) & Section 4 (wheat N); AHDB/PDA forage trial.', 'Wholecrop wheat uses grain-wheat nitrogen logic.', 5),
  (null, 'wholecrop_barley', 'Wholecrop barley', 'forage', 11, 't DM/ha', '10–13 winter / 8–11 spring t DM/ha', '{"n":12,"p2o5":4.8,"k2o":14.7,"basis":"per t DM (generic wholecrop-cereal basis)."}'::jsonb, 'Winter- or spring-barley RB209 table by sowing season. Keep the early barley nitrogen split firm.', 150, 'offtake_replacement', '[{"label":"Early spring","timing":"GS25–30","note":"Firm first split"},{"label":"Stem extension","timing":"GS30–31","note":"Balance"}]'::jsonb, 6.2, 'Barley is sensitive to low pH — keep at or above pH 6.2.', 'Lighter soils and loams; pH-sensitive.', 'Good in spring-drilled systems.', false, false, true, 'As for grain barley on lighter land.', null, null, null, 'rb209', 'RB209 Section 3 (wholecrop) & Section 4 (barley N).', 'Switch winter/spring table by sowing; keep the first N split firm.', 6),
  (null, 'wholecrop_oats', 'Wholecrop oats / rye / triticale', 'forage', 10, 't DM/ha', '8–12 t DM/ha', '{"n":12,"p2o5":4.8,"k2o":14.7,"basis":"per t DM (generic wholecrop-cereal basis)."}'::jsonb, 'Spring oats, rye and triticale share a spring N table. Keep splits sensible to avoid lodging.', 110, 'offtake_replacement', '[{"label":"Early spring","timing":"GS25–30","note":"First split"},{"label":"Stem extension","timing":"GS30–31","note":"Balance"}]'::jsonb, 5.8, 'Oats tolerate more acidity — down to about pH 5.5.', 'Tolerant of a range of soils.', 'Good in spring-drilled systems.', false, false, true, 'Light-land crops benefit from spring S.', null, null, null, 'rb209', 'RB209 Section 3 (wholecrop) & Section 4 (spring cereals N).', 'Acid-tolerant; uses the generic wholecrop P and K basis.', 7),
  (null, 'kale', 'Kale (forage)', 'forage', 10, 't DM/ha', '8–12 t DM/ha at 12–15% DM', '{"p2o5":3,"k2o":30,"basis":"per t DM (estimate — brassicas are K-hungry; confirm against RB209)."}'::jsonb, 'Winter-hardy main crop, ~10 months in the ground; the highest N and K demand of the forage brassicas. N is still low by silage-grass standards and SNS-driven — most goes on in the seedbed with an early top-dress.', 100, 'seedbed_low_index_only', '[{"label":"Seedbed","timing":"At sowing","note":"Bulk of the nitrogen"},{"label":"Early top-dress","timing":"6–8 weeks after emergence","note":"Balance, while the crop is actively growing"}]'::jsonb, 6, 'Aim for pH 6.0+; clubroot risk rises on acid soils.', 'Wide soil tolerance; wants reasonable drainage and a firm seedbed. Grazed in situ.', 'Good slurry/FYM crop in the seedbed — but P & K are reserve-driven at Index 2+, so don’t overload.', true, false, true, 'Brassicas are S-hungry — 25–40 kg SO₃/ha in the seedbed is well justified, especially on light land.', null, 'brassica', null, 'rb209_plus_trial', 'RB209 Section 3 (forage brassicas); AHDB brassica guidance.', 'Highest N & K of the brassicas; grazed in situ; mind clubroot and pH.', 8),
  (null, 'swede', 'Swede (forage)', 'forage', 9, 't DM/ha (roots)', '8–11 t DM/ha', '{"p2o5":2.5,"k2o":25,"basis":"per t DM, roots (estimate; confirm against RB209)."}'::jsonb, 'Precision-drilled main-crop root. N low and SNS-driven — a little less than kale. Boron-sensitive: brown heart shows up where boron is short.', 90, 'seedbed_low_index_only', '[{"label":"Seedbed","timing":"At drilling","note":"Most of the nitrogen"},{"label":"Early top-dress","timing":"Once established","note":"Small balance if needed"}]'::jsonb, 6, 'Aim for pH 6.0+ to manage clubroot.', 'Deep, well-drained loams; precision-drilled. Can be lifted or grazed in situ.', 'Seedbed organics fine; P & K reserve-driven at Index 2+.', true, false, true, 'S-hungry like the other brassicas — include S in the seedbed on light land.', '[{"nutrient":"Boron","note":"Swede is boron-sensitive (brown heart). Apply ~1–3 kg/ha boron where soils are low, especially light/high-pH land. Do NOT over-apply — boron is toxic in excess.","kgPerHa":2}]'::jsonb, 'brassica', 'If swedes are lifted and carted rather than grazed in situ, potash offtake rises — top up K accordingly.', 'rb209_plus_trial', 'RB209 Section 3 (forage brassicas); AHDB root brassica guidance.', 'Boron-sensitive root brassica; low N; seedbed-only P & K at low index.', 9),
  (null, 'hybrid_brassica', 'Hybrid brassica (rape × kale)', 'forage', 8, 't DM/ha', '6–10 t DM/ha', '{"p2o5":3,"k2o":28,"basis":"per t DM (estimate; confirm against RB209)."}'::jsonb, 'Fast, leafy hybrids (e.g. Redstart). RB209 says use the rape / swede / stubble-turnip recommendations — low, SNS-driven N, seedbed-led.', 90, 'seedbed_low_index_only', '[{"label":"Seedbed","timing":"At sowing","note":"Most of the nitrogen"},{"label":"Top-dress","timing":"If taking a second graze","note":"Modest follow-up"}]'::jsonb, 6, 'Aim for pH 6.0+; clubroot risk on acid soils.', 'Flexible; good for multi-graze catch/main-crop use. Grazed in situ.', 'Seedbed organics fine; reserve-driven P & K at Index 2+.', true, false, true, 'S-hungry — seedbed SO₃ on light land.', null, 'brassica', null, 'trial', 'RB209 Section 3 (use rape/swede/turnip recommendations); breeder guidance.', 'Use rape/swede/turnip rules; low N; clubroot break still applies.', 10),
  (null, 'forage_rape', 'Forage rape (catch)', 'catch', 4, 't DM/ha', '3–5 t DM/ha', '{"p2o5":3,"k2o":30,"basis":"per t DM (estimate; confirm against RB209)."}'::jsonb, 'Fast catch crop (~6 months). RB209 ceiling is ≤75 kg N/ha at N Index 0–1 — apply less if the soil is moist or freshly cultivated (more mineralised N available). Mostly seedbed N.', 75, 'seedbed_low_index_only', '[{"label":"Seedbed","timing":"At sowing","note":"Up to the 75 kg N/ha ceiling — less on moist/cultivated soils"}]'::jsonb, 6, 'pH 6.0+ preferred; clubroot break applies.', 'Quick cover after cereals or before a reseed. Grazed in situ.', 'A little seedbed slurry helps; P & K reserve-driven at Index 2+.', false, false, true, 'Brassica — S-hungry; seedbed SO₃ on light land.', null, 'brassica', null, 'rb209', 'RB209 Section 3 (forage brassicas / catch crops).', '≤75 kg N/ha at Index 0–1; fast brassica catch crop; clubroot break applies.', 11),
  (null, 'stubble_turnips', 'Stubble turnips (catch)', 'catch', 5.5, 't DM/ha', '5–6 t DM/ha', '{"p2o5":3,"k2o":30,"basis":"per t DM (estimate; confirm against RB209)."}'::jsonb, 'After-cereal catch crop. Same RB209 ceiling as forage rape — ≤75 kg N/ha at N Index 0–1, less on moist or freshly cultivated soils. Roughly half the DM yield of kale.', 75, 'seedbed_low_index_only', '[{"label":"Seedbed","timing":"At sowing","note":"Up to the 75 kg N/ha ceiling — less on moist/cultivated soils"}]'::jsonb, 6, 'pH 6.0+ preferred; clubroot break applies.', 'Sown into cereal stubble for autumn/winter grazing. Grazed in situ.', 'Modest seedbed organics; P & K reserve-driven at Index 2+.', false, false, true, 'Brassica — S-hungry; seedbed SO₃ on light land.', null, 'brassica', null, 'rb209', 'RB209 Section 3 (forage brassicas / catch crops).', '≤75 kg N/ha at Index 0–1; after-cereal brassica catch crop.', 12),
  (null, 'italian_ryegrass', 'Italian ryegrass (catch crop)', 'catch', 14, 't DM/ha', '10–15 t DM/ha', '{"n":22,"p2o5":7.9,"k2o":36.8,"basis":"per t DM (Kingshay/PDA trial average)."}'::jsonb, 'Manage like intensive silage grass — silage-style N timing with generous totals across the growing window.', 280, 'offtake_replacement', '[{"label":"First dressing","timing":"At establishment / early growth","note":"Get nitrogen on early"},{"label":"Per-cut top-ups","timing":"After each cut","note":"Replace what the cut removed"}]'::jsonb, 6.2, null, 'Fast-growing and hungry; suffers badly if potash runs short.', 'A very good slurry / FYM user if the timing is right.', false, false, false, null, null, null, null, 'trial', 'Kingshay/PDA forage-crop nutrient-removal work (cited in AHDB’s RB209 Section 3 review).', 'Treat it as intensive silage grass — fast and very potash-hungry.', 13)
on conflict (seed_key) do update set
    label = excluded.label,
    category = excluded.category,
    yield_default = excluded.yield_default,
    yield_unit = excluded.yield_unit,
    yield_range = excluded.yield_range,
    offtake = excluded.offtake,
    total_n = excluded.total_n,
    n_target_kg_per_ha = excluded.n_target_kg_per_ha,
    pk_regime = excluded.pk_regime,
    n_stages = excluded.n_stages,
    target_ph = excluded.target_ph,
    ph_note = excluded.ph_note,
    soil_fit = excluded.soil_fit,
    manure_fit = excluded.manure_fit,
    needs_mg = excluded.needs_mg,
    needs_na = excluded.needs_na,
    needs_s = excluded.needs_s,
    sulphur_note = excluded.sulphur_note,
    micros = excluded.micros,
    family = excluded.family,
    k_lift_top_up_note = excluded.k_lift_top_up_note,
    evidence = excluded.evidence,
    sources = excluded.sources,
    summary = excluded.summary,
    sort_order = excluded.sort_order;

commit;
