import {
  Application, Cut, CutType, Field, GrassSystem, NextAction, Product, ProductCategory, ProductType, Settings,
  SlurryMethod, SolidMethod, ApplicationMethod, SoilType, YieldClass, RateUnit, DEFAULT_SETTINGS,
} from './types';
import * as rb209 from './rb209';

// ---- Constants ----------------------------------------------------

export const YIELDS_BY_CUT_PROFILE: Record<number, number[]> = {
  1: [5.0],
  2: [3.7, 3.3],
  3: [3.5, 3.0, 2.5],
  4: [3.0, 2.8, 2.5, 2.0],
};

export const OFFTAKE_PER_T_DM = { n: 23, p2o5: 8, k2o: 28 };

export const CUT_TYPE_LABELS: Record<CutType, string> = {
  silage: 'Silage', bales: 'Bales', grazing: 'Grazing',
};

/**
 * The "next cut type" for a field is what the field is heading toward right
 * now: derived from how many cuts have already been logged this season and
 * what was planned for that slot. Fields with all cuts taken are 'complete';
 * fields with no plan in that slot default to 'silage' to match how new
 * fields are seeded.
 *
 * Used by the home dashboard and activity filters so users can group fields
 * by "what's next" without storing a separate allocation column.
 */
/**
 * What the field is heading for next, for display purposes.
 *
 *   silage / bales / grazing — standard cut types
 *   maintenance              — most recent cut said "maintenance_grazing"
 *                              (one fert top-up then leave)
 *   complete                 — all planned cuts taken AND no maintenance /
 *                              grazing follow-up flagged
 *
 * Drives the home dashboard's filter chips, field detail subtitle,
 * spreading-report card subtitles, snapshot rows, etc.
 */
export type NextCutType = CutType | 'maintenance' | 'complete';

/**
 * Cut-profile-position view: ignores next_action; returns the next
 * planned cut type from the planned_cuts array, or 'complete' when the
 * field has used all its planned cuts. Useful only for the few callers
 * that need to know "what was originally planned" rather than "what the
 * user wants next." For display and filtering, prefer
 * getResolvedNextCutType which honours the per-cut next_action overrides.
 */
export function getNextCutType(field: Field, cutsDoneThisSeason: number): NextCutType {
  if (cutsDoneThisSeason >= field.cut_profile) return 'complete';
  return field.planned_cuts[cutsDoneThisSeason] ?? 'silage';
}

/**
 * Resolved next-cut type with next_action overrides applied.
 *
 * Reads the field's most recent cut (if any) and lets its next_action
 * trump the static planned_cuts array. Mapping:
 *   - another_cut_silage    → 'silage'
 *   - another_cut_bales     → 'bales'
 *   - rotational_grazing    → 'grazing'
 *   - maintenance_grazing   → 'maintenance'
 *   - null next_action      → fallback to planned_cuts (pre-feature data)
 *
 * If cuts done >= cut_profile AND the most-recent cut's next_action is
 * one of the "another cut" values, that's an inconsistency — we return
 * 'complete' (the profile is the cap). Maintenance + rotational grazing
 * are valid post-profile states though, so those override 'complete'.
 */
export function getResolvedNextCutType(
  field: Field,
  fieldCuts: Cut[],
): NextCutType {
  // Find the most recent cut by date, ties broken by cut_number.
  const seasonCuts = [...fieldCuts].sort((a, b) => {
    if (a.cut_date !== b.cut_date) return b.cut_date.localeCompare(a.cut_date);
    return b.cut_number - a.cut_number;
  });
  const latest = seasonCuts[0];
  const cutsDone = seasonCuts.length;

  if (latest && latest.next_action) {
    // Explicit per-cut decision wins.
    if (latest.next_action === 'rotational_grazing')  return 'grazing';
    if (latest.next_action === 'maintenance_grazing') return 'maintenance';
    if (latest.next_action === 'another_cut_silage' || latest.next_action === 'another_cut_bales') {
      // Honour the user's intent UNLESS the cut profile says we're done.
      // If they want more cuts than the profile, they need to bump the
      // profile (rare edge case, not handled here).
      if (cutsDone >= field.cut_profile) return 'complete';
      return latest.next_action === 'another_cut_silage' ? 'silage' : 'bales';
    }
  }
  // Legacy path / no override: planned_cuts driven.
  if (cutsDone >= field.cut_profile) return 'complete';
  return field.planned_cuts[cutsDone] ?? 'silage';
}

export const NEXT_CUT_LABELS: Record<NextCutType, string> = {
  silage: 'Silage',
  bales: 'Bales',
  grazing: 'Grazing',
  maintenance: 'Maintenance',
  // "Cuts done" rather than "Complete" — a grass field still has grazing
  // potential after its planned cuts are taken. Only truly inactive when
  // overwintered or non-grass crops are harvested (chunk for later).
  complete: 'Cuts done',
};

// ---- Soil sample age ----------------------------------------------
//
// The `sample_date` column is a full date, but for reporting we only
// care about the year — RB209 indices don't shift meaningfully within
// a year, and "Sampled 2022" reads better than "18 Apr 2022".

/** Year of the field's most recent soil sample, or null if never sampled. */
export function sampleYear(field: Field): number | null {
  if (!field.sample_date) return null;
  const y = parseInt(field.sample_date.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

/** Whole years elapsed since the sample. null if never sampled. */
export function sampleAgeYears(field: Field, today: Date = new Date()): number | null {
  const yr = sampleYear(field);
  if (yr == null) return null;
  return today.getFullYear() - yr;
}

/**
 * A sample is "stale" once 3+ years old. RB209 recommends 3-5 year sampling
 * cycles, and soil P/K indices shift slowly enough that within 3 years the
 * old number is usually still defensible. Past that, recommend resampling.
 */
export function isSampleStale(field: Field, today: Date = new Date()): boolean {
  const age = sampleAgeYears(field, today);
  return age != null && age >= 3;
}

export const YIELD_CLASS_LABELS: Record<YieldClass, string> = {
  light: 'Light', average: 'Average', heavy: 'Heavy',
};

export const METHOD_LABELS: Record<SlurryMethod, string> = {
  splash_plate: 'Splash plate',
  dribble_bar: 'Dribble bar',
  trail_shoe: 'Trail shoe',
};

export const SOLID_METHOD_LABELS: Record<SolidMethod, string> = {
  surface: 'Surface',
  soil_incorporated: 'Soil-incorporated (24h)',
};

/** Unified label lookup for any ApplicationMethod, returning '' for null. */
export function methodLabel(m: ApplicationMethod | null): string {
  if (!m) return '';
  if (m === 'splash_plate' || m === 'dribble_bar' || m === 'trail_shoe') return METHOD_LABELS[m];
  return SOLID_METHOD_LABELS[m];
}

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  bag_fert: 'Bag fertiliser',
  lime: 'Lime',
  dairy_slurry: 'Dairy slurry',
  pig_slurry: 'Pig slurry',
  separated_slurry: 'Separated cattle slurry',
  fym: 'Farmyard manure (FYM)',
  poultry: 'Poultry manure',
  digestate: 'Digestate',
  biosolids: 'Biosolids',
  custom: 'Custom',
};

export const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ---- Conversions --------------------------------------------------

const KG_HA_PER_KG_AC = 2.4711;
const KG_HA_PER_LB_AC = 1.1209;

// UK fertiliser unit: 1 unit = 1% of 1 cwt (112 lb) = 1.12 lb per acre
// → 1 unit/ac = 1.12 lb/ac = 1.12 × 1.1209 kg/ha = ~1.255 kg/ha
// FAS Scotland publishes 1.25 as the rounded conversion; we use the
// mathematically precise figure so all unit conversions stay consistent.
const KG_HA_PER_UNIT_AC = 1.12 * KG_HA_PER_LB_AC;  // 1.2554...

const GAL_AC_PER_M3_HA = 89.0;
const T_AC_PER_T_HA = 0.4047;

/**
 * ESTIMATED nutrient release-over-time fraction for P or K from an organic
 * application, given the material type and whole months elapsed since it was
 * applied. Returns 0–1, the fraction of that application's P/K now considered
 * crop-available.
 *
 * IMPORTANT — this is a MODEL, not an RB209 figure. RB209 treats manure P & K
 * as largely available in the year of spreading and does not publish a
 * month-by-month release curve. These curves are a sensible-shape estimate so
 * the fert plan can show how earlier muck/slurry is "creeping in" to support a
 * cut. The UI labels any figure derived from this as an estimate.
 *
 * Shapes:
 *  - Slurry / digestate (liquid): fast — ~70% month 0, ~100% by month 2.
 *  - Solid manure / FYM: slow — ~35% month 0, climbing toward ~90% by month 6,
 *    capping at ~95%. This is the "winter muck slowly coming available" case.
 *  - Bag fert: always 1 (fully available; no carryover modelling needed).
 */
export function organicReleaseFraction(
  type: 'slurry' | 'solid_manure' | 'bag_fert' | 'lime',
  monthsElapsed: number,
  params?: {
    releaseSlurryStartPct: number; releaseSlurryPerMonthPct: number;
    releaseFymStartPct: number; releaseFymPerMonthPct: number; releaseFymCapPct: number;
  },
): number {
  const m = Math.max(0, monthsElapsed);
  if (type === 'bag_fert') return 1;
  if (type === 'lime') return 1;
  const p = params ?? {
    releaseSlurryStartPct: 70, releaseSlurryPerMonthPct: 15,
    releaseFymStartPct: 35, releaseFymPerMonthPct: 10, releaseFymCapPct: 95,
  };
  if (type === 'slurry') {
    return Math.min(1, p.releaseSlurryStartPct / 100 + (p.releaseSlurryPerMonthPct / 100) * m);
  }
  // solid_manure / FYM
  return Math.min(p.releaseFymCapPct / 100, p.releaseFymStartPct / 100 + (p.releaseFymPerMonthPct / 100) * m);
}

/** Whole months between two ISO dates (a before b). Floored, min 0. */
export function monthsBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + 'T00:00:00');
  const b = new Date(bIso + 'T00:00:00');
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  return Math.max(0, months);
}

