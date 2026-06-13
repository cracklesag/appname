// Characterisation tests for the RB209 maths engine (lib/rules.ts).
//
// WHAT THESE ARE: the engine carried ~2,000 lines of nutrient maths with zero
// tests — the numbers customers spend money on were verified only by eyeball.
// These tests lock the CURRENT behaviour to the RB209 tables and constants
// the code itself declares, so any future refactor that silently changes a
// recommendation fails loudly here. Expected values are hand-derived from
// the published tables in lib/rb209.ts and the documented constants — not
// from running the code and pasting its output.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getSeasonStart, getSeasonLabel, ukTodayIso, monthsBetween,
  organicReleaseFraction, dairySlurryNAvailability, nAvailability,
  effectiveProductOn, calcNutrients, getOfftakeForCut, sumNutrients,
  getFieldNRecommendation, getFieldPKRecommendation, planFieldFertiliser,
  nutrientPerArea, displayBagAmount, getSplitTarget, displayNutrient, nutrientLabel,
} from '@/lib/rules';
import * as rb209 from '@/lib/rb209';
import { DEFAULT_SETTINGS, type Field, type Product, type Application, type Cut, type Settings } from '@/lib/types';

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

let productId = 1;
function makeProduct(over: Partial<Product>): Product {
  return {
    id: productId++,
    user_id: null,
    name: over.name ?? 'Test product',
    type: 'bag_fert',
    category: null,
    sort_order: 0,
    dm_pct: null,
    form: null,
    density_kg_per_l: null,
    n_pct: null, p2o5_pct: null, k2o_pct: null, s_pct: null,
    n_kg_per_m3: null, p2o5_kg_per_m3: null, k2o_kg_per_m3: null, so3_kg_per_m3: null, mgo_kg_per_m3: null,
    n_kg_per_t: null, p2o5_kg_per_t: null, k2o_kg_per_t: null, so3_kg_per_t: null, mgo_kg_per_t: null,
    ...over,
  };
}

