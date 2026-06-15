// =============================================================================
// Crop nutrient engine — the non-grass parallel to lib/rules.ts + lib/fertplan.ts.
//
// Given a field, its crop allocation for a season, the crop profile, and the
// organic/granular applications logged on that field this season, this computes
// the crop's nutrient plan:
//   N    — from the crop's SNS-driven anchor (a CEILING for brassicas),
//   P/K  — from soil index, per the crop's PK regime (offtake-replacement, or
//          seedbed-only at low index for brassicas), and
//   Mg / Na / S / micros — advisories, crop-section-only (containment-following
//          the Mg/Na convention; designed to lift app-wide later).
//
// It REUSES the grass engine's organic-crediting machinery verbatim (calcNutrients,
// organicReleaseFraction): N comes pre-availability-adjusted from calcNutrients,
// P/K get the release fraction, exactly as the fert plan does. Grass fields and
// grass reports are untouched by anything here.
//
// IMPORTANT: figures are RB209-first. The per-index brassica N values in
// lib/crops.ts are conservative — the catalogue is editable so they can be
// tuned. This engine encodes the RB209 *rules* (ceilings, seedbed-only-at-low-
// index, Mg-at-Index-0, the clubroot break); the numbers ride on the profile.
// =============================================================================

import { Field, Product, Application, Settings, FieldCropAllocation } from './types';
import { CropProfile, CropMicro } from './crops';
import {
  calcNutrients, organicReleaseFraction, monthsBetween, ukTodayIso, displayFieldArea,
} from './rules';
import { meteredApps, fieldAreaHa } from './partials';
import * as rb209 from './rb209';

// ---------------------------------------------------------------------------
// Soil-nitrogen-supply status. There's no per-field SNS column yet, so default
// to MODERATE — the same baseline the grass engine uses (getFieldSNS). When a
// per-field SNS override lands, read it here.
// ---------------------------------------------------------------------------
export type CropSNS = 'low' | 'moderate' | 'high';
export function getCropFieldSNS(_field: Field): CropSNS {
  return 'moderate';
}

// ---------------------------------------------------------------------------
// Season window. A season is identified by its END year (matches getSeasonLabel):
// season 2026 == 1 Oct 2025 – 30 Sep 2026.
// ---------------------------------------------------------------------------
export function cropSeasonWindow(season: number): { start: string; end: string } {
  return { start: `${season - 1}-10-01`, end: `${season}-09-30` };
}

/** Current crop season (end-year) for a given date. */
export function currentCropSeason(today: string = ukTodayIso()): number {
  const y = parseInt(today.slice(0, 4), 10);
  const m = parseInt(today.slice(5, 7), 10); // 1–12
  return m >= 10 ? y + 1 : y;
}

// ---------------------------------------------------------------------------
// Soil index → small integer (P 0..4, K 0..4 with the 2-/2+ split collapsed).
// ---------------------------------------------------------------------------
function pIndexInt(field: Pick<Field, 'p_idx'>): number {
  return rb209.pBandFromDecimal(field.p_idx); // already 0|1|2|3|4
}
function kIndexInt(field: Pick<Field, 'k_idx'>): number {
  const band = rb209.kBandFromDecimal(field.k_idx);
  if (band === '2-' || band === '2+') return 2;
  return band as number;
}

// "Build toward the target index" increments (kg/ha) added at low index on top
// of offtake, for the offtake-replacement regime. RB209's per-crop tables fold
// build-up into the rate; these are the equivalent for the crop engine and are
// deliberately modest. Index 2 = replace offtake; Index 3+ = nil (run reserves).
const P_BUILD: Record<number, number> = { 0: 30, 1: 15 };
const K_BUILD: Record<number, number> = { 0: 60, 1: 30 };

// ---------------------------------------------------------------------------
// Nitrogen target.
// ---------------------------------------------------------------------------
export interface CropNTarget {
  n: number;
  /** True for brassicas: nTargetKgPerHa is a CEILING — SNS only reduces it. */
  isCeiling: boolean;
  sns: CropSNS;
}

