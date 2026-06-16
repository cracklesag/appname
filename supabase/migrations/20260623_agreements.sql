-- =====================================================================
-- Swardly · Agri-environment agreements catalogue (public.agreements)
-- Run in the Supabase SQL editor BEFORE deploying. Idempotent; one
-- transaction (rolls back wholesale on any error).
-- =====================================================================
--
-- The third grouping axis: SFI / Countryside Stewardship / Environmental
-- Stewardship agreements a field sits in, and the restrictions they carry
-- (fertiliser caps, cutting-date windows, grazing/livestock limits). Design
-- mirrors public.crops / grass_systems exactly:
--   * shared SEED rows (user_id = null) with a stable seed_key, and
--   * user-owned forks / customs (user_id set, seed_key null).
-- Unlike blocks/types (one per field), agreements are MANY-to-many — see
-- 20260624_field_agreements.sql.
--
-- All restriction columns are advisory: they feed warnings and the composed
-- N cap (lib/agreements.ts), never changing a recommended number or blocking
-- a save. Month-day columns are 'MM-DD' text so they repeat yearly, matching
-- groups.earliest_fert_md. NVZ is NOT seeded (statutory; modelled separately).
--
-- The seed block at the bottom is GENERATED from lib/agreements.ts by
-- scripts/gen-agreements-seed.ts (ON CONFLICT (seed_key) DO UPDATE), so
-- re-running re-syncs every shared agreement to the current code.

begin;

-- ---------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------
create table if not exists public.agreements (
  id                              uuid primary key default gen_random_uuid(),
  -- null = shared seed; set = a user's fork/custom agreement.
  user_id                         uuid references auth.users(id) on delete cascade,
  -- Stable key per shared seed (NULL for user customs).
  seed_key                        text,
  code                            text not null,
  name                            text not null,
  scheme                          text not null check (scheme in ('sfi', 'cs', 'es', 'custom')),
  summary                         text not null default '',

  -- Nutrient caps (advisory) -----------------------------------------
  no_manufactured_fert            boolean not null default false,
  manufactured_n_cap_kg_ha        numeric,
  total_n_cap_kg_ha               numeric,
  organic_manure_cap_t_ha         numeric,
  manure_cut_years_only           boolean not null default false,
  organic_n_field_cap_kg_ha       numeric,
  no_phosphate                    boolean not null default false,
  no_potash                       boolean not null default false,

  -- Cutting / timing windows ('MM-DD') -------------------------------
  closed_cut_start_md             text,
  closed_cut_end_md               text,
  earliest_cut_md                 text,
  manufactured_n_closed_start_md  text,
  manufactured_n_closed_end_md    text,

  -- Grazing / livestock ----------------------------------------------
  livestock_exclusion_weeks_pre_cut int,
  grazing_closed_start_md         text,
  grazing_closed_end_md           text,
  max_stocking_lu_ha              numeric,
  no_supplementary_feeding        boolean not null default false,
  mineral_blocks_allowed          boolean not null default false,

  -- Other ------------------------------------------------------------
  min_ph                          numeric,
  note                            text,

  sort_order                      int not null default 0,
  created_at                      timestamptz not null default now(),
  -- A user can't hold two agreements with the same code; shared rows may
  -- coexist with a user's identically-coded fork (NULLs distinct in PG).
  unique (user_id, code),
  unique (seed_key)
);

create index if not exists agreements_user_idx on public.agreements (user_id, sort_order, code);