export interface SeasonPKBalance {
  /** Sum of RB209 P2O5/K2O recommendation across cuts taken + the one being
   *  built toward (kg/ha). The season requirement up to now. */
  needP: number;
  needK: number;
  /** Total P2O5/K2O supplied this season — applied (organic + granular),
   *  with pre-window organic released over time (kg/ha). */
  suppliedP: number;
  suppliedK: number;
  /** Still owed = max(0, need - supplied). What the granular plan should aim
   *  to cover (kg/ha). A skipped cut's need stays here until met. */
  owedP: number;
  owedK: number;
  /** Breakdown of supply for the source bars (kg/ha). */
  carryP: number; carryK: number;       // pre-window organic, released, net offtake
  sinceP: number; sinceK: number;        // applied since the cut window
}

/**
 * Whole-season "still owed" P & K for a field, summed across the cuts taken so
 * far plus the cut currently being built toward. P and K are season-long index
 * maintenance, not strict per-cut timing — so we track the running balance:
 * total RB209 need to date minus total supplied. A cut whose shortfall was too
 * small to spread (held back) naturally stays in `owed` until it's worth
 * applying. Over-application banks against later cuts.
 *
 * `cutNumber` is the cut being built toward (cuts done + 1, capped at profile).
 * Pre-window organic P/K is released over time via the settings release model,
 * net of crop offtake taken so far. Applications since the window count in full.
 */
export function seasonPKBalance(
  field: Field,
  cutNumber: number,
  seasonApps: Application[],
  seasonCuts: Cut[],
  products: Product[],
  settings: Settings,
  windowStartIso: string,
  todayIso: string,
): SeasonPKBalance {
  // Season P/K requirement = sum of each cut's RB209 recommendation for cuts
  // 1..cutNumber (the cuts that have happened plus the one we're feeding).
  let needP = 0, needK = 0;
  for (let c = 1; c <= cutNumber; c++) {
    const rec = getFieldPKRecommendation(field, c, seasonCuts);
    needP += rec.p2o5;
    // Catch-up K is a one-off for the season, not per cut — only add it once.
    needK += rec.k2o + (c === cutNumber ? rec.extraKAfterCut : 0);
  }

  const releaseParams = {
    releaseSlurryStartPct: settings.reportDefaults.releaseSlurryStartPct,
    releaseSlurryPerMonthPct: settings.reportDefaults.releaseSlurryPerMonthPct,
    releaseFymStartPct: settings.reportDefaults.releaseFymStartPct,
    releaseFymPerMonthPct: settings.reportDefaults.releaseFymPerMonthPct,
    releaseFymCapPct: settings.reportDefaults.releaseFymCapPct,
  };
  const typeById = new Map(products.map((p) => [p.id, p.type]));

  // Supply since the window (full value) + pre-window organic (released).
  let sinceP = 0, sinceK = 0, carryRawP = 0, carryRawK = 0;
  for (const a of seasonApps) {
    const nut = sumNutrients([a], products);
    if (a.date_applied >= windowStartIso) {
      sinceP += nut.p; sinceK += nut.k;
    } else {
      const t = (typeById.get(a.product_id) ?? 'bag_fert') as 'slurry' | 'solid_manure' | 'bag_fert' | 'lime';
      const frac = organicReleaseFraction(t, monthsBetween(a.date_applied, todayIso), releaseParams);
      carryRawP += nut.p * frac;
      carryRawK += nut.k * frac;
    }
  }

  // Net crop offtake (cuts taken this season) off the carryover.
  let pOff = 0, kOff = 0;
  for (const c of seasonCuts) {
    const o = getOfftakeForCut(field.cut_profile, c.cut_number, c.yield_class, settings, c.cut_type);
    pOff += o.p2o5; kOff += o.k2o;
  }
  const carryP = Math.max(0, carryRawP - pOff);
  const carryK = Math.max(0, carryRawK - kOff);

  const suppliedP = carryP + sinceP;
  const suppliedK = carryK + sinceK;

  return {
    needP, needK,
    suppliedP, suppliedK,
    owedP: Math.max(0, needP - suppliedP),
    owedK: Math.max(0, needK - suppliedK),
    carryP, carryK, sinceP, sinceK,
  };
}


/**
 * Convert a nutrient/areal figure stored in kg/ha to the user's chosen unit
 * SYSTEM (acres or hectares). This is the master conversion for every
 * nutrient number shown in the app — N/P/K need & supply, offtake, N caps.
 * The acres/hectares setting is authoritative: acres → kg/ac, hectares →
 * kg/ha, regardless of how the field area was originally entered.
 */
export function nutrientPerArea(kgPerHa: number, system: Settings['unitSystem']): number {
  return system === 'acres' ? kgPerHa / KG_HA_PER_KG_AC : kgPerHa;
}

/** The unit label for a nutrient figure given the user's system. */
export function nutrientUnitLabel(system: Settings['unitSystem']): string {
  return system === 'acres' ? 'kg/ac' : 'kg/ha';
}


export function displayFieldArea(field: { acres: number; ha: number }, system: Settings['unitSystem']): { value: number; unit: 'ac' | 'ha' } {
  return system === 'acres'
    ? { value: field.acres, unit: 'ac' }
    : { value: field.ha,    unit: 'ha' };
}

/**
 * Convert a value in kg/ha (our storage unit for fertiliser nutrient
 * concentration) to the user's preferred display unit, with the appropriate
 * unit label. Used by NutrientBar and any other display that shows a
 * fert-style rate.
 */
export function displayBagAmount(kgPerHa: number, unit: Settings['bagFertUnit']): { value: number; unit: string } {
  switch (unit) {
    case 'kg/ac':    return { value: kgPerHa / KG_HA_PER_KG_AC,   unit: 'kg/ac' };
    case 'lb/ac':    return { value: kgPerHa / KG_HA_PER_LB_AC,   unit: 'lb/ac' };
    case 'units/ac': return { value: kgPerHa / KG_HA_PER_UNIT_AC, unit: 'units/ac' };
    case 'kg/ha':
    default:         return { value: kgPerHa,                     unit: 'kg/ha' };
  }
}

