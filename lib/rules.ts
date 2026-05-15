import {
  Application, Cut, CutType, Field, Product, Settings,
  SlurryMethod, YieldClass, RateUnit, DEFAULT_SETTINGS,
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

export const YIELD_CLASS_LABELS: Record<YieldClass, string> = {
  light: 'Light', average: 'Average', heavy: 'Heavy',
};

export const METHOD_LABELS: Record<SlurryMethod, string> = {
  splash_plate: 'Splash plate',
  dribble_bar: 'Dribble bar',
  trail_shoe: 'Trail shoe',
};

export const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ---- Conversions --------------------------------------------------

const KG_HA_PER_KG_AC = 2.4711;
const KG_HA_PER_LB_AC = 1.1209;
const GAL_AC_PER_M3_HA = 89.0;
const T_AC_PER_T_HA = 0.4047;

export function displayRate(app: Application, settings: Settings, productType: 'bag_fert' | 'slurry' | 'lime'): { value: number; unit: string } {
  if (productType === 'bag_fert') {
    let kgPerHa = app.rate_value;
    if (app.rate_unit === 'kg/ac') kgPerHa = app.rate_value * KG_HA_PER_KG_AC;
    else if (app.rate_unit === 'lb/ac') kgPerHa = app.rate_value * KG_HA_PER_LB_AC;
    const out = settings.bagFertUnit === 'kg/ac' ? kgPerHa / KG_HA_PER_KG_AC
              : settings.bagFertUnit === 'lb/ac' ? kgPerHa / KG_HA_PER_LB_AC
              : kgPerHa;
    return { value: out, unit: settings.bagFertUnit };
  }
  if (productType === 'slurry') {
    let galPerAc = app.rate_value;
    if (app.rate_unit === 'm3/ha') galPerAc = app.rate_value * GAL_AC_PER_M3_HA;
    const out = settings.slurryUnit === 'm3/ha' ? galPerAc / GAL_AC_PER_M3_HA : galPerAc;
    return { value: out, unit: settings.slurryUnit };
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

// ---- Slurry N availability ---------------------------------------

export function slurryNAvailability(dateApplied: string, method: SlurryMethod | null): number {
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

// ---- Per-application NPK delivered -------------------------------

export function calcNutrients(
  product: Product | undefined,
  rateValue: number,
  rateUnit: RateUnit,
  dateApplied: string,
  method: SlurryMethod | null
): { nPerHa: number; p2o5PerHa: number; k2oPerHa: number; nNote: string; availFactor?: number } {
  if (!product || !rateValue) return { nPerHa: 0, p2o5PerHa: 0, k2oPerHa: 0, nNote: '' };

  if (product.type === 'lime') {
    return { nPerHa: 0, p2o5PerHa: 0, k2oPerHa: 0, nNote: 'pH amendment' };
  }

  if (product.type === 'bag_fert') {
    // Normalise to kg/ha
    let kgPerHa = rateValue;
    if (rateUnit === 'kg/ac') kgPerHa = rateValue * KG_HA_PER_KG_AC;
    else if (rateUnit === 'lb/ac') kgPerHa = rateValue * KG_HA_PER_LB_AC;
    return {
      nPerHa: kgPerHa * (product.n_pct ?? 0) / 100,
      p2o5PerHa: kgPerHa * (product.p2o5_pct ?? 0) / 100,
      k2oPerHa: kgPerHa * (product.k2o_pct ?? 0) / 100,
      nNote: 'fertiliser N',
    };
  }

  // slurry: normalise to gal/ac
  let galPerAc = rateValue;
  if (rateUnit === 'm3/ha') galPerAc = rateValue * GAL_AC_PER_M3_HA;
  const m3PerHa = galPerAc * 0.01124;
  const totalN = m3PerHa * (product.n_kg_per_m3 ?? 0);
  const p2o5 = m3PerHa * (product.p2o5_kg_per_m3 ?? 0);
  const k2o = m3PerHa * (product.k2o_kg_per_m3 ?? 0);

  const availFactor = slurryNAvailability(dateApplied, method);
  const monthIdx = new Date(dateApplied).getMonth();
  const mLabel = method ? METHOD_LABELS[method].toLowerCase() : 'splash plate';
  const nNote = availFactor === 0
    ? `${MONTH_NAMES[monthIdx]} ${mLabel} · N banked (0%)`
    : `${MONTH_NAMES[monthIdx]} ${mLabel} · ${Math.round(availFactor * 100)}% N avail`;

  return {
    nPerHa: totalN * availFactor,
    p2o5PerHa: p2o5,
    k2oPerHa: k2o,
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

export function sumNutrients(apps: Application[], products: Product[]): { n: number; p: number; k: number } {
  let n = 0, p = 0, k = 0;
  for (const a of apps) {
    const product = products.find(pr => pr.id === a.product_id);
    const nut = calcNutrients(product, a.rate_value, a.rate_unit, a.date_applied, a.method);
    n += nut.nPerHa || 0;
    p += nut.p2o5PerHa || 0;
    k += nut.k2oPerHa || 0;
  }
  return { n, p, k };
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