export function cropNTarget(profile: CropProfile, sns: CropSNS): CropNTarget {
  const adj = rb209.SNS_TOTAL_N_ADJUST[sns]; // low +30, moderate 0, high −30
  const isCeiling = profile.pkRegime === 'seedbed_low_index_only'; // forage brassicas
  const base = profile.nTargetKgPerHa;
  const n = isCeiling
    ? Math.max(0, Math.round(base + Math.min(0, adj))) // ceiling: never add for low SNS
    : Math.max(0, Math.round(base + adj));
  return { n, isCeiling, sns };
}

// ---------------------------------------------------------------------------
// Phosphate & potash recommendation (gross, before organic credits).
// ---------------------------------------------------------------------------
export interface CropPKRec {
  p2o5: number;
  k2o: number;
  pIndex: number;
  kIndex: number;
  basis: string;
  kLiftTopUpNote?: string;
}

export function cropPKRecommendation(profile: CropProfile, field: Field, yieldT: number): CropPKRec {
  const pIdx = pIndexInt(field);
  const kIdx = kIndexInt(field);
  const offP = Math.max(0, Math.round((profile.offtake.p2o5 || 0) * yieldT));
  const offK = Math.max(0, Math.round((profile.offtake.k2o || 0) * yieldT));

  if (profile.pkRegime === 'seedbed_low_index_only') {
    // Forage brassicas (RB209 §3): a seedbed dressing ONLY at Index 0 or 1; at
    // Index 2+ the crop lives off soil reserves → nil.
    return {
      p2o5: pIdx <= 1 ? offP : 0,
      k2o: kIdx <= 1 ? offK : 0,
      pIndex: pIdx,
      kIndex: kIdx,
      basis: 'Seedbed dressing only, and only at Index 0–1; at Index 2+ the crop lives off soil reserves (RB209 §3).',
      kLiftTopUpNote: profile.kLiftTopUpNote,
    };
  }

  // offtake-replacement: build at 0–1, replace offtake at 2, nil at 3+.
  let p2o5: number;
  if (pIdx <= 0) p2o5 = offP + P_BUILD[0];
  else if (pIdx === 1) p2o5 = offP + P_BUILD[1];
  else if (pIdx === 2) p2o5 = offP;
  else p2o5 = 0;

  let k2o: number;
  if (kIdx <= 0) k2o = offK + K_BUILD[0];
  else if (kIdx === 1) k2o = offK + K_BUILD[1];
  else if (kIdx === 2) k2o = offK;
  else k2o = 0;

  return {
    p2o5,
    k2o,
    pIndex: pIdx,
    kIndex: kIdx,
    basis: 'Replace offtake at Index 2; build at Index 0–1; nil at Index 3+.',
    kLiftTopUpNote: profile.kLiftTopUpNote,
  };
}

// ---------------------------------------------------------------------------
// Magnesium advisory (crop-section only). RB209 maintains soil Mg at Index 2
// and recommends Mg only at Index 0 (50–100 kg MgO/ha every 3–4 years).
// ---------------------------------------------------------------------------
export interface CropMgAdvisory { recommend: boolean; note: string; }

export function cropMgAdvisory(profile: CropProfile, field: Field): CropMgAdvisory | null {
  if (!profile.needsMg) return null;
  const mgIdx = rb209.mgIndexFromDecimal(field.mg_idx);
  if (mgIdx == null) {
    return { recommend: false, note: 'Mg-responsive crop, but no soil Mg index on file — sample for Mg (RB209 advises Mg only at Index 0).' };
  }
  if (mgIdx <= 0) {
    return { recommend: true, note: 'Soil Mg Index 0 — apply 50–100 kg MgO/ha (lasts 3–4 years).' };
  }
  return { recommend: false, note: `Soil Mg Index ${mgIdx} — no magnesium needed (RB209 maintains Mg at Index 2).` };
}

// ---------------------------------------------------------------------------
// Clubroot rotation warning. Brassicas need at least a 5-year break: a prior
// brassica within 4 seasons (|Δ| < 5) is too close.
// ---------------------------------------------------------------------------
export function brassicaClubrootWarning(
  profile: CropProfile,
  season: number,
  priorBrassicaSeasons: number[] = [],
): string | null {
  if (profile.family !== 'brassica') return null;
  const tooClose = priorBrassicaSeasons
    .filter((s) => s !== season && Math.abs(season - s) < 5)
    .sort((a, b) => a - b);
  if (tooClose.length === 0) return null;
  return `Clubroot risk: a brassica was grown on this field in ${tooClose.join(', ')}. RB209 advises at least a 5-year break between brassica crops.`;
}