export function displayRate(app: Application, settings: Settings, productType: ProductType): { value: number; unit: string } {
  if (productType === 'bag_fert') {
    // Liquid fert is dosed and displayed in litres — show the stored litre
    // rate directly (convert l/ac↔l/ha to the user's area preference).
    if (app.rate_unit === 'l/ha' || app.rate_unit === 'l/ac') {
      let lPerHa = app.rate_value;
      if (app.rate_unit === 'l/ac') lPerHa = app.rate_value * KG_HA_PER_KG_AC;
      if (settings.unitSystem === 'acres') {
        return { value: lPerHa / KG_HA_PER_KG_AC, unit: 'l/ac' };
      }
      return { value: lPerHa, unit: 'l/ha' };
    }
    let kgPerHa = app.rate_value;
    if (app.rate_unit === 'kg/ac')      kgPerHa = app.rate_value * KG_HA_PER_KG_AC;
    else if (app.rate_unit === 'lb/ac') kgPerHa = app.rate_value * KG_HA_PER_LB_AC;
    // For display: units/ac is allowed as a NUTRIENT display unit only, not a
    // product-rate. For showing the application rate itself, we still want to
    // show product weight — so if the user has units/ac set as their preferred
    // nutrient display unit, we still display the product rate in kg/ha here.
    // The bars (NutrientBar) handle the units/ac case for nutrient values.
    const fallback: 'kg/ha' | 'kg/ac' | 'lb/ac' =
      settings.bagFertUnit === 'units/ac' ? 'kg/ha' : settings.bagFertUnit;
    return displayBagAmount(kgPerHa, fallback);
  }
  if (productType === 'slurry') {
    let galPerAc = app.rate_value;
    if (app.rate_unit === 'm3/ha') galPerAc = app.rate_value * GAL_AC_PER_M3_HA;
    const out = settings.slurryUnit === 'm3/ha' ? galPerAc / GAL_AC_PER_M3_HA : galPerAc;
    return { value: out, unit: settings.slurryUnit };
  }
  if (productType === 'solid_manure') {
    // Solid manure is entered in t/ac or t/ha. Follow the user's area
    // preference for display; no separate setting (solid manure is rare
    // enough that adding another unit knob isn't worth it).
    let tPerHa = app.rate_value;
    if (app.rate_unit === 't/ac') tPerHa = app.rate_value / T_AC_PER_T_HA;
    if (settings.unitSystem === 'acres') {
      return { value: tPerHa * T_AC_PER_T_HA, unit: 't/ac' };
    }
    return { value: tPerHa, unit: 't/ha' };
  }
  // lime
  let tPerAc = app.rate_value;
  if (app.rate_unit === 't/ha') tPerAc = app.rate_value * T_AC_PER_T_HA;
  const out = settings.limeUnit === 't/ha' ? tPerAc / T_AC_PER_T_HA : tPerAc;
  return { value: out, unit: settings.limeUnit };
}

// Convert a UI-entered rate into the storage rate.
export function toStoredBagRate(value: number, unit: 'kg/ha' | 'kg/ac' | 'lb/ac'): { rate: number; unit: RateUnit } {
  return { rate: value, unit };
}
export function toStoredSlurryRate(value: number, unit: 'gal/ac' | 'm3/ha'): { rate: number; unit: RateUnit } {
  return { rate: value, unit };
}
export function toStoredSolidRate(value: number, unit: 't/ha' | 't/ac'): { rate: number; unit: RateUnit } {
  return { rate: value, unit };
}

// ---- N availability ---------------------------------------------------
//
// Per-category month tables, all expressed as "fraction of total N released
// to the next crop". Sourced from RB209 (2023) Tables 2.1, 2.3, 2.5, 2.9,
// 2.13, 2.15, 2.19, 2.21 — see AMENDMENTS_REFERENCE.md for the per-product
// breakdown. The existing app's slurry table preserves the splash/dribble/
// trail-shoe sub-resolution for dairy slurry only; for other categories we
// use a single "typical" value per season since RB209's data on machinery
// for those products is sparser.
//
// Soil-type variation (autumn-sandy vs autumn-heavy) is collapsed to a
// single "autumn" value pending a soil-type input on the field record —
// most UK pasture is on medium-to-heavy soil so we use the heavy figures.
// Spring is the most-applied window and gets the most resolution.

type SeasonAvail = {
  winter: number;   // Jan-Feb
  spring: number;   // Mar-May
  summer: number;   // Jun-Aug (typically grass)
  autumn: number;   // Sep-Dec — N banked unless on heavy soil
};

/**
 * Per-category default availability, surface application, total-N basis.
 * Values match the doc's recommended availability tables; spring is the
 * value most users care about. Dairy slurry's full method-resolution table
 * lives in dairySlurryNAvailability() below.
 */
const CATEGORY_AVAILABILITY: Record<string, SeasonAvail> = {
  dairy_slurry:     { winter: 0.20, spring: 0.50, summer: 0.50, autumn: 0 },
  pig_slurry:       { winter: 0.35, spring: 0.50, summer: 0.50, autumn: 0 },
  separated_slurry: { winter: 0.30, spring: 0.45, summer: 0.45, autumn: 0 },
  digestate:        { winter: 0.40, spring: 0.55, summer: 0.55, autumn: 0 },
  fym:              { winter: 0.10, spring: 0.10, summer: 0.10, autumn: 0 },
  poultry:          { winter: 0.20, spring: 0.30, summer: 0.30, autumn: 0 },
  biosolids:        { winter: 0.15, spring: 0.15, summer: 0.15, autumn: 0 },
};

/** Bump factor for soil-incorporated solid manure application (RB209 spring values). */
const SOLID_INCORPORATION_BUMP = 1.5;

/**
 * Dairy slurry retains the existing method-resolution table since this is
 * the app's most-used product and Richard has been working with these
 * exact splash/dribble/trail figures. Identical to the pre-expansion app.
 */
export function dairySlurryNAvailability(dateApplied: string, method: SlurryMethod | null): number {
  const m = new Date(dateApplied).getMonth();
  if (m >= 8) return 0; // Sep-Dec banked
  const mthd: SlurryMethod = method || 'splash_plate';
  const winter: Record<SlurryMethod, number[]> = {
    splash_plate: [0.20, 0.30, 0.38],
    dribble_bar:  [0.22, 0.32, 0.40],
    trail_shoe:   [0.25, 0.38, 0.45],
  };
  const summer: Record<SlurryMethod, number> = {
    splash_plate: 0.50,
    dribble_bar:  0.55,
    trail_shoe:   0.58,
  };
  if (m <= 2) return winter[mthd][m];
  return summer[mthd];
}

/** Backward-compat alias; older code paths call this. */
export const slurryNAvailability = dairySlurryNAvailability;

/**
 * Resolve availability for any product. Dairy slurry uses the full
 * splash/dribble/trail table; everything else uses the per-category
 * seasonal table with a method-based bump for solid-incorporated solids.
 */
export function nAvailability(
  product: Product,
  dateApplied: string,
  method: ApplicationMethod | null,
): number {
  // Dairy slurry: preserve the existing fine-grained method table.
  if (product.category === 'dairy_slurry') {
    return dairySlurryNAvailability(dateApplied, method as SlurryMethod | null);
  }
  const cat = product.category ?? '';
  const table = CATEGORY_AVAILABILITY[cat];
  if (!table) return 0;
  const m = new Date(dateApplied).getMonth();
  let base: number;
  if (m >= 8) base = table.autumn;            // Sep-Dec
  else if (m <= 1) base = table.winter;        // Jan-Feb
  else if (m <= 4) base = table.spring;        // Mar-May
  else base = table.summer;                    // Jun-Aug
  // Solid-incorporated bump for solid manures (excludes autumn — N losses
  // dominate before next-crop uptake anyway).
  if (product.type === 'solid_manure' && method === 'soil_incorporated' && base > 0) {
    return Math.min(base * SOLID_INCORPORATION_BUMP, 1);
  }
  return base;
}

// ---- Per-application NPK delivered -------------------------------

