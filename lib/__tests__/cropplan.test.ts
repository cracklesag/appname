// Tests for the crop nutrient engine (lib/cropplan.ts).
//
// These lock the RB209 *rules* the crop plan hangs off, independent of the exact
// per-crop numbers (which live in the editable catalogue):
//   * offtake-replacement crops (cereals/maize/beet): build at Index 0–1,
//     replace offtake at Index 2, nil at Index 3+;
//   * forage brassicas: a seedbed dressing ONLY at Index 0–1, nil at Index 2+,
//     and N is a CEILING (SNS only reduces it);
//   * organic applications logged on the crop field net against the need, reusing
//     the grass engine's crediting (slurry N availability + P/K release curve);
//   * the brassica clubroot 5-year-break warning fires correctly.
//
// Clock pinned to 12 Jun 2026 so release-month maths is deterministic.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildCropPlan, cropNTarget, cropPKRecommendation, brassicaClubrootWarning,
  cropSeasonWindow, currentCropSeason,
} from '@/lib/cropplan';
import { getCropProfile, type CropProfile } from '@/lib/crops';
import {
  DEFAULT_SETTINGS, type Field, type Product, type Application,
  type FieldCropAllocation, type Settings,
} from '@/lib/types';

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

let pid = 200;
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
    id: over.id ?? 'f1', user_id: 'u1', group_id: null, allocation_type_id: null, name: 'Top Forty',
    acres: 10, ha: 4, cut_profile: 3, grazing_yield_band: null, planned_cuts: ['silage'],
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

function makeAlloc(over: Partial<FieldCropAllocation> & { crop_key: string }): FieldCropAllocation {
  return {
    id: 'al1', user_id: 'u1', field_id: 'f1', crop_id: 'crop-uuid',
    season: 2026, expected_yield: null, expected_yield_unit: null,
    sown_date: null, harvest_date: null, status: 'active', notes: null,
    created_by: null, created_at: '', updated_at: '',
    ...over,
  };
}

function settings(): Settings {
  return structuredClone(DEFAULT_SETTINGS);
}

function profile(key: string): CropProfile {
  const p = getCropProfile(key);
  if (!p) throw new Error(`missing crop profile ${key}`);
  return p;
}

const slurry = makeProduct({ name: 'Dairy slurry', type: 'slurry', category: 'dairy_slurry', n_kg_per_m3: 2, p2o5_kg_per_m3: 1, k2o_kg_per_m3: 4 });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-12T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

// ---------------------------------------------------------------------
// Season helpers
// ---------------------------------------------------------------------

describe('season window', () => {
  it('season N runs 1 Oct (N-1) to 30 Sep N', () => {
    expect(cropSeasonWindow(2026)).toEqual({ start: '2025-10-01', end: '2026-09-30' });
  });
  it('current season is the end-year (June 2026 → 2026; Oct 2026 → 2027)', () => {
    expect(currentCropSeason('2026-06-12')).toBe(2026);
    expect(currentCropSeason('2026-10-05')).toBe(2027);
    expect(currentCropSeason('2025-12-01')).toBe(2026);
  });
});

// ---------------------------------------------------------------------
// Nitrogen target (SNS adjust; ceiling behaviour for brassicas)
// ---------------------------------------------------------------------

describe('cropNTarget', () => {
  it('cereal (offtake regime) adjusts N both ways for SNS', () => {
    const wheat = profile('cereal_wheat'); // anchor 185
    expect(cropNTarget(wheat, 'low').n).toBe(215);
    expect(cropNTarget(wheat, 'moderate').n).toBe(185);
    expect(cropNTarget(wheat, 'high').n).toBe(155);
    expect(cropNTarget(wheat, 'moderate').isCeiling).toBe(false);
  });

  it('forage brassica N is a ceiling — never raised for low SNS, only cut for high', () => {
    const rape = profile('forage_rape'); // ceiling 75
    expect(cropNTarget(rape, 'low').n).toBe(75);      // NOT 105
    expect(cropNTarget(rape, 'moderate').n).toBe(75);
    expect(cropNTarget(rape, 'high').n).toBe(45);
    expect(cropNTarget(rape, 'low').isCeiling).toBe(true);
  });
});

// ---------------------------------------------------------------------
// P/K recommendation by regime + index
// ---------------------------------------------------------------------

describe('cropPKRecommendation — offtake replacement (cereal)', () => {
  const wheat = profile('cereal_wheat'); // offtake 7.8 P, 5.6 K per t grain
  it('Index 2: replaces offtake for a 10 t crop', () => {
    const r = cropPKRecommendation(wheat, makeField({ p_idx: 2, k_idx: 2 }), 10);
    expect(r.p2o5).toBe(78);
    expect(r.k2o).toBe(56);
  });
  it('Index 0: offtake + build increment', () => {
    const r = cropPKRecommendation(wheat, makeField({ p_idx: 0, k_idx: 0 }), 10);
    expect(r.p2o5).toBe(108); // 78 + 30
    expect(r.k2o).toBe(116);  // 56 + 60
  });
  it('Index 3+: nil (run down reserves)', () => {
    const r = cropPKRecommendation(wheat, makeField({ p_idx: 3, k_idx: 3 }), 10);
    expect(r.p2o5).toBe(0);
    expect(r.k2o).toBe(0);
  });
});

