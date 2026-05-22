import {
  Application, Cut, CutType, Field, Product, ProductCategory, ProductType, Settings,
  SlurryMethod, SolidMethod, ApplicationMethod, YieldClass, RateUnit, DEFAULT_SETTINGS,
} from './types';

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
export type NextCutType = CutType | 'complete';

export function getNextCutType(field: Field, cutsDoneThisSeason: number): NextCutType {
  if (cutsDoneThisSeason >= field.cut_profile) return 'complete';
  // planned_cuts is parallel to cut numbers; cutsDoneThisSeason is the index
  // into planned_cuts that the NEXT cut occupies (0-indexed: 0 cuts done → cut 1 → planned_cuts[0]).
  return field.planned_cuts[cutsDoneThisSeason] ?? 'silage';
}

export const NEXT_CUT_LABELS: Record<NextCutType, string> = {
  silage: 'Silage',
  bales: 'Bales',
  grazing: 'Grazing',
  complete: 'Complete',
};

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
 * Display a field's area in the user's preferred system. Returns the numeric
 * value and the unit label. Field rows always carry both `acres` and `ha`
 * (kept in sync by the AddFieldForm and the importer), so this is just a
 * choice of which column to display, not a conversion.
 */
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
    // Normalise to kg/ha
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

export function getCutTargets(
  field: Field,
  cutNumber: number,
  settings: Settings
): { n: number; p2o5: number; k2o: number; yieldDM: number; cutType: CutType } | null {
  if (!cutNumber) return null;
  const planned = getPlannedCuts(field);
  const cutType: CutType = planned[cutNumber - 1] || 'silage';
  const offtake = getOfftakeForCut(field.cut_profile, cutNumber, 'average', settings, cutType);
  const nTarget = settings.nTargets[cutNumber as 1|2|3|4] ?? offtake.n;
  const isGrazing = cutType === 'grazing';
  const nFinal = isGrazing ? nTarget * (1 - (settings.grazingReturnPct ?? 0.70)) : nTarget;
  return {
    n: nFinal,
    p2o5: offtake.p2o5,
    k2o: offtake.k2o,
    yieldDM: offtake.yieldDM,
    cutType,
  };
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
