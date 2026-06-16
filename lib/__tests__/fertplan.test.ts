// Integration tests for the fert-plan builder (lib/fertplan.ts).
//
// These lock the behaviour the plan page and spread lists hang off:
//   * gross P/K demand rolls forward cut to cut (+ one-off catch-up K),
//   * pre-cut organic carryover is release-curve adjusted and NOT reduced by
//     offtake (the demand side already accounts for removal — subtracting it
//     from supply too was the K over-recommendation bug),
//   * planField nets the intended planner slurry against slurry ALREADY
//     LOGGED since the cut — the "Deer Park" fix, where a field with its
//     slurry logged had it deducted twice and the bag rate came out half
//     size. That regression test is the most important one in this file.
//
// The clock is pinned to 12 Jun 2026 so release-month maths is deterministic.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildFertPlanRows, planField, type FertPlanRow, type PlanState } from '@/lib/fertplan';
import { DEFAULT_SETTINGS, type Field, type Product, type Application, type Cut, type Settings } from '@/lib/types';

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

let pid = 100;
function makeProduct(over: Partial<Product>): Product {
  return {
    id: pid++, user_id: null, name: over.name ?? 'P', type: 'bag_fert', category: null, sort_order: 0,
    dm_pct: null, form: null, density_kg_per_l: null,
    n_pct: null, p2o5_pct: null, k2o_pct: null, s_pct: null,
    n_kg_per_m3: null, p2o5_kg_per_m3: null, k2o_kg_per_m3: null, so3_kg_per_m3: null, mgo_kg_per_m3: null,
    n_kg_per_t: null, p2o5_kg_per_t: null, k2o_kg_per_t: null, so3_kg_per_t: null, mgo_kg_per_t: null,
    ...over,
  };
}

function makeField(over: Partial<Field>): Field {
  return {
    id: over.id ?? 'f1', user_id: 'u1', group_id: null, allocation_type_id: null, name: 'Deer Park',
    acres: 10, ha: 4, cut_profile: 3, planned_cuts: ['silage', 'silage', 'silage'],
    ph: 6.2, p_idx: 2, k_idx: 2, mg_idx: null,
    boundary: null, centroid_lat: null, centroid_lng: null, area_ha_mapped: null,
    boundary_source: null, rpa_sheet_id: null, rpa_parcel_id: null, boundary_updated_at: null,
    sampled: true, sample_date: '2025-11-01', soil_type: 'medium_loam', grass_system_id: null,
    last_ploughed: null, last_reseeded: null, notes: null, needs_setup: false,
    created_at: '', updated_at: '',
    ...over,
  };
}

function makeApp(over: Partial<Application> & { product_id: number; date_applied: string; rate_value: number; rate_unit: Application['rate_unit'] }): Application {
  return {
    id: `a-${Math.random()}`, user_id: 'u1', created_by: null, field_id: 'f1',
    method: null, notes: null, applied_by: 'me', created_at: '',
    coverage: 'whole', reconciled_at: null, drawn_ha: null,
    ...over,
  };
}

function makeCut(over: Partial<Cut> & { cut_date: string; cut_number: number }): Cut {
  return {
    id: `c-${Math.random()}`, user_id: 'u1', created_by: null, field_id: 'f1',
    cut_type: 'silage', yield_class: 'average', next_action: 'another_cut_silage',
    notes: null, created_at: '',
    ...over,
  };
}

function settings(): Settings {
  return structuredClone(DEFAULT_SETTINGS);
}

// Dairy slurry with clean per-m³ figures: 2 N / 1 P₂O₅ / 4 K₂O.
const slurry = makeProduct({ name: 'Dairy slurry', type: 'slurry', category: 'dairy_slurry', n_kg_per_m3: 2, p2o5_kg_per_m3: 1, k2o_kg_per_m3: 4 });
const fym = makeProduct({ name: 'FYM', type: 'solid_manure', category: 'fym', n_kg_per_t: 6, p2o5_kg_per_t: 3, k2o_kg_per_t: 2 });
const npk = makeProduct({ name: '25-5-5', type: 'bag_fert', form: 'granular', n_pct: 25, p2o5_pct: 5, k2o_pct: 5 });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-12T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

// ---------------------------------------------------------------------
// buildFertPlanRows
// ---------------------------------------------------------------------