// ---------------------------------------------------------------------------
// Season nutrient supply from logged applications (availability-adjusted),
// reusing the grass engine's crediting. N is pre-adjusted by calcNutrients
// (slurry N availability etc.); P/K get the organic release fraction. Granular
// (bag fert) is credited in full. Lime is ignored for N/P/K.
// ---------------------------------------------------------------------------
export interface CropSupply {
  n: number; p: number; k: number; so3: number; mgo: number;
  organicN: number; organicP: number; organicK: number;
  granularN: number; granularP: number; granularK: number;
}

function emptySupply(): CropSupply {
  return { n: 0, p: 0, k: 0, so3: 0, mgo: 0, organicN: 0, organicP: 0, organicK: 0, granularN: 0, granularP: 0, granularK: 0 };
}

export function seasonCropSupply(
  apps: Application[],
  products: Product[],
  releaseParams: Parameters<typeof organicReleaseFraction>[2],
  today: string,
): CropSupply {
  const s = emptySupply();
  for (const a of apps) {
    const product = products.find((p) => p.id === a.product_id);
    const t = product?.type ?? 'bag_fert';
    const nut = calcNutrients(product, a.rate_value, a.rate_unit, a.date_applied, a.method);
    if (t === 'slurry' || t === 'solid_manure') {
      const frac = organicReleaseFraction(t, monthsBetween(a.date_applied, today), releaseParams);
      s.organicN += nut.nPerHa;                 // already availability-adjusted
      s.organicP += nut.p2o5PerHa * frac;
      s.organicK += nut.k2oPerHa * frac;
      s.so3 += nut.so3PerHa * frac;
      s.mgo += nut.mgoPerHa * frac;
    } else if (t === 'bag_fert') {
      s.granularN += nut.nPerHa;
      s.granularP += nut.p2o5PerHa;
      s.granularK += nut.k2oPerHa;
      s.so3 += nut.so3PerHa;
      s.mgo += nut.mgoPerHa;
    }
    // 'lime' contributes no N/P/K.
  }
  s.n = s.organicN + s.granularN;
  s.p = s.organicP + s.granularP;
  s.k = s.organicK + s.granularK;
  return s;
}

// ---------------------------------------------------------------------------
// The assembled per-field crop plan.
// ---------------------------------------------------------------------------
export interface CropPlan {
  fieldId: string;
  fieldName: string;
  cropKey: string;
  cropLabel: string;
  category: CropProfile['category'];
  season: number;
  yieldT: number;
  yieldUnit: string;

  areaValue: number;
  areaUnit: 'ac' | 'ha';
  ha: number;
  sampled: boolean;

  // Nitrogen
  nTarget: number;
  nIsCeiling: boolean;
  appliedN: number;
  nToApply: number;
  nStages: CropProfile['nStages'];
  totalNNote: string;

  // Phosphate & potash
  p2o5Target: number;
  k2oTarget: number;
  appliedP: number;
  appliedK: number;
  p2o5ToApply: number;
  k2oToApply: number;
  pIndex: number;
  kIndex: number;
  pkBasis: string;

  // Supply breakdown (for nutrient bars, mirrors the fert plan)
  supply: CropSupply;

  // Advisories (crop-section-only)
  sns: CropSNS;
  targetPh: number;
  ph: number | null;
  phNote?: string;
  phLow: boolean;
  mg: CropMgAdvisory | null;
  na: string | null;
  sulphur: string | null;
  micros: CropMicro[];
  kLiftTopUpNote?: string;
  clubrootWarning: string | null;

  evidence: CropProfile['evidence'];
  sources: string;
  /** Human-readable advisory lines, ready to render. */
  notes: string[];
}

export interface BuildCropPlanOpts {
  /** Override "today" (testing / fixed reporting date). */
  today?: string;
  /** Seasons (end-years) this field has previously grown a brassica, for the
   *  clubroot check. Populated from the allocation history. */
  priorBrassicaSeasons?: number[];
}

/**
 * Build a field's crop plan for its allocation. `applications` may be all of the
 * farm's applications (or just this field's) — they're filtered to this field
 * and the allocation's season window, and part-field applications are metered
 * exactly as the grass plan does.
 */