export function calcNutrients(
  product: Product | undefined,
  rateValue: number,
  rateUnit: RateUnit,
  dateApplied: string,
  method: ApplicationMethod | null
): { nPerHa: number; p2o5PerHa: number; k2oPerHa: number; so3PerHa: number; mgoPerHa: number; nNote: string; availFactor?: number } {
  if (!product || !rateValue) return { nPerHa: 0, p2o5PerHa: 0, k2oPerHa: 0, so3PerHa: 0, mgoPerHa: 0, nNote: '' };

  if (product.type === 'lime') {
    return { nPerHa: 0, p2o5PerHa: 0, k2oPerHa: 0, so3PerHa: 0, mgoPerHa: 0, nNote: 'pH amendment' };
  }

  if (product.type === 'bag_fert') {
    // Liquid bag fert: rate is in litres/ha (or L/ac → L/ha), converted to
    // kg of product via density, then to nutrient via % w/w.
    if (product.form === 'liquid') {
      let lPerHa = rateValue;
      if (rateUnit === 'l/ac') lPerHa = rateValue * KG_HA_PER_KG_AC; // L/ac → L/ha (same areal factor)
      const density = product.density_kg_per_l ?? 1.0;
      const kgProductPerHa = lPerHa * density;
      return {
        nPerHa: kgProductPerHa * (product.n_pct ?? 0) / 100,
        p2o5PerHa: kgProductPerHa * (product.p2o5_pct ?? 0) / 100,
        k2oPerHa: kgProductPerHa * (product.k2o_pct ?? 0) / 100,
        so3PerHa: kgProductPerHa * (product.s_pct ?? 0) / 100,
        mgoPerHa: 0,
        nNote: 'liquid fertiliser N',
      };
    }
    // Granular: normalise to kg/ha
    let kgPerHa = rateValue;
    if (rateUnit === 'kg/ac')      kgPerHa = rateValue * KG_HA_PER_KG_AC;
    else if (rateUnit === 'lb/ac') kgPerHa = rateValue * KG_HA_PER_LB_AC;
    // s_pct on the schema is treated as declared SO₃% (UK bag labelling
    // convention — "+S(8)" on the bag means 8% SO₃). Column name predates
    // the SO₃/S distinction; safe to rename in a later cleanup.
    // No mgo_pct column on bag fert yet — none of the seeded blends carry it.
    return {
      nPerHa: kgPerHa * (product.n_pct ?? 0) / 100,
      p2o5PerHa: kgPerHa * (product.p2o5_pct ?? 0) / 100,
      k2oPerHa: kgPerHa * (product.k2o_pct ?? 0) / 100,
      so3PerHa: kgPerHa * (product.s_pct ?? 0) / 100,
      mgoPerHa: 0,
      nNote: 'fertiliser N',
    };
  }

  if (product.type === 'solid_manure') {
    // Normalise to t/ha
    let tPerHa = rateValue;
    if (rateUnit === 't/ac') tPerHa = rateValue / T_AC_PER_T_HA;
    const totalN = tPerHa * (product.n_kg_per_t ?? 0);
    const p2o5   = tPerHa * (product.p2o5_kg_per_t ?? 0);
    const k2o    = tPerHa * (product.k2o_kg_per_t ?? 0);
    const so3    = tPerHa * (product.so3_kg_per_t ?? 0);
    const mgo    = tPerHa * (product.mgo_kg_per_t ?? 0);

    const availFactor = nAvailability(product, dateApplied, method);
    const monthIdx = new Date(dateApplied).getMonth();
    const mLabel = method === 'soil_incorporated' ? 'soil-incorp' : 'surface';
    const nNote = availFactor === 0
      ? `${MONTH_NAMES[monthIdx]} ${mLabel} · N banked (0%)`
      : `${MONTH_NAMES[monthIdx]} ${mLabel} · ${Math.round(availFactor * 100)}% N avail`;

    return {
      nPerHa: totalN * availFactor,
      p2o5PerHa: p2o5,
      k2oPerHa: k2o,
      so3PerHa: so3,
      mgoPerHa: mgo,
      nNote,
      availFactor,
    };
  }

  // slurry / liquid manure: normalise to gal/ac
  let galPerAc = rateValue;
  if (rateUnit === 'm3/ha') galPerAc = rateValue * GAL_AC_PER_M3_HA;
  const m3PerHa = galPerAc * 0.01124;
  const totalN = m3PerHa * (product.n_kg_per_m3 ?? 0);
  const p2o5 = m3PerHa * (product.p2o5_kg_per_m3 ?? 0);
  const k2o  = m3PerHa * (product.k2o_kg_per_m3 ?? 0);
  const so3  = m3PerHa * (product.so3_kg_per_m3 ?? 0);
  const mgo  = m3PerHa * (product.mgo_kg_per_m3 ?? 0);

  const availFactor = nAvailability(product, dateApplied, method);
  const monthIdx = new Date(dateApplied).getMonth();
  const mLabel = method && (method === 'splash_plate' || method === 'dribble_bar' || method === 'trail_shoe')
    ? METHOD_LABELS[method].toLowerCase()
    : 'splash plate';
  const nNote = availFactor === 0
    ? `${MONTH_NAMES[monthIdx]} ${mLabel} · N banked (0%)`
    : `${MONTH_NAMES[monthIdx]} ${mLabel} · ${Math.round(availFactor * 100)}% N avail`;

  return {
    nPerHa: totalN * availFactor,
    p2o5PerHa: p2o5,
    k2oPerHa: k2o,
    so3PerHa: so3,
    mgoPerHa: mgo,
    nNote,
    availFactor,
  };
}

// ---- Cut offtake -------------------------------------------------

export function getOfftakeForCut(
  cutProfile: number,
  cutNumber: number,
  yieldClass: YieldClass,
  settings: Settings,
  cutType: CutType
): { n: number; p2o5: number; k2o: number; yieldDM: number; baseYieldDM: number } {
  const yields = YIELDS_BY_CUT_PROFILE[cutProfile] || [];
  const baseYieldDM = yields[cutNumber - 1] || 0;
  const yieldMult = settings.yieldMultipliers[yieldClass] ?? 1;
  const typeMult = settings.cutTypeMultipliers[cutType] ?? 1;
  const yieldDM = baseYieldDM * yieldMult * typeMult;

  const returnPct = cutType === 'grazing' ? (settings.grazingReturnPct ?? 0.70) : 0;
  const retention = 1 - returnPct;

  return {
    n: yieldDM * OFFTAKE_PER_T_DM.n * retention,
    p2o5: yieldDM * OFFTAKE_PER_T_DM.p2o5 * retention,
    k2o: yieldDM * OFFTAKE_PER_T_DM.k2o * retention,
    yieldDM,
    baseYieldDM,
  };
}

// ---- Targets for next cut -----------------------------------------

export function getPlannedCuts(field: Field): CutType[] {
  if (Array.isArray(field.planned_cuts) && field.planned_cuts.length > 0) return field.planned_cuts;
  return Array(field.cut_profile || 1).fill('silage');
}

// ---- Soil type helpers --------------------------------------------
//
// Soil type drives three things in the app:
//
//   1. K target adjustment (automatic):
//      light_sand soils leach K, so RB209 maintenance is ~40 kg K₂O/ha
//      higher across a 3-cut season. Modelled here as +13 kg K₂O/ha per
//      cut applied to every cut on a light_sand field. Other types: no
//      change.
//
//   2. Sulphur risk flag (advisory):
//      S deficiency is most common on light sands in early-mid season.
//      Reports show a flag, calculations untouched.
//
//   3. Cold-clay N timing flag (advisory):
//      Heavy clay warms slowly; early-spring N response is reduced.
//      Reports show a flag, calculations untouched.

/** Get the soil type for a field, defaulting to medium_loam. */
export function getSoilType(field: Field): SoilType {
  return field.soil_type || 'medium_loam';
}

/** Display label for a soil type, used in UI lists and headers. */
export const SOIL_TYPE_LABELS: Record<SoilType, string> = {
  light_sand: 'Light sand / shallow',
  medium_loam: 'Medium loam',
  heavy_clay: 'Heavy clay',
  deep_silt: 'Deep silt',
};

/** Short label (for tight UI spots like card subtitles). */
export const SOIL_TYPE_SHORT_LABELS: Record<SoilType, string> = {
  light_sand: 'Light sand',
  medium_loam: 'Medium loam',
  heavy_clay: 'Heavy clay',
  deep_silt: 'Deep silt',
};

/** Extra K₂O kg/ha per cut to bump the target on light sands. RB209-derived. */
const LIGHT_SAND_K_BUMP_PER_CUT_KG = 13;

/**
 * Adjust a base K₂O target for soil type. Returns the input unchanged for
 * all soils except light_sand, which gets a per-cut bump for leaching loss.
 */
export function adjustKTargetForSoil(baseK: number, soilType: SoilType): number {
  if (soilType === 'light_sand') return baseK + LIGHT_SAND_K_BUMP_PER_CUT_KG;
  return baseK;
}

/**
 * Should the report flag sulphur risk for this field?
 * Currently: light_sand triggers, regardless of season — the flag explains
 * itself ("S response likely on light soils"). Season-specific gating can
 * come later when there's UI to surface it.
 */
export function shouldFlagSulphurRisk(field: Field): boolean {
  return getSoilType(field) === 'light_sand';
}

/**
 * Should the report flag cold-clay N timing on this field?
 * Currently: heavy_clay always flags — the message ("cold-clay N response
 * is slower in early spring; consider delaying first dressing 2-3 weeks
 * vs lighter soils") is informational, not a hard rule.
 */