describe('buildFertPlanRows', () => {
  it('fresh field, first cut: needs come straight from RB209 + catch-up K, N from the cut target', () => {
    const rows = buildFertPlanRows([makeField({})], [], [], [slurry, npk], settings(), []);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.cutNumber).toBe(1);
    expect(r.pNeed).toBe(40);                 // SILAGE_P cut1 @ P2
    expect(r.kNeed).toBe(110);                // 80 spring (K 2-) + 30 catch-up (3-cut)
    expect(r.p2o5ToApply).toBe(40);
    expect(r.k2oToApply).toBe(110);
    expect(r.nToApply).toBe(110);             // nTargets[1]
    expect(r.kBandLabel).toBe('2-');
    expect(r.pBand).toBe(2);
  });

  it('slurry logged since the window nets off all three nutrients', () => {
    // 2,500 gal/ac on 1 Jun, splash plate (June ⇒ 50% N avail).
    // m³/ha = 2500 × 0.01124 = 28.1 → N 28.1, P 28.1, K 112.4.
    const app = makeApp({ product_id: slurry.id, date_applied: '2026-06-01', rate_value: 2500, rate_unit: 'gal/ac', method: 'splash_plate' });
    const r = buildFertPlanRows([makeField({})], [app], [], [slurry, npk], settings(), [])[0];
    expect(r.loggedOrganicN).toBe(28);
    expect(r.loggedOrganicP).toBe(28);
    expect(r.loggedOrganicK).toBe(112);
    expect(r.p2o5ToApply).toBe(Math.round(40 - 28.1));   // 12
    expect(r.k2oToApply).toBe(0);                        // 110 − 112.4 → clamped
    expect(r.nToApply).toBe(Math.round(110 - 28.1));     // 82
  });

  it('pre-cut organic carries over via the release curve and is NOT cut by offtake', () => {
    // Cut on 15 May ⇒ window starts there; FYM spread 1 Mar (3 whole months
    // before today=12 Jun ⇒ release 0.35 + 3×0.10 = 0.65).
    // 20 t/ha × 3 kg P/t = 60 P ⇒ carryP 39; × 2 kg K/t = 40 K ⇒ carryK 26.
    const cut = makeCut({ cut_date: '2026-05-15', cut_number: 1 });
    const muck = makeApp({ product_id: fym.id, date_applied: '2026-03-01', rate_value: 20, rate_unit: 't/ha', method: 'surface' });
    const r = buildFertPlanRows([makeField({})], [muck], [cut], [fym, npk], settings(), [])[0];

    expect(r.cutNumber).toBe(2);
    expect(r.carryP).toBe(39);
    expect(r.carryK).toBe(26);
    // Gross demand rolls forward: cut1 (40 P / 80 K) + cut2 (25 P / 90 K) + 30 catch-up K.
    expect(r.pNeed).toBe(65);
    expect(r.kNeed).toBe(200);
    expect(r.p2o5ToApply).toBe(65 - 39);
    expect(r.k2oToApply).toBe(200 - 26);
    // The regression: a cut was taken, yet carryover is NOT reduced by its
    // offtake — removal lives on the demand side only.
    expect(r.carryP).not.toBeLessThan(39);
    // N never carries across the cut window.
    expect(r.nToApply).toBe(80); // nTargets[2], nothing applied since 15 May
  });

  it('fields flagged needs_setup are excluded', () => {
    expect(buildFertPlanRows([makeField({ needs_setup: true })], [], [], [], settings(), [])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// planField — intended slurry, netting, min-spread hold, manual override
// ---------------------------------------------------------------------

function makeRow(over: Partial<FertPlanRow>): FertPlanRow {
  return {
    id: 'f1', name: 'Deer Park', groupId: null, groupName: null,
    areaValue: 4, areaUnit: 'ha', ha: 4, sampled: true, ph: 6.2, pIdx: 2, kIdx: 2,
    pBand: 2, kBandLabel: '2-', cutType: 'silage', cutNumber: 1,
    p2o5ToApply: 40, k2oToApply: 110, nToApply: 110,
    carryP: 0, carryK: 0,
    loggedOrganicP: 0, loggedOrganicN: 0, loggedOrganicK: 0,
    loggedGranularP: 0, loggedGranularK: 0,
    nNeed: 110, pNeed: 40, kNeed: 110,
    appliedN: 0, appliedP: 0, appliedK: 0,
    ...over,
  };
}

const planSettings = {
  slurryUnit: 'gal/ac' as const,
  unitSystem: 'acres' as const,
  minSpreadP2O5KgPerHa: 20,
  minSpreadK2OKgPerHa: 25,
};

function state(over: Partial<PlanState>): PlanState {
  return {
    defaultOrganicId: slurry.id, defaultRate: '2500',
    overrides: {}, excludedProductIds: [], excludedFieldIds: [], slurryOffFieldIds: [],
    ...over,
  };
}

describe('planField', () => {
  // June 12 (mocked), splash plate ⇒ 50% N avail; 2,500 gal/ac ⇒ 28.1 m³/ha
  // ⇒ intended slurry rounds to N 28 / P 28 / K 112.

  it('DEER PARK REGRESSION: slurry already logged is not deducted twice', () => {
    // The row's *ToApply figures already net the logged slurry out. The
    // intended planner slurry must therefore contribute only what EXCEEDS
    // the logged amount — here, nothing.
    const row = makeRow({
      loggedOrganicN: 28, loggedOrganicP: 28, loggedOrganicK: 112,
      nToApply: 82, p2o5ToApply: 12, k2oToApply: 0,
      appliedN: 28, appliedP: 28, appliedK: 112,
    });
    const planned = planField(row, state({}), [slurry], [npk], planSettings);
    expect(planned.slurryN).toBe(0);
    expect(planned.slurryP).toBe(0);
    expect(planned.slurryK).toBe(0);
    // The bag plan therefore aims at the TRUE residual, not half of it.
    expect(planned.nAfter).toBe(82);
    expect(planned.pHeld).toBe(true);  // 12 < 20 min-spread ⇒ held, not dribbled
    expect(planned.pAfter).toBe(0);
  });

  it('no logged slurry: the intended rate deducts in full', () => {
    const planned = planField(makeRow({}), state({}), [slurry], [npk], planSettings);
    expect(planned.slurryN).toBe(28);
    expect(planned.slurryP).toBe(28);
    expect(planned.slurryK).toBe(112);
    expect(planned.nAfter).toBe(110 - 28);
    expect(planned.pAfter).toBe(0);          // 40 − 28 = 12 → below min-spread, held
    expect(planned.pHeld).toBe(true);
    expect(planned.kAfter).toBe(0);          // 110 − 112 → clamped
    expect(planned.slurryTotal).toBe(2500 * 4);
  });

  it('slurry switched off for the field contributes nothing', () => {
    const planned = planField(makeRow({}), state({ slurryOffFieldIds: ['f1'] }), [slurry], [npk], planSettings);
    expect(planned.slurryN).toBe(0);
    expect(planned.organicName).toBeNull();
    expect(planned.nAfter).toBe(110);
  });

  it('min-spread hold zeroes a sub-threshold K residual', () => {
    const planned = planField(makeRow({ k2oToApply: 24, p2o5ToApply: 0, nToApply: 0 }), state({ defaultOrganicId: '' }), [slurry], [npk], planSettings);
    expect(planned.kHeld).toBe(true);
    expect(planned.kAfter).toBe(0);
  });

  it('manual granular override is honoured verbatim and never N-capped', () => {
    const planned = planField(
      makeRow({ nToApply: 0, p2o5ToApply: 0, k2oToApply: 0 }),
      state({ defaultOrganicId: '', granularOverrides: { f1: { productId: npk.id, rate: '400' } } }),
      [slurry], [npk], planSettings,
    );
    expect(planned.planProducts).toHaveLength(1);
    expect(planned.planProducts[0]).toMatchObject({ productName: '25-5-5', rateKgPerHa: 400, totalKg: 1600 });
    expect(planned.supplyN).toBe(100); // 400 × 25% — deliberately over the 0 target
    expect(planned.planNote).toContain('Manual');
  });

  it('excluded products never enter the auto plan', () => {
    const planned = planField(
      makeRow({ nToApply: 0, p2o5ToApply: 30, k2oToApply: 0 }),
      state({ defaultOrganicId: '', excludedProductIds: [npk.id] }),
      [slurry], [npk], planSettings,
    );
    expect(planned.planProducts).toHaveLength(0);
    expect(planned.nothingGranular).toBe(true);
  });
});