describe('cropPKRecommendation — brassica (seedbed only at low index)', () => {
  const rape = profile('forage_rape'); // offtake 3.0 P, 30 K per t DM
  it('Index 0–1: a seedbed dressing', () => {
    const r = cropPKRecommendation(rape, makeField({ p_idx: 0, k_idx: 1 }), 4);
    expect(r.p2o5).toBe(12);  // 3.0 × 4
    expect(r.k2o).toBe(120);  // 30 × 4
  });
  it('Index 2+: nil — the crop lives off reserves', () => {
    const r = cropPKRecommendation(rape, makeField({ p_idx: 2, k_idx: 2 }), 4);
    expect(r.p2o5).toBe(0);
    expect(r.k2o).toBe(0);
  });
});

// ---------------------------------------------------------------------
// Clubroot 5-year-break
// ---------------------------------------------------------------------

describe('brassicaClubrootWarning', () => {
  const rape = profile('forage_rape');
  const wheat = profile('cereal_wheat');
  it('warns when a brassica was grown within 4 seasons', () => {
    expect(brassicaClubrootWarning(rape, 2026, [2023])).toBeTruthy(); // Δ3
    expect(brassicaClubrootWarning(rape, 2026, [2022])).toBeTruthy(); // Δ4
  });
  it('clear at a 5-year gap or more', () => {
    expect(brassicaClubrootWarning(rape, 2026, [2021])).toBeNull();   // Δ5
    expect(brassicaClubrootWarning(rape, 2026, [2018, 2020])).toBeNull();
  });
  it('non-brassica crops never warn', () => {
    expect(brassicaClubrootWarning(wheat, 2026, [2024, 2025])).toBeNull();
  });
});

// ---------------------------------------------------------------------
// buildCropPlan — end to end, incl. organic crediting
// ---------------------------------------------------------------------

describe('buildCropPlan', () => {
  it('wheat at Index 2, nothing applied: needs come straight from the engine', () => {
    const plan = buildCropPlan(
      makeField({ p_idx: 2, k_idx: 2 }),
      makeAlloc({ crop_key: 'cereal_wheat' }),
      profile('cereal_wheat'),
      [], [], settings(),
    );
    expect(plan.nTarget).toBe(185);
    expect(plan.p2o5Target).toBe(78);
    expect(plan.k2oTarget).toBe(56);
    expect(plan.nToApply).toBe(185);
    expect(plan.p2o5ToApply).toBe(78);
    expect(plan.k2oToApply).toBe(56);
    expect(plan.nIsCeiling).toBe(false);
  });

  it('logged slurry on the crop field nets against the need (P/K via release curve, N availability-adjusted)', () => {
    // 2,500 gal/ac slurry on 1 Apr (2 months before today ⇒ slurry release 1.0).
    // m³/ha = 2500 × 0.01124 ≈ 28.1 ⇒ K content 28.1×4 = 112.4; P 28.1.
    const app = makeApp({ product_id: slurry.id, date_applied: '2026-04-01', rate_value: 2500, rate_unit: 'gal/ac', method: 'splash_plate' });
    const plan = buildCropPlan(
      makeField({ p_idx: 0, k_idx: 0 }),
      makeAlloc({ crop_key: 'forage_rape' }),
      profile('forage_rape'),
      [app], [slurry], settings(),
    );
    // Rape @ Index 0: P target 12, K target 120.
    expect(plan.appliedK).toBe(112);
    expect(plan.k2oToApply).toBe(8);          // 120 − 112.4 → 8
    expect(plan.p2o5ToApply).toBe(0);         // 12 − 28.1 → clamped
    expect(plan.nToApply).toBeLessThan(75);   // slurry N credited against the 75 ceiling
    expect(plan.nToApply).toBeGreaterThan(0);
  });

  it('uses expected yield from the allocation when set', () => {
    const plan = buildCropPlan(
      makeField({ p_idx: 2, k_idx: 2 }),
      makeAlloc({ crop_key: 'cereal_wheat', expected_yield: 12 }),
      profile('cereal_wheat'),
      [], [], settings(),
    );
    expect(plan.yieldT).toBe(12);
    expect(plan.p2o5Target).toBe(Math.round(7.8 * 12)); // 94
  });

  it('surfaces the sodium note + K-lift advisory for fodder beet', () => {
    const plan = buildCropPlan(
      makeField({ p_idx: 2, k_idx: 2 }),
      makeAlloc({ crop_key: 'fodder_beet' }),
      profile('fodder_beet'),
      [], [], settings(),
    );
    expect(plan.na).toBeTruthy();
    expect(plan.kLiftTopUpNote).toBeTruthy();
    expect(plan.k2oTarget).toBeGreaterThan(300); // high-K root crop
  });

  it('flags an unsampled field and falls back to target Index 2', () => {
    const plan = buildCropPlan(
      makeField({ sampled: false, p_idx: null, k_idx: null, ph: null }),
      makeAlloc({ crop_key: 'cereal_wheat' }),
      profile('cereal_wheat'),
      [], [], settings(),
    );
    expect(plan.notes.some((n) => n.toLowerCase().includes('soil index'))).toBe(true);
    expect(plan.p2o5Target).toBe(78); // index-2 offtake replacement
  });

  it('fires the clubroot note when prior brassica seasons are passed in', () => {
    const plan = buildCropPlan(
      makeField({ p_idx: 1, k_idx: 1 }),
      makeAlloc({ crop_key: 'stubble_turnips' }),
      profile('stubble_turnips'),
      [], [], settings(),
      { priorBrassicaSeasons: [2024] },
    );
    expect(plan.clubrootWarning).toBeTruthy();
    expect(plan.notes.some((n) => n.toLowerCase().includes('clubroot'))).toBe(true);
  });
});