export function shouldFlagColdClay(field: Field): boolean {
  return getSoilType(field) === 'heavy_clay';
}

// ---- Grass system helpers -----------------------------------------
//
// A grass system describes a sward type (Perennial ryegrass, Clover-rich,
// Italian ryegrass, etc.) and supplies three numeric knobs the reports
// key off:
//   - n_cap_kg_per_ha       — annual N cap, replaces the global setting
//   - n_target_multiplier   — applied to per-cut N target (1.00 = PRG)
//   - k_multiplier          — applied to per-cut K2O offtake (1.00 = PRG)
// Plus a boolean is_legume_rich that drives advisory flags in spring mode.
//
// The DB lookup is done in the page / shell; helpers here take an already-
// loaded GrassSystem (or undefined for fields with no system FK — treated
// as PRG-equivalent so existing fields produce identical numbers).

/** Resolve a field's grass system from a preloaded list. Undefined if FK is null. */
export function resolveGrassSystem(
  field: Field,
  systems: GrassSystem[],
): GrassSystem | undefined {
  if (!field.grass_system_id) return undefined;
  return systems.find((s) => s.id === field.grass_system_id);
}

/** Should the spreading report flag the clover-suppression advisory? Yes if
 *  the field's system is legume-rich AND the report is in spring mode. */
export function shouldFlagCloverSuppression(
  field: Field,
  system: GrassSystem | undefined,
  mode: 'spring' | 'post_cut' | 'mid_season' | 'maintenance',
): boolean {
  if (!system?.is_legume_rich) return false;
  return mode === 'spring';
}

// ---- Next-action resolution ---------------------------------------
//
// Each Cut row stores a `next_action` set when the user logged the cut:
// another_cut_silage / another_cut_bales / rotational_grazing / maintenance_grazing.
//
// resolveFieldNextAction looks at the field's MOST RECENT cut this season
// and returns that cut's next_action. If no cuts exist this season, or the
// most recent cut has a NULL next_action (legacy row pre-feature), it falls
// back to reading the field's planned_cuts array — same behaviour the app
// had before the feature shipped. The fallback keeps existing data
// behaviour identical until users start logging cuts with explicit
// next_action values.

/** Resolved next-action for a field. Either the per-cut state or, when
 *  unavailable, a value inferred from planned_cuts (legacy behaviour). */
export type ResolvedNextAction =
  | NextAction
  | 'pre_first_cut_silage'   // No cuts yet, planned_cuts[0] === 'silage'
  | 'pre_first_cut_bales'    // No cuts yet, planned_cuts[0] === 'bales'
  | 'pre_first_cut_grazing'  // No cuts yet, planned_cuts[0] === 'grazing'
  | 'complete';              // All cuts in profile have been done

/**
 * Given a field and its season's cuts (any order), return the resolved
 * "what's next" status for the field. Used by the spreading report
 * (after-cut / maintenance mode eligibility), grazing report (rotational
 * inclusion) and home dashboard (next-cut badge).
 */
export function resolveFieldNextAction(
  field: Field,
  fieldCuts: Cut[],
): ResolvedNextAction {
  // Sort by cut_date desc to find the most recent cut, then by cut_number
  // as a tiebreaker (multiple cuts on the same date — pick the higher
  // cut number = the later one in the season).
  const seasonCuts = [...fieldCuts].sort((a, b) => {
    if (a.cut_date !== b.cut_date) return b.cut_date.localeCompare(a.cut_date);
    return b.cut_number - a.cut_number;
  });
  const latest = seasonCuts[0];
  if (latest && latest.next_action) {
    return latest.next_action;
  }
  // Fallback path — either no cuts yet or legacy cut with null next_action.
  // Use planned_cuts to figure out the next slot.
  const planned = getPlannedCuts(field);
  const cutsDoneThisSeason = seasonCuts.length;
  if (cutsDoneThisSeason >= field.cut_profile) return 'complete';
  const nextSlotType = planned[cutsDoneThisSeason] ?? 'silage';
  if (nextSlotType === 'silage') return 'pre_first_cut_silage';
  if (nextSlotType === 'bales') return 'pre_first_cut_bales';
  if (nextSlotType === 'grazing') return 'pre_first_cut_grazing';
  return 'pre_first_cut_silage';
}

/** Is the field heading for another cut (silage or bales)? */
export function isHeadingForAnotherCut(action: ResolvedNextAction): boolean {
  return (
    action === 'another_cut_silage' ||
    action === 'another_cut_bales' ||
    action === 'pre_first_cut_silage' ||
    action === 'pre_first_cut_bales'
  );
}

/** Is the field on the rotational grazing schedule? */
export function isHeadingForRotationalGrazing(action: ResolvedNextAction): boolean {
  return action === 'rotational_grazing' || action === 'pre_first_cut_grazing';
}

/** Is the field in maintenance-grazing state? Only true when explicitly
 *  flagged on a cut — there's no pre-first-cut equivalent because
 *  maintenance only makes sense AFTER a cut has been taken. */
export function isMaintenanceGrazing(action: ResolvedNextAction): boolean {
  return action === 'maintenance_grazing';
}

/**
 * The date of the most recent cut on the field this season, or null if
 * no cuts. Used as the start of the "since maintenance flag" window when
 * checking whether the maintenance dose threshold has been crossed.
 */
export function mostRecentCutDate(fieldCuts: Cut[]): string | null {
  if (fieldCuts.length === 0) return null;
  const sorted = [...fieldCuts].sort((a, b) => b.cut_date.localeCompare(a.cut_date));
  return sorted[0].cut_date;
}

/**
 * Categories of nutrient input that DO count toward the maintenance N
 * threshold. These are fast-acting N sources that behave like a top-up
 * dose: mineral fertiliser (bag fert), slurry (dairy/pig/separated),
 * digestate (treated as liquid; users with separated solid digestate
 * should model it as FYM).
 *
 * Categories NOT in this list — FYM, poultry, biosolids, lime, custom —
 * are slow-release / non-N sources and don't count.
 */
const MAINTENANCE_N_CATEGORIES = new Set<ProductCategory>([
  'bag_fert',
  'dairy_slurry',
  'pig_slurry',
  'separated_slurry',
  'digestate',
]);

/**
 * Does the application qualify as N toward the maintenance dose threshold?
 * Looks up the application's product category and checks against the
 * allow-list. Returns false for applications with no associated product
 * (shouldn't happen in practice but defensive) or with a null category
 * (custom products without category set).
 */
export function counts_toward_maintenance_threshold(
  app: Application,
  products: Product[],
): boolean {
  const product = products.find((p) => p.id === app.product_id);
  if (!product || !product.category) return false;
  return MAINTENANCE_N_CATEGORIES.has(product.category);
}

/**
 * Sum of N applied to a field after a given date, restricted to product
 * categories that count toward the maintenance dose. Used by the spreading
 * report's Maintenance-mode eligibility check.
 */
export function maintenanceNAppliedSince(
  applications: Application[],
  products: Product[],
  fromDateIso: string,
): number {
  const qualifying = applications
    .filter((a) => a.date_applied >= fromDateIso)
    .filter((a) => counts_toward_maintenance_threshold(a, products));
  return sumNutrients(qualifying, products).n;
}

/**
 * Has the field had enough qualifying N applied since its maintenance-
 * flagged cut to satisfy the dose threshold? Used to drop a field from
 * Maintenance mode once the threshold is crossed.
 */
export function maintenanceDoseSatisfied(
  field: Field,
  applications: Application[],
  products: Product[],
  fieldCuts: Cut[],
  settings: Settings,
): boolean {
  const threshold = settings.reportDefaults?.maintenanceDoseThresholdKgN ?? 30;
  const flagDate = mostRecentCutDate(fieldCuts);
  if (!flagDate) return false;  // can't be satisfied if no cut anchor
  const fieldApps = applications.filter((a) => a.field_id === field.id);
  const nApplied = maintenanceNAppliedSince(fieldApps, products, flagDate);
  return nApplied >= threshold;
}