-- ---------------------------------------------------------------------
-- 2. RLS — read shared + own (+ farm members read the admin's customs);
--    writes are admin-only, exactly like crops/grass_systems. Editing a
--    shared seed is not allowed: the app forks it (insert a copy). A solo
--    owner with no farm_members row yet is covered by has_no_membership().
-- ---------------------------------------------------------------------
alter table public.agreements enable row level security;

drop policy if exists "agreements read shared and own" on public.agreements;
create policy "agreements read shared and own" on public.agreements
  for select using (
    user_id is null
    or user_id = auth.uid()
    or public.is_member_of(user_id)
  );

drop policy if exists "agreements insert own" on public.agreements;
create policy "agreements insert own" on public.agreements
  for insert with check (
    user_id = auth.uid()
    and (public.is_admin_of(auth.uid()) or public.has_no_membership())
  );

drop policy if exists "agreements update own" on public.agreements;
create policy "agreements update own" on public.agreements
  for update using (
    user_id = auth.uid()
    and (public.is_admin_of(auth.uid()) or public.has_no_membership())
  ) with check (
    user_id = auth.uid()
    and (public.is_admin_of(auth.uid()) or public.has_no_membership())
  );

drop policy if exists "agreements delete own" on public.agreements;
create policy "agreements delete own" on public.agreements
  for delete using (
    user_id = auth.uid()
    and (public.is_admin_of(auth.uid()) or public.has_no_membership())
  );

-- ---------------------------------------------------------------------
-- 3. Seed shared agreements (GENERATED from lib/agreements.ts — do not
--    hand-edit; regenerate with: npx tsx scripts/gen-agreements-seed.ts).
--    Re-runnable.
-- ---------------------------------------------------------------------
insert into public.agreements
  (user_id, seed_key, code, name, scheme, summary, no_manufactured_fert, manufactured_n_cap_kg_ha, total_n_cap_kg_ha, organic_manure_cap_t_ha, manure_cut_years_only, organic_n_field_cap_kg_ha, no_phosphate, no_potash, closed_cut_start_md, closed_cut_end_md, earliest_cut_md, manufactured_n_closed_start_md, manufactured_n_closed_end_md, livestock_exclusion_weeks_pre_cut, grazing_closed_start_md, grazing_closed_end_md, max_stocking_lu_ha, no_supplementary_feeding, mineral_blocks_allowed, min_ph, note, sort_order)
values
  (null, 'sfi_sam3', 'SAM3', 'Herbal leys', 'sfi', 'Grass/legume/herb ley; minimise inorganic N (~40 kg N/ha typical). Also CSAM3 under SFI24.', false, 40, null, null, false, null, false, false, null, null, null, null, null, null, null, null, null, false, false, null, 'No pesticides on the established ley (spot-treatment of weeds aside). The ~40 kg N is typical guidance — set to your agreement.', 0),
  (null, 'sfi_lig1', 'LIG1', 'Low-input grassland (outside SDA)', 'sfi', 'Very low nutrient inputs on improved grassland; supplementary feeding allowed.', false, null, null, null, false, null, false, false, null, null, null, null, null, null, null, null, null, false, false, null, 'No fixed N figure — "very low inputs". Supplementary feeding is permitted (unlike CS GS2).', 1),
  (null, 'sfi_lig2', 'LIG2', 'Low-input grassland (SDA)', 'sfi', 'As LIG1, for grassland within Severely Disadvantaged Areas.', false, null, null, null, false, null, false, false, null, null, null, null, null, null, null, null, null, false, false, null, 'No fixed N figure — "very low inputs". Supplementary feeding permitted.', 2),
  (null, 'sfi_num3', 'NUM3', 'Legume fallow', 'sfi', 'Sown legume fallow; static (maintain the same area each year). No fertiliser.', true, null, null, null, false, null, false, false, null, null, null, null, null, null, null, null, null, false, false, null, 'Rotational-fallow equivalent of CS AB15, but static under SFI.', 3),
  (null, 'cs_gs2', 'GS2', 'Permanent grassland, very low inputs (outside SDA)', 'cs', 'Restricted fertiliser; FYM ≤12 t/ha; maintain pH ≥5.4 by liming.', false, null, null, 12, false, null, false, false, null, null, null, null, null, null, null, null, null, false, false, 5.4, 'Fertiliser as an alternative to FYM is restricted and must not be increased above the existing low rate. Sward-height management applies.', 10),
  (null, 'cs_gs5', 'GS5', 'Permanent grassland, very low inputs (SDA)', 'cs', 'As GS2, for grassland within Severely Disadvantaged Areas.', false, null, null, 12, false, null, false, false, null, null, null, null, null, null, null, null, null, false, false, 5.4, 'Fertiliser restricted; sward-height management applies.', 11),
  (null, 'cs_gs4', 'GS4', 'Legume and herb-rich swards', 'cs', 'Mixed legume/herb sward; restricts artificial nitrogen; no pesticides.', false, null, null, null, false, null, false, false, null, null, null, null, null, null, null, null, null, false, false, null, 'Restricts artificial N (the CS equivalent of SFI herbal leys). Must follow a recommended fertiliser/nutrient management system.', 12),
  (null, 'cs_gs6', 'GS6', 'Management of species-rich grassland', 'cs', 'No inorganic fertiliser; no cut 15 Mar–30 Jun; exclude stock 7 wks pre-cut; FYM ≤12 t/ha cut years only; no supp. feed except mineral blocks.', true, null, null, 12, true, null, false, false, '03-15', '06-30', null, null, null, 7, null, null, null, true, true, null, 'Priority-habitat grassland (must be mapped). Control dense rush below 20% cover by 30 Sep.', 13),
  (null, 'cs_gs7', 'GS7', 'Restoration towards species-rich grassland', 'cs', 'Very little or no manure, fertiliser, pesticide or supplementary feed.', true, null, null, null, false, null, false, false, null, null, null, null, null, null, null, null, null, true, true, null, 'Restoration timetable agreed with Natural England; may introduce new species.', 14),
  (null, 'cs_gs8', 'GS8', 'Creation of species-rich grassland', 'cs', 'Sward creation on low-fertility land; minimal inputs, low soil P required.', true, null, null, null, false, null, false, false, null, null, null, null, null, null, null, null, null, false, false, null, 'Feasible only where soil fertility (especially available P) is low. Establish by regeneration or an approved seed mix.', 15),
  (null, 'cs_sw9', 'SW9', 'Seasonal livestock removal on intensive grassland', 'cs', 'Remove livestock over winter (~5.5 consecutive months).', false, null, null, null, false, null, false, false, null, null, null, null, null, null, '11-01', '04-15', null, false, false, null, 'The ~5.5-month winter window is a seeded default — set the exact dates to your agreement.', 16),
  (null, 'sfi_wbd6', 'WBD6', 'Remove livestock from intensive grassland (autumn & winter, outside SDA)', 'sfi', 'No grazing over the autumn/winter period on intensive grassland.', false, null, null, null, false, null, false, false, null, null, null, null, null, null, '10-01', '03-31', null, false, false, null, 'SFI26 action. WBD7 is the equivalent within SDAs. Set the exact window to your agreement.', 20),
  (null, 'es_ek3', 'EK3', 'Permanent grassland with very low inputs (ELS, legacy)', 'es', 'Legacy ELS option — permanent grassland managed with very low inputs.', false, null, null, null, false, null, false, false, null, null, null, null, null, null, null, null, null, false, false, null, 'Older Entry Level Stewardship agreement. Low fertiliser/spray inputs; check your agreement document for the exact limits.', 30),
  (null, 'es_hk6', 'HK6', 'Maintenance of species-rich, semi-natural grassland (HLS, legacy)', 'es', 'Legacy HLS option — low fertility, sward managed by grazing/cutting to height targets.', true, null, null, null, false, null, false, false, null, null, null, null, null, null, null, null, null, false, false, null, 'Older Higher Level Stewardship agreement. Sward-height management (often ~2–10 cm by autumn); no new drainage. HK7/HK8 are the restoration/creation variants.', 31)
on conflict (seed_key) do update set
    code = excluded.code,
    name = excluded.name,
    scheme = excluded.scheme,
    summary = excluded.summary,
    no_manufactured_fert = excluded.no_manufactured_fert,
    manufactured_n_cap_kg_ha = excluded.manufactured_n_cap_kg_ha,
    total_n_cap_kg_ha = excluded.total_n_cap_kg_ha,
    organic_manure_cap_t_ha = excluded.organic_manure_cap_t_ha,
    manure_cut_years_only = excluded.manure_cut_years_only,
    organic_n_field_cap_kg_ha = excluded.organic_n_field_cap_kg_ha,
    no_phosphate = excluded.no_phosphate,
    no_potash = excluded.no_potash,
    closed_cut_start_md = excluded.closed_cut_start_md,
    closed_cut_end_md = excluded.closed_cut_end_md,
    earliest_cut_md = excluded.earliest_cut_md,
    manufactured_n_closed_start_md = excluded.manufactured_n_closed_start_md,
    manufactured_n_closed_end_md = excluded.manufactured_n_closed_end_md,
    livestock_exclusion_weeks_pre_cut = excluded.livestock_exclusion_weeks_pre_cut,
    grazing_closed_start_md = excluded.grazing_closed_start_md,
    grazing_closed_end_md = excluded.grazing_closed_end_md,
    max_stocking_lu_ha = excluded.max_stocking_lu_ha,
    no_supplementary_feeding = excluded.no_supplementary_feeding,
    mineral_blocks_allowed = excluded.mineral_blocks_allowed,
    min_ph = excluded.min_ph,
    note = excluded.note,
    sort_order = excluded.sort_order;

commit;