export function buildCropPlan(
  field: Field,
  allocation: FieldCropAllocation,
  profile: CropProfile,
  applications: Application[],
  products: Product[],
  settings: Settings,
  opts: BuildCropPlanOpts = {},
): CropPlan {
  const today = opts.today ?? ukTodayIso();
  const { start, end } = cropSeasonWindow(allocation.season);
  const ha = fieldAreaHa(field);

  const releaseParams = {
    releaseSlurryStartPct: settings.reportDefaults.releaseSlurryStartPct,
    releaseSlurryPerMonthPct: settings.reportDefaults.releaseSlurryPerMonthPct,
    releaseFymStartPct: settings.reportDefaults.releaseFymStartPct,
    releaseFymPerMonthPct: settings.reportDefaults.releaseFymPerMonthPct,
    releaseFymCapPct: settings.reportDefaults.releaseFymCapPct,
  };

  const seasonApps = meteredApps(
    applications.filter(
      (a) => a.field_id === field.id && a.date_applied >= start && a.date_applied <= end,
    ),
    () => ha,
  );
  const supply = seasonCropSupply(seasonApps, products, releaseParams, today);

  const sns = getCropFieldSNS(field);
  const yieldT = allocation.expected_yield ?? profile.yieldDefault;

  const nT = cropNTarget(profile, sns);
  const pk = cropPKRecommendation(profile, field, yieldT);

  const nToApply = Math.max(0, Math.round(nT.n - supply.n));
  const p2o5ToApply = Math.max(0, Math.round(pk.p2o5 - supply.p));
  const k2oToApply = Math.max(0, Math.round(pk.k2o - supply.k));

  const mg = cropMgAdvisory(profile, field);
  const na = profile.needsNa
    ? 'Sodium-responsive crop — agricultural salt (Na₂O) can lift yield on responsive land; see RB209 for rates.'
    : null;
  const sulphur = profile.needsS
    ? (profile.sulphurNote ?? 'Sulphur-hungry crop — consider applying sulphur in spring, especially on light land.')
    : null;
  const micros = profile.micros ?? [];
  const phLow = field.ph != null && field.ph < profile.targetPh;
  const clubrootWarning = brassicaClubrootWarning(profile, allocation.season, opts.priorBrassicaSeasons);

  const area = displayFieldArea(field, settings.unitSystem);

  // Assemble the advisory lines in priority order.
  const notes: string[] = [];
  if (!field.sampled || field.p_idx == null || field.k_idx == null) {
    notes.push('No current soil index for this field — P/K assume target Index 2. Sample to refine the plan.');
  }
  if (phLow) {
    notes.push(`Soil pH ${field.ph?.toFixed(1)} is below the target ${profile.targetPh.toFixed(1)} for ${profile.label.toLowerCase()} — lime to lift it.`);
  }
  if (clubrootWarning) notes.push(clubrootWarning);
  if (sulphur) notes.push(sulphur);
  if (mg) notes.push(mg.note);
  if (na) notes.push(na);
  for (const m of micros) notes.push(`${m.nutrient}: ${m.note}`);
  if (pk.kLiftTopUpNote) notes.push(pk.kLiftTopUpNote);

  return {
    fieldId: field.id,
    fieldName: field.name,
    cropKey: profile.key,
    cropLabel: profile.label,
    category: profile.category,
    season: allocation.season,
    yieldT,
    yieldUnit: profile.yieldUnit,

    areaValue: area.value,
    areaUnit: area.unit,
    ha,
    sampled: field.sampled,

    nTarget: nT.n,
    nIsCeiling: nT.isCeiling,
    appliedN: Math.round(supply.n),
    nToApply,
    nStages: profile.nStages,
    totalNNote: profile.totalN,

    p2o5Target: pk.p2o5,
    k2oTarget: pk.k2o,
    appliedP: Math.round(supply.p),
    appliedK: Math.round(supply.k),
    p2o5ToApply,
    k2oToApply,
    pIndex: pk.pIndex,
    kIndex: pk.kIndex,
    pkBasis: pk.basis,

    supply,

    sns,
    targetPh: profile.targetPh,
    ph: field.ph,
    phNote: profile.phNote,
    phLow,
    mg,
    na,
    sulphur,
    micros,
    kLiftTopUpNote: pk.kLiftTopUpNote,
    clubrootWarning,

    evidence: profile.evidence,
    sources: profile.sources,
    notes,
  };
}