/**
 * Get the per-cut nutrient targets for a field.
 *
 * Applies, in order:
 *   1. Base RB209 offtake for the cut profile + number + yield class
 *   2. N target multiplier from grass system (1.00 = PRG default; clover-rich
 *      ~0.70, herbal ~0.30, IRG ~1.15)
 *   3. K multiplier from grass system
 *   4. Grazing-returns reduction for grazing cuts (settings.grazingReturnPct)
 *   5. Light-sand K bump (soil type)
 *
 * `system` is optional: when undefined, multipliers default to 1.00 — that
 * matches PRG-default behaviour.
 *
 * `fieldCuts` is optional: when provided, the cut type for THIS calculation
 * is read from the resolver (so per-cut next_action overrides drive the
 * targets — e.g. user switched to rotational_grazing mid-season, the next
 * cut's target is now grazing economics not silage). When absent, falls
 * back to planned_cuts[cutNumber-1] — legacy / pre-next-action behaviour.
 *
 * Maintenance fields ("maintenance" resolved type) get grazing-style
 * targets at the next-cut position — the maintenance dose itself isn't
 * really targeted at "the next cut", but for consistency with the
 * resolved-display layer it produces grazing-equivalent recommendations
 * (low N, normal P/K). The spreading report's Maintenance mode uses a
 * different threshold-driven logic anyway.
 */
export function getCutTargets(
  field: Field,
  cutNumber: number,
  settings: Settings,
  system?: GrassSystem,
  fieldCuts?: Cut[],
): { n: number; p2o5: number; k2o: number; yieldDM: number; cutType: CutType } | null {
  if (!cutNumber) return null;
  // Resolve the next cut's type. Prefer the resolver when cuts are
  // supplied; fall back to planned_cuts otherwise.
  let cutType: CutType;
  if (fieldCuts) {
    const resolved = getResolvedNextCutType(field, fieldCuts);
    if (resolved === 'silage' || resolved === 'bales' || resolved === 'grazing') {
      cutType = resolved;
    } else if (resolved === 'maintenance') {
      // Maintenance behaves agronomically like grazing for the purposes
      // of nutrient targets — modest N + P/K offtake.
      cutType = 'grazing';
    } else {
      // 'complete' shouldn't reach getCutTargets normally (cuts remaining
      // is checked upstream) but if it does, just use planned_cuts as a
      // safe default.
      const planned = getPlannedCuts(field);
      cutType = planned[cutNumber - 1] || 'silage';
    }
  } else {
    // Legacy path — caller didn't supply cuts. Read from planned_cuts.
    const planned = getPlannedCuts(field);
    cutType = planned[cutNumber - 1] || 'silage';
  }
  const offtake = getOfftakeForCut(field.cut_profile, cutNumber, 'average', settings, cutType);
  const baseN = settings.nTargets[cutNumber as 1|2|3|4] ?? offtake.n;
  // Apply grass-system N multiplier. Default 1.00 when no system.
  const nMultiplier = system?.n_target_multiplier ?? 1.00;
  const nTarget = baseN * nMultiplier;
  const isGrazing = cutType === 'grazing';
  const nFinal = isGrazing ? nTarget * (1 - (settings.grazingReturnPct ?? 0.70)) : nTarget;
  // Apply grass-system K multiplier, then light-sand soil bump on top.
  const kMultiplier = system?.k_multiplier ?? 1.00;
  const k2oAfterSystem = offtake.k2o * kMultiplier;
  const k2oAdjusted = adjustKTargetForSoil(k2oAfterSystem, getSoilType(field));
  return {
    n: nFinal,
    p2o5: offtake.p2o5,
    k2o: k2oAdjusted,
    yieldDM: offtake.yieldDM,
    cutType,
  };
}

// =====================================================================
// RB209 index-adjusted P/K "to apply" engine
// =====================================================================
//
// Unlike getCutTargets (which returns pure offtake and uses the index only for
// colour-coding), this returns the actual RB209 RECOMMENDATION for the field's
// soil index — i.e. how much P2O5 / K2O to apply, which builds reserves below
// target and tapers to zero above it. This is the figure the fertiliser-plan
// and P/K-status views are built on.
//
// Reads the field's decimal p_idx/k_idx (the app's existing model) and maps it
// onto the RB209 bands, including the K 2-/2+ split. cutNumber is 1-based.

export interface FieldPKRec {
  cutType: CutType;
  cutNumber: number;
  /** RB209 recommendation, kg/ha. */
  p2o5: number;
  k2o: number;
  /** First silage cut only: how K splits across the previous autumn + spring. */
  kSplit?: { previousAutumn: number; spring: number; springCapped: boolean };
  /** Catch-up K to apply after cutting (silage systems, K index ≤ 2+). */
  extraKAfterCut: number;
  /** The resolved RB209 bands used, for display ("P index 2", "K 2+"). */
  pBand: number;
  kBand: string;
  /** True when both nutrients are at/above their maintenance target. */
  atMaintenance: boolean;
}

/**
 * RB209 P/K recommendation for a field's given cut. Pure lookup against the
 * verified tables; does NOT deduct organic-material nutrients (the caller does
 * that, since it depends on what's already been applied this season).
 */
export function getFieldPKRecommendation(
  field: Field,
  cutNumber: number,
  fieldCuts?: Cut[],
): FieldPKRec {
  // Resolve the cut type the same way getCutTargets does.
  let cutType: CutType;
  if (fieldCuts) {
    const resolved = getResolvedNextCutType(field, fieldCuts);
    cutType = (resolved === 'silage' || resolved === 'bales' || resolved === 'grazing')
      ? resolved
      : resolved === 'maintenance' ? 'grazing'
      : (getPlannedCuts(field)[cutNumber - 1] || 'silage');
  } else {
    cutType = getPlannedCuts(field)[cutNumber - 1] || 'silage';
  }

  const pBand = rb209.pBandFromDecimal(field.p_idx);
  const kBand = rb209.kBandFromDecimal(field.k_idx);

  let rec: rb209.PKRecommendation;
  if (cutType === 'grazing') {
    rec = rb209.grazingRecommendation(pBand, kBand);
  } else if (cutType === 'bales') {
    // Baled silage uses the silage table (it's still a cut removal).
    rec = rb209.silageRecommendation(cutNumber, pBand, kBand);
  } else {
    rec = rb209.silageRecommendation(cutNumber, pBand, kBand);
  }

  // Catch-up K only applies to cut (silage/bales) systems, not grazing-only.
  const extraK = (cutType === 'silage' || cutType === 'bales')
    ? rb209.extraKAfterCutting(field.cut_profile, kBand)
    : 0;

  return {
    cutType,
    cutNumber,
    p2o5: rec.p2o5,
    k2o: rec.k2o,
    kSplit: rec.kSplit,
    extraKAfterCut: extraK,
    pBand,
    kBand: String(kBand),
    atMaintenance: rec.atMaintenance,
  };
}

/**
 * Net RB209 P/K still to apply for a field this season, after deducting what's
 * already gone on (from applications) — the figure the heat-map sorts by.
 * appliedP2O5 / appliedK2O are the season-to-date kg/ha already applied.
 */
export function getFieldPKShortfall(
  field: Field,
  cutNumber: number,
  appliedP2O5: number,
  appliedK2O: number,
  fieldCuts?: Cut[],
): { rec: FieldPKRec; p2o5ToApply: number; k2oToApply: number } {
  const rec = getFieldPKRecommendation(field, cutNumber, fieldCuts);
  const totalK = rec.k2o + rec.extraKAfterCut;
  return {
    rec,
    p2o5ToApply: Math.max(0, Math.round(rec.p2o5 - appliedP2O5)),
    k2oToApply: Math.max(0, Math.round(totalK - appliedK2O)),
  };
}

// =====================================================================
// Field-level nitrogen recommendation (RB209 N tables)
// =====================================================================
//
// SNS status: there's no per-field SNS column yet, so we default to MODERATE
// (RB209's own baseline). A legume-rich grass system nudges toward lower N
// need; that's handled separately by the system N multiplier in getCutTargets.
// When a per-field SNS override is added later, read it here.

export interface FieldNRec {
  cutType: CutType;
  cutNumber: number;
  /** RB209 N recommendation for this cut, kg/ha. */
  n: number;
  sns: rb209.SNSStatus;
}

/** Default SNS for a field. Moderate unless we learn otherwise. */
export function getFieldSNS(_field: Field): rb209.SNSStatus {
  return 'moderate';
}

/**
 * RB209 nitrogen recommendation for a field's given cut.
 * Silage uses the per-cut table with per-cut SNS adjustment; grazing uses the
 * season total spread evenly across expected grazings; hay uses per-cut by SNS.
 */