function makeField(over: Partial<Field>): Field {
  return {
    id: over.id ?? 'field-1',
    user_id: 'user-1',
    group_id: null,
    name: 'Test Field',
    acres: 10,
    ha: 4.05,
    cut_profile: 3,
    planned_cuts: ['silage', 'silage', 'silage'],
    ph: 6.2, p_idx: 2, k_idx: 2, mg_idx: null,
    boundary: null, centroid_lat: null, centroid_lng: null,
    area_ha_mapped: null, boundary_source: null,
    rpa_sheet_id: null, rpa_parcel_id: null, boundary_updated_at: null,
    sampled: true, sample_date: '2025-11-01',
    soil_type: 'medium_loam',
    grass_system_id: null,
    last_ploughed: null, last_reseeded: null,
    notes: null, needs_setup: false,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function settings(): Settings {
  return structuredClone(DEFAULT_SETTINGS);
}

// ---------------------------------------------------------------------
// Seasons, dates, UK timezone
// ---------------------------------------------------------------------

describe('season + date helpers', () => {
  afterEach(() => vi.useRealTimers());

  it('season starts 1 Oct of the crop year', () => {
    expect(getSeasonStart(new Date(2026, 5, 12))).toBe('2025-10-01');  // June → prior Oct
    expect(getSeasonStart(new Date(2026, 9, 1))).toBe('2026-10-01');   // 1 Oct flips
    expect(getSeasonStart(new Date(2026, 8, 30))).toBe('2025-10-01');  // 30 Sep doesn't
  });

  it('season label is the crop year', () => {
    expect(getSeasonLabel(new Date(2026, 5, 12))).toBe('2026 season');
    expect(getSeasonLabel(new Date(2026, 9, 1))).toBe('2027 season');
  });

  it('ukTodayIso reports the UK date, not server UTC', () => {
    vi.useFakeTimers();
    // 23:30 UTC on 30 June = 00:30 BST on 1 July in the UK.
    vi.setSystemTime(new Date('2026-06-30T23:30:00Z'));
    expect(ukTodayIso()).toBe('2026-07-01');
  });

  it('no-arg getSeasonStart uses the UK date at the Oct boundary', () => {
    vi.useFakeTimers();
    // 23:30 UTC on 30 Sep = 00:30 BST on 1 Oct — the new season in the UK.
    vi.setSystemTime(new Date('2026-09-30T23:30:00Z'));
    expect(getSeasonStart()).toBe('2026-10-01');
  });

  it('monthsBetween counts whole calendar months, floored at 0', () => {
    expect(monthsBetween('2026-01-31', '2026-02-01')).toBe(1); // day ignored
    expect(monthsBetween('2026-01-15', '2026-03-14')).toBe(2);
    expect(monthsBetween('2026-03-01', '2026-01-01')).toBe(0); // reversed clamps
    expect(monthsBetween('garbage', '2026-01-01')).toBe(0);
  });
});

// ---------------------------------------------------------------------
// Organic release model
// ---------------------------------------------------------------------

describe('organicReleaseFraction', () => {
  it('slurry: 70% at month 0, +15%/month, capped at 100%', () => {
    expect(organicReleaseFraction('slurry', 0)).toBeCloseTo(0.70, 10);
    expect(organicReleaseFraction('slurry', 1)).toBeCloseTo(0.85, 10);
    expect(organicReleaseFraction('slurry', 2)).toBe(1);
    expect(organicReleaseFraction('slurry', 9)).toBe(1);
  });

  it('FYM: 35% at month 0, +10%/month, capped at 95%', () => {
    expect(organicReleaseFraction('solid_manure', 0)).toBeCloseTo(0.35, 10);
    expect(organicReleaseFraction('solid_manure', 3)).toBeCloseTo(0.65, 10);
    expect(organicReleaseFraction('solid_manure', 6)).toBeCloseTo(0.95, 10);
    expect(organicReleaseFraction('solid_manure', 12)).toBeCloseTo(0.95, 10);
  });

  it('bag fert and lime are always fully available', () => {
    expect(organicReleaseFraction('bag_fert', 0)).toBe(1);
    expect(organicReleaseFraction('lime', 7)).toBe(1);
  });

  it('honours the farm settings release parameters', () => {
    const p = {
      releaseSlurryStartPct: 50, releaseSlurryPerMonthPct: 10,
      releaseFymStartPct: 35, releaseFymPerMonthPct: 10, releaseFymCapPct: 95,
    };
    expect(organicReleaseFraction('slurry', 2, p)).toBeCloseTo(0.70, 10);
  });

  it('negative months clamp to month 0', () => {
    expect(organicReleaseFraction('slurry', -3)).toBeCloseTo(0.70, 10);
  });
});

// ---------------------------------------------------------------------
// N availability — dairy slurry table + category table
// ---------------------------------------------------------------------

describe('dairySlurryNAvailability', () => {
  it('Sep–Dec is banked (0)', () => {
    expect(dairySlurryNAvailability('2026-09-15', 'splash_plate')).toBe(0);
    expect(dairySlurryNAvailability('2026-12-25', 'trail_shoe')).toBe(0);
  });
  it('Jan/Feb/Mar use the winter method table', () => {
    expect(dairySlurryNAvailability('2026-01-10', 'splash_plate')).toBe(0.20);
    expect(dairySlurryNAvailability('2026-02-10', 'dribble_bar')).toBe(0.32);
    expect(dairySlurryNAvailability('2026-03-10', 'trail_shoe')).toBe(0.45);
  });
  it('Apr–Aug uses the summer values; null method defaults to splash plate', () => {
    expect(dairySlurryNAvailability('2026-04-10', 'splash_plate')).toBe(0.50);
    expect(dairySlurryNAvailability('2026-06-10', 'trail_shoe')).toBe(0.58);
    expect(dairySlurryNAvailability('2026-05-10', null)).toBe(0.50);
  });
});

describe('nAvailability — category table', () => {
  const pig = makeProduct({ type: 'slurry', category: 'pig_slurry' });
  const digestate = makeProduct({ type: 'slurry', category: 'digestate' });
  const fym = makeProduct({ type: 'solid_manure', category: 'fym' });
  const dairy = makeProduct({ type: 'slurry', category: 'dairy_slurry' });

  it('pig slurry follows winter/spring/summer/autumn values', () => {
    expect(nAvailability(pig, '2026-01-15', 'splash_plate')).toBe(0.35); // winter
    expect(nAvailability(pig, '2026-04-15', 'splash_plate')).toBe(0.50); // spring
    expect(nAvailability(pig, '2026-07-15', 'splash_plate')).toBe(0.50); // summer
    expect(nAvailability(pig, '2026-10-15', 'splash_plate')).toBe(0);    // autumn banked
  });

  it('digestate March counts as spring', () => {
    expect(nAvailability(digestate, '2026-03-15', null)).toBe(0.55);
    expect(nAvailability(digestate, '2026-01-15', null)).toBe(0.40);
  });

  it('soil incorporation bumps solid manure 1.5×, but never in autumn', () => {
    expect(nAvailability(fym, '2026-04-15', 'surface')).toBe(0.10);
    expect(nAvailability(fym, '2026-04-15', 'soil_incorporated')).toBeCloseTo(0.15, 10);
    expect(nAvailability(fym, '2026-10-15', 'soil_incorporated')).toBe(0); // 0 base → no bump
  });

  it('dairy_slurry routes to the full method table', () => {
    expect(nAvailability(dairy, '2026-06-15', 'trail_shoe')).toBe(0.58);
  });

  it('unknown category returns 0', () => {
    expect(nAvailability(makeProduct({ type: 'slurry', category: null }), '2026-04-15', null)).toBe(0);
  });
});

// ---------------------------------------------------------------------
// Dated product analyses
// ---------------------------------------------------------------------

describe('effectiveProductOn', () => {
  const base = makeProduct({ type: 'bag_fert', form: 'granular', n_pct: 27 });
  const withHistory: Product = {
    ...base,
    analyses: [
      { id: 'a2', product_id: base.id, effective_from: '2026-03-01', dm_pct: null, form: 'granular', density_kg_per_l: null, n_pct: 27, p2o5_pct: null, k2o_pct: null, s_pct: null, n_kg_per_m3: null, p2o5_kg_per_m3: null, k2o_kg_per_m3: null, so3_kg_per_m3: null, mgo_kg_per_m3: null, n_kg_per_t: null, p2o5_kg_per_t: null, k2o_kg_per_t: null, so3_kg_per_t: null, mgo_kg_per_t: null },
      { id: 'a1', product_id: base.id, effective_from: '2026-01-01', dm_pct: null, form: 'granular', density_kg_per_l: null, n_pct: 20, p2o5_pct: null, k2o_pct: null, s_pct: null, n_kg_per_m3: null, p2o5_kg_per_m3: null, k2o_kg_per_m3: null, so3_kg_per_m3: null, mgo_kg_per_m3: null, n_kg_per_t: null, p2o5_kg_per_t: null, k2o_kg_per_t: null, so3_kg_per_t: null, mgo_kg_per_t: null },
    ],
  };

  it('picks the version in force on the application date', () => {
    expect(effectiveProductOn(withHistory, '2026-02-15').n_pct).toBe(20);
    expect(effectiveProductOn(withHistory, '2026-03-01').n_pct).toBe(27);
  });
  it('dates before all versions use the earliest; no history is a no-op', () => {
    expect(effectiveProductOn(withHistory, '2025-12-01').n_pct).toBe(20);
    expect(effectiveProductOn(base, '2026-02-15').n_pct).toBe(27);
  });
});

// ---------------------------------------------------------------------
// calcNutrients — the per-application NPK valuation
// ---------------------------------------------------------------------

describe('calcNutrients', () => {
  it('lime is a pH amendment only', () => {
    const lime = makeProduct({ type: 'lime' });
    const r = calcNutrients(lime, 2, 't/ac', '2026-04-01', null);
    expect(r).toMatchObject({ nPerHa: 0, p2o5PerHa: 0, k2oPerHa: 0, nNote: 'pH amendment' });
  });

  it('granular bag fert: kg/ha × declared %', () => {
    const npk = makeProduct({ type: 'bag_fert', form: 'granular', n_pct: 25, p2o5_pct: 5, k2o_pct: 5, s_pct: 8 });
    const r = calcNutrients(npk, 200, 'kg/ha', '2026-04-01', null);
    expect(r.nPerHa).toBe(50);
    expect(r.p2o5PerHa).toBe(10);
    expect(r.k2oPerHa).toBe(10);
    expect(r.so3PerHa).toBe(16);
  });

  it('kg/ac and lb/ac convert with the documented factors', () => {
    const can = makeProduct({ type: 'bag_fert', form: 'granular', n_pct: 27 });
    expect(calcNutrients(can, 100, 'kg/ac', '2026-04-01', null).nPerHa).toBeCloseTo(100 * 2.4711 * 0.27, 6);
    const twenty = makeProduct({ type: 'bag_fert', form: 'granular', n_pct: 20 });
    expect(calcNutrients(twenty, 100, 'lb/ac', '2026-04-01', null).nPerHa).toBeCloseTo(100 * 1.1209 * 0.20, 6);
  });

  it('liquid bag fert: litres × density × %', () => {
    const liquid = makeProduct({ type: 'bag_fert', form: 'liquid', density_kg_per_l: 1.28, n_pct: 30 });
    expect(calcNutrients(liquid, 100, 'l/ha', '2026-04-01', null).nPerHa).toBeCloseTo(38.4, 6);
    expect(calcNutrients(liquid, 100, 'l/ac', '2026-04-01', null).nPerHa).toBeCloseTo(100 * 2.4711 * 1.28 * 0.30, 6);
  });

  it('solid manure: t/ha × kg/t, N scaled by seasonal availability, P/K full', () => {
    const fym = makeProduct({ type: 'solid_manure', category: 'fym', n_kg_per_t: 6, p2o5_kg_per_t: 3.2, k2o_kg_per_t: 8, mgo_kg_per_t: 1 });
    const r = calcNutrients(fym, 30, 't/ha', '2026-04-10', 'surface');
    expect(r.nPerHa).toBeCloseTo(180 * 0.10, 6);   // April surface FYM = 10%
    expect(r.p2o5PerHa).toBeCloseTo(96, 6);
    expect(r.k2oPerHa).toBeCloseTo(240, 6);
    expect(r.mgoPerHa).toBeCloseTo(30, 6);
    expect(r.availFactor).toBe(0.10);
    expect(r.nNote).toContain('Apr');
  });

  it('t/ac converts via 0.4047', () => {
    const muck = makeProduct({ type: 'solid_manure', category: 'fym', p2o5_kg_per_t: 2 });
    expect(calcNutrients(muck, 10, 't/ac', '2026-04-10', 'surface').p2o5PerHa).toBeCloseTo((10 / 0.4047) * 2, 6);
  });

  it('slurry: gal/ac → m³/ha via 0.01124, N by method/season, P&K full', () => {
    const slurry = makeProduct({ type: 'slurry', category: 'dairy_slurry', n_kg_per_m3: 2, p2o5_kg_per_m3: 1, k2o_kg_per_m3: 4 });
    const r = calcNutrients(slurry, 2500, 'gal/ac', '2026-06-01', 'splash_plate');
    const m3PerHa = 2500 * 0.01124; // 28.1
    expect(r.nPerHa).toBeCloseTo(m3PerHa * 2 * 0.50, 6);
    expect(r.p2o5PerHa).toBeCloseTo(m3PerHa * 1, 6);
    expect(r.k2oPerHa).toBeCloseTo(m3PerHa * 4, 6);
    expect(r.availFactor).toBe(0.50);
  });

  it('m³/ha round-trips through gal/ac with the known +0.036% wobble', () => {
    // 89.0 gal/ac per m³/ha × 0.01124 = 1.00036 — a logged 30 m³/ha is valued
    // as 30.0108 m³/ha. Documented here so nobody "fixes" one constant and
    // silently shifts every slurry figure.
    const slurry = makeProduct({ type: 'slurry', category: 'dairy_slurry', k2o_kg_per_m3: 4 });
    const r = calcNutrients(slurry, 30, 'm3/ha', '2026-06-01', 'splash_plate');
    expect(r.k2oPerHa).toBeCloseTo(30 * 89.0 * 0.01124 * 4, 6); // 120.0432
  });

  it('missing product or zero rate yields zeros', () => {
    expect(calcNutrients(undefined, 100, 'kg/ha', '2026-04-01', null).nPerHa).toBe(0);
    const p = makeProduct({ type: 'bag_fert', n_pct: 27 });
    expect(calcNutrients(p, 0, 'kg/ha', '2026-04-01', null).nPerHa).toBe(0);
  });
});

// ---------------------------------------------------------------------
// Cut offtake
// ---------------------------------------------------------------------

describe('getOfftakeForCut', () => {
  it('silage: base yield × multipliers × 23/8/28 per t DM, full retention', () => {
    const r = getOfftakeForCut(3, 1, 'average', settings(), 'silage');
    expect(r.baseYieldDM).toBe(3.5);
    expect(r.yieldDM).toBe(3.5);
    expect(r.n).toBeCloseTo(3.5 * 23, 6);
    expect(r.p2o5).toBeCloseTo(3.5 * 8, 6);
    expect(r.k2o).toBeCloseTo(3.5 * 28, 6);
  });

  it('grazing returns 70% to the sward — only 30% leaves the field', () => {
    const r = getOfftakeForCut(3, 1, 'average', settings(), 'grazing');
    expect(r.k2o).toBeCloseTo(3.5 * 28 * 0.30, 6);
  });

  it('bales and yield class scale the DM yield', () => {
    expect(getOfftakeForCut(3, 1, 'average', settings(), 'bales').yieldDM).toBeCloseTo(3.5 * 0.7, 6);
    expect(getOfftakeForCut(3, 1, 'heavy', settings(), 'silage').p2o5).toBeCloseTo(3.5 * 1.3 * 8, 6);
  });

  it('unknown cut profile yields zero', () => {
    expect(getOfftakeForCut(7, 1, 'average', settings(), 'silage').yieldDM).toBe(0);
  });
});

// ---------------------------------------------------------------------
// RB209 band conversion + recommendations
// ---------------------------------------------------------------------

describe('decimal index → recommendation band', () => {
  it('P bands round, clamped 0–4; null defaults to target index 2', () => {
    expect(rb209.pBandFromDecimal(null)).toBe(2);
    expect(rb209.pBandFromDecimal(-1)).toBe(0);
    expect(rb209.pBandFromDecimal(0.4)).toBe(0);
    expect(rb209.pBandFromDecimal(2.4)).toBe(2);
    expect(rb209.pBandFromDecimal(2.5)).toBe(3);
    expect(rb209.pBandFromDecimal(6)).toBe(4);
  });
  it('K bands split index 2 into 2-/2+; null defaults to 2-', () => {
    expect(rb209.kBandFromDecimal(null)).toBe('2-');
    expect(rb209.kBandFromDecimal(0.49)).toBe(0);
    expect(rb209.kBandFromDecimal(0.5)).toBe(1);
    expect(rb209.kBandFromDecimal(1.5)).toBe('2-');
    expect(rb209.kBandFromDecimal(2.49)).toBe('2-');
    expect(rb209.kBandFromDecimal(2.5)).toBe('2+');
    expect(rb209.kBandFromDecimal(2.99)).toBe('2+');
    expect(rb209.kBandFromDecimal(3.0)).toBe(3);
    expect(rb209.kBandFromDecimal(3.5)).toBe(4);
  });
});

describe('RB209 silage / grazing P&K recommendations', () => {
  it('second cut at P1, K1 reads straight off Table 3.3', () => {
    const r = rb209.silageRecommendation(2, 1, 1);
    expect(r.p2o5).toBe(25);
    expect(r.k2o).toBe(100);
    expect(r.atMaintenance).toBe(false);
  });

  it('first cut at K0: 80 spring (capped) + 60 previous autumn = 140 total', () => {
    const r = rb209.silageRecommendation(1, 0, 0);
    expect(r.p2o5).toBe(100);
    expect(r.k2o).toBe(140);
    expect(r.kSplit).toEqual({ previousAutumn: 60, spring: 80, springCapped: false });
  });

  it('first cut at K2+ is spring-only 60', () => {
    expect(rb209.silageRecommendation(1, 2, '2+').k2o).toBe(60);
  });

  it('high indices recommend nothing', () => {
    expect(rb209.silageRecommendation(3, 3, 4).p2o5).toBe(0);
    expect(rb209.silageRecommendation(3, 3, 4).k2o).toBe(0);
  });

  it('grazing table (3.4)', () => {
    expect(rb209.grazingRecommendation(0, 1)).toMatchObject({ p2o5: 80, k2o: 30 });
    expect(rb209.grazingRecommendation(2, '2-').atMaintenance).toBe(true);
  });

  it('catch-up K after cutting: by cut count, only at K ≤ 2+', () => {
    expect(rb209.extraKAfterCutting(1, 0)).toBe(60);
    expect(rb209.extraKAfterCutting(2, '2+')).toBe(60);
    expect(rb209.extraKAfterCutting(3, 1)).toBe(30);
    expect(rb209.extraKAfterCutting(4, 0)).toBe(0);
    expect(rb209.extraKAfterCutting(3, 3)).toBe(0);
    expect(rb209.extraKAfterCutting(2, null)).toBe(60); // null → target band 2-
  });
});

describe('RB209 nitrogen tables', () => {
  it('silage per-cut N with the per-cut SNS adjustment', () => {
    expect(rb209.silageNForCut(3, 1, 'moderate')).toBe(100);
    expect(rb209.silageNForCut(3, 1, 'high')).toBe(90);
    expect(rb209.silageNForCut(3, 1, 'low')).toBe(110);
    expect(rb209.silageNForCut(3, 2, 'high')).toBe(55);
    expect(rb209.silageNForCut(1, 1, 'moderate')).toBe(70);
    expect(rb209.silageNForCut(3, 4, 'moderate')).toBe(0); // beyond the system
  });
  it('grazing season totals with ±30 SNS', () => {
    expect(rb209.grazingNTotal(9, 'moderate')).toBe(130);
    expect(rb209.grazingNTotal(9, 'high')).toBe(100);
    expect(rb209.grazingNTotal(4, 'low')).toBe(60);
  });
});

// ---------------------------------------------------------------------
// Field-level recommendations (wiring of the tables)
// ---------------------------------------------------------------------

describe('getFieldNRecommendation', () => {
  it('silage uses the editable per-cut N target from settings', () => {
    const r = getFieldNRecommendation(makeField({}), 1, undefined, settings());
    expect(r.n).toBe(110); // DEFAULT_SETTINGS.nTargets[1]
    expect(r.cutType).toBe('silage');
  });

  it('falls back to RB209 Table 3.8 when no target is set', () => {
    const s = settings();
    // @ts-expect-error deliberate: simulate settings without nTargets
    delete s.nTargets;
    expect(getFieldNRecommendation(makeField({}), 1, undefined, s).n).toBe(100);
  });

  it('grass-system multiplier scales the target', () => {
    expect(getFieldNRecommendation(makeField({}), 1, undefined, settings(), 0.7).n).toBe(77);
  });

  it('grazing spreads the season total across the rounds', () => {
    const f = makeField({ planned_cuts: ['grazing', 'grazing', 'grazing'] });
    const r = getFieldNRecommendation(f, 1, undefined, settings());
    expect(r.cutType).toBe('grazing');
    expect(r.n).toBe(Math.round(130 / 3)); // profile 3 → 9 t band → 130 total
  });
});

describe('getFieldPKRecommendation', () => {
  it('first cut at P0/K0 with catch-up K for a 3-cut system', () => {
    const f = makeField({ p_idx: 0, k_idx: 0 });
    const r = getFieldPKRecommendation(f, 1);
    expect(r.p2o5).toBe(100);
    expect(r.k2o).toBe(140);
    expect(r.extraKAfterCut).toBe(30);
    expect(r.pBand).toBe(0);
    expect(r.kBand).toBe('0');
  });

  it("a logged cut's next_action of another_cut_silage keeps the silage table", () => {
    const f = makeField({ p_idx: 2, k_idx: 2 });
    const cut: Cut = {
      id: 'c1', user_id: 'user-1', created_by: null, field_id: f.id,
      cut_number: 1, cut_date: '2026-05-15', cut_type: 'silage', yield_class: 'average',
      next_action: 'another_cut_silage', notes: null, created_at: '2026-05-15T10:00:00Z',
    };
    const r = getFieldPKRecommendation(f, 2, [cut]);
    expect(r.cutType).toBe('silage');
    expect(r.p2o5).toBe(25); // cut 2, P index 2
  });
});

// ---------------------------------------------------------------------
// sumNutrients + display conversions + N split
// ---------------------------------------------------------------------

describe('sumNutrients', () => {
  it('sums calcNutrients across applications', () => {
    const p = makeProduct({ type: 'bag_fert', form: 'granular', n_pct: 20 });
    const app = (rate: number): Application => ({
      id: `a${rate}`, user_id: 'u', created_by: null, field_id: 'f', product_id: p.id,
      date_applied: '2026-04-01', rate_value: rate, rate_unit: 'kg/ha', method: null,
      notes: null, applied_by: 'me', created_at: '', coverage: 'whole', reconciled_at: null, drawn_ha: null,
    });
    expect(sumNutrients([app(100), app(200)], [p]).n).toBeCloseTo(60, 6);
  });
});

describe('display conversions', () => {
  it('kg/ha → kg/ac divides by 2.4711', () => {
    expect(nutrientPerArea(100, 'acres')).toBeCloseTo(100 / 2.4711, 6);
    expect(nutrientPerArea(100, 'hectares')).toBe(100);
  });
  it('units/ac uses 1.12 lb × lb/ac factor', () => {
    expect(displayBagAmount(100, 'units/ac').value).toBeCloseTo(100 / (1.12 * 1.1209), 6);
  });
});

describe('getSplitTarget', () => {
  it('front-loads N only; P and K stay full on every dressing', () => {
    const full = { n: 100, p2o5: 40, k2o: 80 };
    expect(getSplitTarget(full, 1, 2, 60)).toEqual({ n: 60, p2o5: 40, k2o: 80 });
    expect(getSplitTarget(full, 2, 3, 60).n).toBeCloseTo(20, 6);
    expect(getSplitTarget(full, 1, 1, 60)).toEqual(full);
  });
});

// ---------------------------------------------------------------------
// Fertiliser planner — shortfall → products + rates
// ---------------------------------------------------------------------

describe('planFieldFertiliser', () => {
  const npk0_10_10 = makeProduct({ name: '0-10-10', type: 'bag_fert', form: 'granular', n_pct: 0, p2o5_pct: 10, k2o_pct: 10 });
  const npk25_5_5 = makeProduct({ name: '25-5-5', type: 'bag_fert', form: 'granular', n_pct: 25, p2o5_pct: 5, k2o_pct: 5 });
  const tsp = makeProduct({ name: 'TSP', type: 'bag_fert', form: 'granular', n_pct: 0, p2o5_pct: 46 });
  const mop = makeProduct({ name: 'MOP', type: 'bag_fert', form: 'granular', n_pct: 0, k2o_pct: 60 });
  const can = makeProduct({ name: 'CAN', type: 'bag_fert', form: 'granular', n_pct: 27 });

  it('returns null when nothing is needed', () => {
    expect(planFieldFertiliser(0, 0, [npk0_10_10], 0)).toBeNull();
  });

  it('one compound pass when the P:K ratio matches', () => {
    const plan = planFieldFertiliser(40, 40, [npk0_10_10, tsp, mop], 0)!;
    expect(plan.products).toHaveLength(1);
    expect(plan.products[0]).toMatchObject({ productName: '0-10-10', rateKgPerHa: 400, deliversP2O5: 40, deliversK2O: 40 });
    expect(plan.p2o5Balance).toBe(0);
    expect(plan.k2oBalance).toBe(0);
    expect(plan.note).toContain('one pass');
  });

  it('N ceiling: an N-rich compound cannot be auto-rated past the N need', () => {
    // Needs P and K but ZERO N; the only product carries 25% N. Auto-sizing
    // must deliver nothing rather than blow the N budget — the shortfall
    // surfaces in the balances instead.
    const plan = planFieldFertiliser(10, 10, [npk25_5_5], 0)!;
    expect(plan.products).toHaveLength(0);
    expect(plan.p2o5Balance).toBe(-10);
    expect(plan.k2oBalance).toBe(-10);
  });

  it('straight P + K sources when no compound fits, preferring N-free', () => {
    const plan = planFieldFertiliser(30, 60, [npk25_5_5, tsp, mop], 0)!;
    const names = plan.products.map((p) => p.productName);
    expect(names).toEqual(['TSP', 'MOP']);
    expect(plan.products[0].deliversP2O5).toBe(30);
    expect(plan.products[1].deliversK2O).toBe(60);
    expect(plan.p2o5Balance).toBe(0);
    expect(plan.k2oBalance).toBe(0);
  });

  it('tops up remaining N with the straightest N source', () => {
    const plan = planFieldFertiliser(0, 0, [npk25_5_5, can], 50)!;
    expect(plan.products).toHaveLength(1);
    expect(plan.products[0].productName).toBe('CAN');
    expect(plan.products[0].deliversN).toBe(50);
    expect(plan.nBalance).toBeCloseTo(0, 10); // Math.round(-ε) is -0
  });
});

// ---------------------------------------------------------------------
// Nutrient display unit (units/ac etc.) — the fertiliser-unit setting
// ---------------------------------------------------------------------

describe('displayNutrient — fertiliser unit display', () => {
  it('kg/ha is identity', () => {
    expect(displayNutrient(110, 'kg/ha')).toEqual({ value: 110, unit: 'kg/ha' });
  });

  it('units/ac uses the UK bag-label convention (1 unit = 1.12 lb/ac of nutrient)', () => {
    // 1 cwt/ac of CAN at 27% N = 33.9 kg/ha N = 27.0 units/ac. So 33.9 kg/ha
    // must read 27 units/ac. (1 unit = 1.12 × 1.1209 = 1.2554 kg/ha.)
    const r = displayNutrient(33.9, 'units/ac');
    expect(r.unit).toBe('units/ac');
    expect(r.value).toBeCloseTo(27.0, 1);
  });

  it('units/ac applies identically to P2O5 and K2O (same convention)', () => {
    // 40 kg/ha P2O5 → 40 / 1.2554 = 31.9 units/ac.
    expect(displayNutrient(40, 'units/ac').value).toBeCloseTo(31.86, 1);
  });

  it('kg/ac and lb/ac convert by their area factors', () => {
    expect(displayNutrient(50, 'kg/ac').value).toBeCloseTo(50 / 2.4711, 4);
    expect(displayNutrient(50, 'lb/ac').value).toBeCloseTo(50 / 1.1209, 4);
  });

  it('nutrientLabel returns the matching unit string', () => {
    expect(nutrientLabel('units/ac')).toBe('units/ac');
    expect(nutrientLabel('kg/ha')).toBe('kg/ha');
    expect(nutrientLabel('kg/ac')).toBe('kg/ac');
    expect(nutrientLabel('lb/ac')).toBe('lb/ac');
  });

  it('CONSISTENCY: a bag target and a slurry contribution on the same bar carry the same unit', () => {
    // This is the bug the rewire fixes: the bar target and the slurry supply
    // feeding it must never be in different units. Both route through the same
    // helper, so for any fertiliser-unit setting their labels match.
    for (const u of ['kg/ha', 'kg/ac', 'lb/ac', 'units/ac'] as const) {
      const bagTarget = displayNutrient(110, u);     // RB209 N target
      const slurrySupply = displayNutrient(28, u);   // N from logged slurry
      expect(bagTarget.unit).toBe(slurrySupply.unit);
      expect(slurrySupply.unit).toBe(nutrientLabel(u));
    }
  });

  it('the fill ratio is unit-invariant (proportions never change)', () => {
    // Switching display unit must not move a bar: applied/target is preserved.
    const kgHaRatio = displayNutrient(84, 'kg/ha').value / displayNutrient(110, 'kg/ha').value;
    const unitsRatio = displayNutrient(84, 'units/ac').value / displayNutrient(110, 'units/ac').value;
    expect(unitsRatio).toBeCloseTo(kgHaRatio, 10);
  });
});