export function getFieldNRecommendation(
  field: Field,
  cutNumber: number,
  fieldCuts?: Cut[],
): FieldNRec {
  let cutType: CutType;
  if (fieldCuts) {
    const resolved = getResolvedNextCutType(field, fieldCuts);
    cutType = (resolved === 'silage' || resolved === 'bales' || resolved === 'grazing')
      ? resolved
      : resolved === 'maintenance' ? 'grazing'
      : (getPlannedCuts(field)[cutNumber - 1] || 'silage');
  } else {
    cutType = getPlannedCuts(field)[cutNumber - 1] || 'silage';
  }

  const sns = getFieldSNS(field);
  const cutCount = field.cut_profile || 1;
  let n = 0;

  if (cutType === 'grazing') {
    // Spread the season grazing total across the rotations. Use cut_profile as
    // a rough proxy for intensity → target DM yield band.
    const targetYield = [5, 7, 9, 13][Math.max(0, Math.min(3, cutCount - 1))];
    const seasonTotal = rb209.grazingNTotal(targetYield, sns);
    // Per-application figure: divide across roughly cutCount+1 grazing rounds.
    n = Math.round(seasonTotal / Math.max(1, cutCount));
  } else {
    // silage / bales
    n = rb209.silageNForCut(cutCount, cutNumber, sns);
  }

  return { cutType, cutNumber, n, sns };
}

/** Net N still to apply for this cut, after deducting season-applied N. */
export function getFieldNShortfall(
  field: Field,
  cutNumber: number,
  appliedN: number,
  fieldCuts?: Cut[],
): { rec: FieldNRec; nToApply: number } {
  const rec = getFieldNRecommendation(field, cutNumber, fieldCuts);
  return { rec, nToApply: Math.max(0, Math.round(rec.n - appliedN)) };
}

// =====================================================================
// Fertiliser planner — reverse the calc: shortfall → product + rate
// =====================================================================
//
// Given a field's P2O5/K2O shortfall (kg/ha), pick a sensible granular
// fertiliser and the rate that meets it. The agronomy:
//   * If a compound's P:K ratio roughly matches the shortfall ratio, use it —
//     one pass, one product.
//   * Otherwise use straight products: a P source (e.g. TSP) and/or a K source
//     (e.g. MOP), rated independently.
//   * The rate is set to meet the LIMITING nutrient without large overshoot of
//     the other; we report any over/under so the user can judge.
// The planner only considers GRANULAR bag-fert products (liquids are dosed
// differently and usually N-led; P/K planning is granular in practice).

export interface PlannedProduct {
  productId: number;
  productName: string;
  /** Rate in kg/ha. */
  rateKgPerHa: number;
  /** What this product delivers at that rate, kg/ha. */
  deliversN: number;
  deliversP2O5: number;
  deliversK2O: number;
}

export interface FieldFertPlan {
  /** Up to three products (P source + K source + N source), or fewer. */
  products: PlannedProduct[];
  /** Net delivered vs needed, after the plan, kg/ha. Positive = surplus. */
  nBalance: number;
  p2o5Balance: number;
  k2oBalance: number;
  /** Human note on the strategy chosen. */
  note: string;
}

/** Score how well a product's P:K profile matches a target P:K shortfall. */
function ratioMatch(prodP: number, prodK: number, needP: number, needK: number): number {
  // Normalise both to unit vectors and take dot product (1 = perfect match).
  const pn = Math.hypot(prodP, prodK) || 1;
  const nn = Math.hypot(needP, needK) || 1;
  return (prodP * needP + prodK * needK) / (pn * nn);
}

/**
 * Plan the granular fertiliser to meet a P/K shortfall on one field.
 * Returns null when nothing is needed (both shortfalls zero).
 */
export function planFieldFertiliser(
  p2o5ToApply: number,
  k2oToApply: number,
  products: Product[],
  nToApply: number = 0,
): FieldFertPlan | null {
  if (p2o5ToApply <= 0 && k2oToApply <= 0 && nToApply <= 0) return null;

  // All granular bag-fert products (any nutrient). N topup may use an N-only
  // straight (e.g. CAN) that has no P or K.
  const granularAll = products.filter(
    (p) => p.type === 'bag_fert' && (p.form === 'granular' || p.form == null),
  );
  // Subset carrying P or K — used for the P/K strategies.
  const granular = granularAll.filter(
    (p) => (p.p2o5_pct ?? 0) > 0 || (p.k2o_pct ?? 0) > 0,
  );

  if (granular.length === 0 && nToApply <= 0) {
    return { products: [], nBalance: 0, p2o5Balance: -p2o5ToApply, k2oBalance: -k2oToApply,
      note: 'No granular P/K fertiliser set up — add one to plan rates.' };
  }

  const plan: PlannedProduct[] = [];
  let dN = 0, dP = 0, dK = 0;
  let usedCompound = false;

  const pushProduct = (p: Product, rate: number) => {
    const gN = rate * (p.n_pct ?? 0) / 100;
    const gP = rate * (p.p2o5_pct ?? 0) / 100;
    const gK = rate * (p.k2o_pct ?? 0) / 100;
    plan.push({
      productId: p.id, productName: p.name, rateKgPerHa: Math.round(rate),
      deliversN: Math.round(gN), deliversP2O5: Math.round(gP), deliversK2O: Math.round(gK),
    });
    dN += gN; dP += gP; dK += gK;
  };

  // Strategy 1: a single compound whose P:K ratio matches the shortfall well.
  if (p2o5ToApply > 0 && k2oToApply > 0) {
    const compounds = granular.filter((p) => (p.p2o5_pct ?? 0) > 0 && (p.k2o_pct ?? 0) > 0);
    let best: { prod: Product; score: number } | null = null;
    for (const p of compounds) {
      const s = ratioMatch(p.p2o5_pct ?? 0, p.k2o_pct ?? 0, p2o5ToApply, k2oToApply);
      if (!best || s > best.score) best = { prod: p, score: s };
    }
    if (best && best.score > 0.97) {
      const p = best.prod;
      const rateForP = (p.p2o5_pct ?? 0) > 0 ? (p2o5ToApply / (p.p2o5_pct! / 100)) : 0;
      const rateForK = (p.k2o_pct ?? 0) > 0 ? (k2oToApply / (p.k2o_pct! / 100)) : 0;
      pushProduct(p, Math.max(rateForP, rateForK));
      usedCompound = true;
    }
  }

  // Strategy 2: straight P and K sources (only if the compound wasn't used).
  if (!usedCompound) {
    if (p2o5ToApply > 0) {
      const pSource = [...granular]
        .filter((p) => (p.p2o5_pct ?? 0) > 0)
        .sort((a, b) => (b.p2o5_pct ?? 0) - (a.p2o5_pct ?? 0))[0];
      if (pSource) pushProduct(pSource, p2o5ToApply / (pSource.p2o5_pct! / 100));
    }
    if (k2oToApply - dK > 0) {
      const kSource = [...granular]
        .filter((p) => (p.k2o_pct ?? 0) > 0)
        .sort((a, b) => (b.k2o_pct ?? 0) - (a.k2o_pct ?? 0))[0];
      if (kSource) pushProduct(kSource, (k2oToApply - dK) / (kSource.k2o_pct! / 100));
    }
  }

  // Strategy 3: N top-up. After P/K products' incidental N, cover the rest
  // with a straight N source (highest N%, lowest P/K — e.g. CAN, urea).
  const nRemaining = nToApply - dN;
  if (nRemaining > 1) {
    const nSource = [...granularAll]
      .filter((p) => (p.n_pct ?? 0) > 0)
      // Prefer high N, and low P+K (a true N straight over a compound).
      .sort((a, b) => {
        const an = (a.n_pct ?? 0) - ((a.p2o5_pct ?? 0) + (a.k2o_pct ?? 0)) * 0.5;
        const bn = (b.n_pct ?? 0) - ((b.p2o5_pct ?? 0) + (b.k2o_pct ?? 0)) * 0.5;
        return bn - an;
      })[0];
    if (nSource && (nSource.n_pct ?? 0) > 0) {
      pushProduct(nSource, nRemaining / (nSource.n_pct! / 100));
    }
  }

  let note: string;
  if (plan.length === 0) note = 'Nothing to apply.';
  else if (usedCompound && plan.length === 1) note = `${plan[0].productName} matches the P:K ratio — one pass.`;
  else if (plan.length === 1) note = 'Single product.';
  else note = `${plan.length} products — ` + plan.map((p) => p.productName).join(' + ');

  return {
    products: plan,
    nBalance: Math.round(dN - nToApply),
    p2o5Balance: Math.round(dP - p2o5ToApply),
    k2oBalance: Math.round(dK - k2oToApply),
    note,
  };
}



/**
 * Split a full-cut target across multiple dressings.
 *
 * **Only N is split.** P and K stay at full target on every dressing because
 * the agronomic pattern is to bank P and K at season start (banking in soil)
 * and top-up N through the season. Splitting P/K would imply a contractor
 * spreading P and K in small doses through the year, which nobody does.
 *
 * Front-load percentage applies to dressing 1's share of N; subsequent
 * dressings share the remaining N evenly.
 *
 * Example: N=100, 2 dressings, frontLoadPct=60 →
 *   dressing 1 = 60 N, dressing 2 = 40 N. P/K full on both.
 *
 * Example: N=100, 3 dressings, frontLoadPct=60 →
 *   dressing 1 = 60 N, dressings 2+3 = 20 N each. P/K full on all.
 *
 * dressingNumber and totalDressings are 1-indexed.
 */
export function getSplitTarget(
  fullTarget: { n: number; p2o5: number; k2o: number },
  dressingNumber: number,
  totalDressings: number,
  frontLoadPct: number,
): { n: number; p2o5: number; k2o: number } {
  if (totalDressings <= 1) return fullTarget;
  if (dressingNumber < 1 || dressingNumber > totalDressings) return fullTarget;
  const front = Math.max(0, Math.min(1, frontLoadPct / 100));
  const nShare = dressingNumber === 1
    ? front
    : (1 - front) / (totalDressings - 1);
  return {
    n:    fullTarget.n * nShare,
    p2o5: fullTarget.p2o5,     // P stays full — banked at season start
    k2o:  fullTarget.k2o,      // K stays full — stripped by the cut, not split
  };
}

/**
 * Annual N cap for the field, kg N/ha.
 *
 * Prefers the grass system's per-system cap when one is provided. Falls back
 * to `settings.reportDefaults.annualNCapKgPerHa` when no system is set on
 * the field (rare — migration backfills every field with PRG, default cap
 * 320). Caller decides when the cap applies (e.g. grass-only).
 */
export function getNCap(field: Field, settings: Settings, system?: GrassSystem): number {
  if (system?.n_cap_kg_per_ha) return system.n_cap_kg_per_ha;
  return settings.reportDefaults?.annualNCapKgPerHa ?? 320;
}

// ---- Sum nutrients across applications ---------------------------

export function sumNutrients(apps: Application[], products: Product[]): { n: number; p: number; k: number; so3: number; mgo: number } {
  let n = 0, p = 0, k = 0, so3 = 0, mgo = 0;
  for (const a of apps) {
    const product = products.find(pr => pr.id === a.product_id);
    const nut = calcNutrients(product, a.rate_value, a.rate_unit, a.date_applied, a.method);
    n   += nut.nPerHa    || 0;
    p   += nut.p2o5PerHa || 0;
    k   += nut.k2oPerHa  || 0;
    so3 += nut.so3PerHa  || 0;
    mgo += nut.mgoPerHa  || 0;
  }
  return { n, p, k, so3, mgo };
}

// ---- Season helpers ------------------------------------------------

export function getSeasonStart(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = date.getMonth();
  const startYear = m >= 8 ? y : y - 1;
  return `${startYear}-09-01`;
}

export function getSeasonLabel(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = date.getMonth();
  const cropYear = m >= 8 ? y + 1 : y;
  return `${cropYear} season`;
}

// ---- Home "Coming up" timing prompts -------------------------------
//
// Nitrogen after a cut is time-critical: once a field is cut, it wants its
// after-cut N to drive regrowth, and that window is short. P/K is NOT a
// timing prompt — it's a planning decision handled in the fertiliser plan.
//
// This helper derives, for a single field, what (if anything) should appear
// in the home screen's "Coming up" section. It's pure timing logic on data
// already loaded (cut dates, applications), so it has no RB209 dependency.

export type ComingUpKind =
  | 'n_due'        // cut recently, after-cut N not yet applied, within due window
  | 'n_overdue'    // cut a while ago, after-cut N still not applied
  | 'grazing_due'; // grazing field approaching its topping-dressing interval

export interface ComingUpItem {
  fieldId: string;
  fieldName: string;
  kind: ComingUpKind;
  /** Days since the triggering cut (n_*) or since last dressing (grazing). */
  days: number;
  /** For grazing_due: days until the dressing is due (negative = overdue). */
  daysUntil?: number;
}

function daysBetween(fromIso: string, to: Date): number {
  const from = new Date(fromIso + (fromIso.length <= 10 ? 'T00:00:00' : ''));
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / 86_400_000);
}

/**
 * Has nitrogen been applied to this field since the given date? Checks
 * applications whose product carries N (bag fert, slurry, manure). Lime and
 * zero-N products don't count.
 */
function nitrogenAppliedSince(
  fieldId: string,
  sinceIso: string,
  applications: Application[],
  products: Product[],
): boolean {
  const byId = new Map(products.map((p) => [p.id, p]));
  return applications.some((a) => {
    if (a.field_id !== fieldId) return false;
    if (a.date_applied < sinceIso) return false;
    const p = byId.get(a.product_id);
    if (!p) return false;
    const n =
      (p.n_pct ?? 0) || (p.n_kg_per_m3 ?? 0) || (p.n_kg_per_t ?? 0);
    return n > 0;
  });
}

/**
 * Compute the "Coming up" item for one field, or null if nothing's due.
 *
 * Logic:
 *  - If the field's most recent cut (this season) has had NO nitrogen applied
 *    since the cut date, it's a nitrogen prompt: 'n_due' until
 *    nOverdueAfterCutDays, then 'n_overdue'. Only applies to fields whose
 *    most recent cut expects regrowth (i.e. another cut or grazing follows —
 *    not a field that's been put to maintenance/finished). We surface it for
 *    any recent cut; the user can dismiss by logging the N.
 *  - Grazing fields (most recent action is rotational grazing, or a grazing
 *    cut) get a 'grazing_due' prompt as they approach the dressing interval.
 */
export function getComingUpForField(
  field: Field,
  fieldCuts: Cut[],
  applications: Application[],
  products: Product[],
  settings: Settings,
  now: Date = new Date(),
): ComingUpItem | null {
  const timing = settings.timingDefaults ?? DEFAULT_SETTINGS.timingDefaults;
  const seasonStart = getSeasonStart(now);
  const cuts = fieldCuts
    .filter((c) => c.cut_date >= seasonStart)
    .sort((a, b) => b.cut_date.localeCompare(a.cut_date));
  const lastCut = cuts[0];
  if (!lastCut) return null;

  const sinceCut = lastCut.cut_date;
  const daysSinceCut = daysBetween(sinceCut, now);

  // Grazing path: if the most recent action points to grazing, treat this as
  // a grazing field on a dressing interval.
  const isGrazing =
    lastCut.next_action === 'rotational_grazing' ||
    lastCut.cut_type === 'grazing';

  if (isGrazing) {
    const due = timing.grazingDressingIntervalDays;
    const daysUntil = due - daysSinceCut;
    // Show when within the lead-time window (or already past due).
    if (daysUntil <= timing.planLeadTimeDays) {
      return {
        fieldId: field.id,
        fieldName: field.name,
        kind: 'grazing_due',
        days: daysSinceCut,
        daysUntil,
      };
    }
    return null;
  }

  // Nitrogen-after-cut path. Skip if N already applied since the cut.
  if (nitrogenAppliedSince(field.id, sinceCut, applications, products)) {
    return null;
  }
  // Skip if the field is finished for the season (maintenance with no further
  // cut expected is still worth an N top-up, so we keep it; only truly nothing
  // -follows would skip, which we don't model yet).
  if (daysSinceCut < timing.nDueAfterCutDays) return null;

  const overdue = daysSinceCut >= timing.nOverdueAfterCutDays;
  return {
    fieldId: field.id,
    fieldName: field.name,
    kind: overdue ? 'n_overdue' : 'n_due',
    days: daysSinceCut,
  };
}


// ---- Formatting --------------------------------------------------

export function fmt(n: number | null | undefined, dp = 0): string {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(dp);
}

export function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateShort(s: string): string {
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

// ---- Soil colour-coding ------------------------------------------

export function soilMetricColor(value: number | null | undefined, target: number | null | undefined): string {
  if (value == null || target == null) return 'var(--muted)';
  if (value >= target) return 'var(--forest)';
  if (value >= target * 0.8) return 'var(--amber)';
  return 'var(--red)';
}
