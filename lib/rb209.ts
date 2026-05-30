// =====================================================================
// lib/rb209.ts — RB209 Section 3 (Grass & forage), June 2023 edition
// =====================================================================
//
// Single source of truth for the published RB209 phosphate, potash and
// nitrogen recommendation figures. Every number here was transcribed and
// independently verified against the official AHDB PDF:
//   "Nutrient Management Guide (RB209), Section 3, Updated June 2023"
//   https://projectblue.blob.core.windows.net/media/Default/...
//                          .../RB209/2023/NutManGuideRB209S3_230526_WEB.pdf
//
// Design notes for maintainers / future API swap:
//   * Recommendations are PUBLISHED PER INDEX. RB209 states all values are for
//     "the midpoint of each Index (midpoint of 2- for potash)". They are NOT
//     points on a continuous curve and must NOT be linearly interpolated for
//     the official recommendation. We expose the underlying mg/L separately so
//     the UI can show within-band position, but the engine recommendation uses
//     the banded value.
//   * Potash index 2 SPLITS into 2- and 2+. The K tables therefore have SIX
//     index columns: 0, 1, '2-', '2+', 3, 4+. Storing K as five columns would
//     shift the 2+ values into index 3 and corrupt recommendations.
//   * Tables give the TOTAL nutrient required. Nutrients supplied by organic
//     materials (slurry/manure) must be DEDUCTED — handled by the engine, not
//     here.
//   * All P values are kg/ha P2O5. All K values are kg/ha K2O. N is kg/ha N.

// ---------------------------------------------------------------------
// Index types
// ---------------------------------------------------------------------

/** P/Mg indices are whole numbers; K additionally splits 2 into 2-/2+. */
export type PIndex = 0 | 1 | 2 | 3 | 4; // 4 = "4 and higher"
export type KIndexBand = 0 | 1 | '2-' | '2+' | 3 | 4; // 4 = "4 and higher"

// ---------------------------------------------------------------------
// Table 3.1 — Classification of soil analysis (mg/L) into Indices
// Used to convert a lab mg/L result into an index, AND to report where in
// the band a value sits (for the UI's within-band display).
// ---------------------------------------------------------------------

/** [minInclusive, maxInclusive] mg/L for each band. Upper of top band = Infinity. */
export const P_INDEX_BANDS: Array<{ index: PIndex | number; min: number; max: number }> = [
  { index: 0, min: 0,   max: 9 },
  { index: 1, min: 10,  max: 15 },
  { index: 2, min: 16,  max: 25 },
  { index: 3, min: 26,  max: 45 },
  { index: 4, min: 46,  max: 70 },
  { index: 5, min: 71,  max: 100 },
  { index: 6, min: 101, max: 140 },
  { index: 7, min: 141, max: 200 },
  { index: 8, min: 201, max: 280 },
  { index: 9, min: 281, max: Infinity },
];

/** K bands, with 2 split into 2- (121–180) and 2+ (181–240). */
export const K_INDEX_BANDS: Array<{ band: KIndexBand | number; label: string; min: number; max: number }> = [
  { band: 0,    label: '0',  min: 0,    max: 60 },
  { band: 1,    label: '1',  min: 61,   max: 120 },
  { band: '2-', label: '2-', min: 121,  max: 180 },
  { band: '2+', label: '2+', min: 181,  max: 240 },
  { band: 3,    label: '3',  min: 241,  max: 400 },
  { band: 4,    label: '4',  min: 401,  max: 600 },
  { band: 5,    label: '5',  min: 601,  max: 900 },
  { band: 6,    label: '6',  min: 901,  max: 1500 },
  { band: 7,    label: '7',  min: 1501, max: 2400 },
  { band: 8,    label: '8',  min: 2401, max: 3600 },
  { band: 9,    label: '9',  min: 3601, max: Infinity },
];

export const MG_INDEX_BANDS: Array<{ index: number; min: number; max: number }> = [
  { index: 0, min: 0,    max: 25 },
  { index: 1, min: 26,   max: 50 },
  { index: 2, min: 51,   max: 100 },
  { index: 3, min: 101,  max: 175 },
  { index: 4, min: 176,  max: 250 },
  { index: 5, min: 251,  max: 350 },
  { index: 6, min: 351,  max: 600 },
  { index: 7, min: 601,  max: 1000 },
  { index: 8, min: 1001, max: 1500 },
  { index: 9, min: 1501, max: Infinity },
];

// ---------------------------------------------------------------------
// Target indices (from the grassland recommendations narrative, not a table)
// ---------------------------------------------------------------------

export const TARGET_P_INDEX = 2;
/** Potash target is the lower half of index 2. */
export const TARGET_K_BAND: KIndexBand = '2-';
export const TARGET_MG_INDEX = 2;

// ---------------------------------------------------------------------
// Table 3.3 — Phosphate & potash recommendations for grass silage
// Benchmark yields: 1st 23, 2nd 15, 3rd 9, 4th 7 t FW/ha (wilted 25% DM).
// 'M' marks the maintenance (target-index) column in the source.
// ---------------------------------------------------------------------

export type SilageCut = 1 | 2 | 3 | 4;

/** Benchmark fresh-weight yields per cut (t FW/ha) that the table is calibrated to. */
export const SILAGE_BENCHMARK_FW_YIELD: Record<SilageCut, number> = {
  1: 23, 2: 15, 3: 9, 4: 7,
};

/** Phosphate (kg/ha P2O5) by cut, indexed [P index 0..4]. */
export const SILAGE_P: Record<SilageCut, Record<PIndex, number>> = {
  1: { 0: 100, 1: 70, 2: 40, 3: 20, 4: 0 },
  2: { 0: 25,  1: 25, 2: 25, 3: 0,  4: 0 },
  3: { 0: 15,  1: 15, 2: 15, 3: 0,  4: 0 },
  4: { 0: 10,  1: 10, 2: 10, 3: 0,  4: 0 },
};

/** Potash (kg/ha K2O) by cut, by six-column K band. First cut splits into
 *  a previous-autumn dressing and a spring dressing. */
export const SILAGE_K: Record<SilageCut, Record<KIndexBand, number>> = {
  // First cut SPRING values (see SILAGE_K_FIRST_CUT_AUTUMN for autumn split)
  1: { 0: 80,  1: 80,  '2-': 80, '2+': 60, 3: 30, 4: 0 },
  2: { 0: 120, 1: 100, '2-': 90, '2+': 60, 3: 40, 4: 0 },
  3: { 0: 80,  1: 80,  '2-': 80, '2+': 40, 3: 20, 4: 0 },
  4: { 0: 70,  1: 70,  '2-': 70, '2+': 40, 3: 20, 4: 0 },
};

/** First-cut potash that RB209 says to apply the PREVIOUS AUTUMN (Table 3.3). */
export const SILAGE_K_FIRST_CUT_AUTUMN: Record<KIndexBand, number> = {
  0: 60, 1: 30, '2-': 0, '2+': 0, 3: 0, 4: 0,
};

/**
 * Spring potash cap for the first cut, to minimise luxury uptake. No more than
 * this should go on in spring; the balance goes in the previous autumn.
 * RB209 states 80–90 kg/ha; we use the lower bound as the conservative cap.
 */
export const FIRST_CUT_SPRING_K_CAP = 80;

// ---------------------------------------------------------------------
// Table 3.4 — Phosphate & potash for grazed swards
// NOTE: the published table stops at Index 3 (no 4+ column). We extend 4+ = 0
// as an engine convention (already 0 at index 3).
// ---------------------------------------------------------------------

export const GRAZING_P: Record<PIndex, number> = { 0: 80, 1: 50, 2: 20, 3: 0, 4: 0 };
export const GRAZING_K: Record<KIndexBand, number> = {
  0: 60, 1: 30, '2-': 0, '2+': 0, 3: 0, 4: 0,
};

// ---------------------------------------------------------------------
// Table 3.5 — Phosphate & potash for hay
// ---------------------------------------------------------------------

export const HAY_P: Record<PIndex, number> = { 0: 80, 1: 55, 2: 30, 3: 0, 4: 0 };
export const HAY_K: Record<KIndexBand, number> = {
  0: 140, 1: 115, '2-': 90, '2+': 65, 3: 20, 4: 0,
};

// ---------------------------------------------------------------------
// Catch-up potash after cutting (Table 3.3 narrative).
// Triggered at soil K index 2+ or below. By cut-count system.
// ---------------------------------------------------------------------

/** Extra K2O kg/ha to apply after cutting, keyed by number of cuts in the system. */
export const EXTRA_K_AFTER_CUTTING: Record<number, number> = {
  1: 60, // one- or two-cut: +60 after last cut / by autumn
  2: 60,
  3: 30, // three-cut: +30 after cutting
  4: 0,  // four-cut: none
};

// ---------------------------------------------------------------------
// Table 3.2 — Phosphate & potash in crop material (offtake per t fresh)
// For yield-adjusting the recommendations. No 18% DM silage row exists;
// fresh grass 15–20% DM is the nearest official proxy.
// ---------------------------------------------------------------------

export interface OfftakeRow { label: string; p2o5PerT: number; k2oPerT: number; }
export const OFFTAKE_BY_MATERIAL: Record<string, OfftakeRow> = {
  fresh_grass:   { label: 'Fresh grass (15–20% DM)', p2o5PerT: 1.4, k2oPerT: 4.8 },
  silage_25:     { label: 'Silage (25% DM)',         p2o5PerT: 1.7, k2oPerT: 6.0 },
  silage_30:     { label: 'Silage (30% DM)',         p2o5PerT: 2.1, k2oPerT: 7.2 },
  hay_86:        { label: 'Hay (86% DM)',            p2o5PerT: 5.9, k2oPerT: 18.0 },
  haylage_45:    { label: 'Haylage (45% DM)',        p2o5PerT: 3.2, k2oPerT: 10.5 },
};

// ---------------------------------------------------------------------
// Nitrogen — Table 3.8 (silage), 3.9 (grazing), 3.10 (hay)
// Baseline values assume MODERATE SNS. Adjust per the SNS rules.
// ---------------------------------------------------------------------

export type SNSStatus = 'low' | 'moderate' | 'high';

/** Table 3.8 — silage N per cut, keyed by a target annual DM yield band. */
export interface SilageNRow { label: string; perCut: number[]; total: number; }
export const SILAGE_N_BY_YIELD: SilageNRow[] = [
  { label: '5–7 t/ha',    perCut: [70],            total: 70 },
  { label: '7–9 t/ha',    perCut: [80, 50],        total: 130 },
  { label: '9–12 t/ha',   perCut: [100, 75, 75],   total: 250 },
  { label: '12–15+ t/ha', perCut: [120, 90, 70, 30], total: 310 },
];

/** Table 3.9 — grazing total N by indicative DM yield band. */
export interface GrazingNRow { label: string; total: number; }
export const GRAZING_N_BY_YIELD: GrazingNRow[] = [
  { label: '4–5 t/ha',    total: 30 },
  { label: '5–7 t/ha',    total: 50 },
  { label: '6–8 t/ha',    total: 80 },
  { label: '7–9 t/ha',    total: 130 },
  { label: '9–12 t/ha',   total: 180 },
  { label: '10–13 t/ha',  total: 230 },
  { label: '12–15+ t/ha', total: 270 },
];

/** Table 3.10 — hay N per cut by SNS status. */
export const HAY_N_BY_SNS: Record<SNSStatus, number> = { low: 100, moderate: 70, high: 40 };

/** SNS adjustment to TOTAL fertiliser N (kg/ha): +30 low, 0 moderate, −30 high. */
export const SNS_TOTAL_N_ADJUST: Record<SNSStatus, number> = { low: 30, moderate: 0, high: -30 };

// =====================================================================
// Lookup functions
// =====================================================================

function lookupBand<T extends { min: number; max: number }>(
  bands: T[], mgPerL: number,
): T | null {
  for (const b of bands) {
    if (mgPerL >= b.min && mgPerL <= b.max) return b;
  }
  return null;
}

/** Convert a P mg/L lab result into an index (0–9). */
export function pIndexFromMgL(mgPerL: number | null | undefined): number | null {
  if (mgPerL == null) return null;
  return lookupBand(P_INDEX_BANDS, mgPerL)?.index ?? null;
}

/** Convert a K mg/L lab result into a band (0,1,'2-','2+',3,...). */
export function kBandFromMgL(mgPerL: number | null | undefined): KIndexBand | number | null {
  if (mgPerL == null) return null;
  return lookupBand(K_INDEX_BANDS, mgPerL)?.band ?? null;
}

export function mgIndexFromMgL(mgPerL: number | null | undefined): number | null {
  if (mgPerL == null) return null;
  return lookupBand(MG_INDEX_BANDS, mgPerL)?.index ?? null;
}

/**
 * Where within its band a value sits, 0..1 (0 = bottom of band, 1 = top).
 * Used by the UI to show "near top of band, trending toward 2+" without
 * interpolating the recommendation. Returns null for the open-topped band.
 */
export function bandPosition(mgPerL: number, min: number, max: number): number | null {
  if (!isFinite(max)) return null;
  if (max <= min) return null;
  const pos = (mgPerL - min) / (max - min);
  return Math.max(0, Math.min(1, pos));
}

/** Clamp a P index to the 0..4 range the recommendation tables use (4 = "4+"). */
export function pRecIndex(index: number | null | undefined): PIndex {
  if (index == null) return 2; // unknown → assume target (maintenance)
  if (index <= 0) return 0;
  if (index >= 4) return 4;
  return index as PIndex;
}

/** Map a K band/index to the recommendation table's six columns. */
export function kRecBand(band: KIndexBand | number | null | undefined): KIndexBand {
  if (band == null) return '2-'; // unknown → assume target (maintenance)
  if (band === '2-' || band === '2+') return band;
  const n = typeof band === 'number' ? band : parseInt(String(band), 10);
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (n === 2) return '2-'; // a bare "2" with no split info → conservative lower half
  if (n === 3) return 3;
  return 4; // 4 and higher
}

export interface PKRecommendation {
  /** kg/ha P2O5 the table says to apply for this cut/use at this index. */
  p2o5: number;
  /** kg/ha K2O total for this cut/use at this band. */
  k2o: number;
  /** For silage first cut: how the K splits across autumn + spring. */
  kSplit?: { previousAutumn: number; spring: number; springCapped: boolean };
  /** True at the maintenance (target) index. */
  atMaintenance: boolean;
}

/**
 * Phosphate & potash recommendation for a SILAGE cut.
 * cutNumber is 1-based within the season. cutsInSystem drives catch-up K.
 */
export function silageRecommendation(
  cutNumber: number,
  pIndex: number | null,
  kBand: KIndexBand | number | null,
): PKRecommendation {
  const cut = (Math.max(1, Math.min(4, cutNumber)) as SilageCut);
  const pi = pRecIndex(pIndex);
  const kb = kRecBand(kBand);

  const p2o5 = SILAGE_P[cut][pi];
  const kTotal = SILAGE_K[cut][kb];

  const rec: PKRecommendation = {
    p2o5,
    k2o: kTotal,
    atMaintenance: pi === TARGET_P_INDEX || kb === TARGET_K_BAND,
  };

  // First cut: RB209 caps spring K at 80–90 kg/ha; balance goes previous autumn.
  if (cut === 1) {
    const autumn = SILAGE_K_FIRST_CUT_AUTUMN[kb];
    // Spring value from table; if it exceeds the cap, the surplus shifts to autumn.
    const springTable = SILAGE_K[1][kb];
    const springCapped = springTable > FIRST_CUT_SPRING_K_CAP;
    const spring = Math.min(springTable, FIRST_CUT_SPRING_K_CAP);
    const extraToAutumn = springTable - spring;
    rec.k2o = autumn + extraToAutumn + spring;
    rec.kSplit = { previousAutumn: autumn + extraToAutumn, spring, springCapped };
  }

  return rec;
}

/** Phosphate & potash recommendation for GRAZING. */
export function grazingRecommendation(
  pIndex: number | null,
  kBand: KIndexBand | number | null,
): PKRecommendation {
  const pi = pRecIndex(pIndex);
  const kb = kRecBand(kBand);
  return {
    p2o5: GRAZING_P[pi],
    k2o: GRAZING_K[kb],
    atMaintenance: pi === TARGET_P_INDEX || kb === TARGET_K_BAND,
  };
}

/** Phosphate & potash recommendation for HAY. */
export function hayRecommendation(
  pIndex: number | null,
  kBand: KIndexBand | number | null,
): PKRecommendation {
  const pi = pRecIndex(pIndex);
  const kb = kRecBand(kBand);
  return {
    p2o5: HAY_P[pi],
    k2o: HAY_K[kb],
    atMaintenance: pi === TARGET_P_INDEX || kb === TARGET_K_BAND,
  };
}

/**
 * Yield-adjust a P or K recommendation when the actual cut yield differs from
 * the table benchmark. RB209: "applications should be adjusted where yields
 * are likely to be greater or smaller" using the per-tonne offtake (Table 3.2).
 * The maintenance portion scales with offtake; we apply a simple proportional
 * adjustment on the table value by the ratio of actual:benchmark fresh yield.
 * Returns the adjusted kg/ha, never below zero.
 */
export function yieldAdjust(
  tableValue: number,
  actualFwYield: number,
  benchmarkFwYield: number,
): number {
  if (!benchmarkFwYield || actualFwYield <= 0) return tableValue;
  const adj = tableValue * (actualFwYield / benchmarkFwYield);
  return Math.max(0, Math.round(adj));
}

/** Extra catch-up K2O after cutting, by number of cuts in the system, applied
 *  only when soil K is at index 2+ or below. */
export function extraKAfterCutting(cutsInSystem: number, kBand: KIndexBand | number | null): number {
  const kb = kRecBand(kBand);
  // 2+ or below: applies at 0,1,2-,2+. Not at 3 or 4.
  const atOrBelow2Plus = kb === 0 || kb === 1 || kb === '2-' || kb === '2+';
  if (!atOrBelow2Plus) return 0;
  return EXTRA_K_AFTER_CUTTING[Math.max(1, Math.min(4, cutsInSystem))] ?? 0;
}

/** Silage N for a given target DM yield band index, with SNS adjustment on total. */
export function silageNForYield(yieldRowIndex: number, sns: SNSStatus): SilageNRow & { adjustedTotal: number } {
  const row = SILAGE_N_BY_YIELD[Math.max(0, Math.min(SILAGE_N_BY_YIELD.length - 1, yieldRowIndex))];
  return { ...row, adjustedTotal: Math.max(0, row.total + SNS_TOTAL_N_ADJUST[sns]) };
}

// ---------------------------------------------------------------------
// Field-level nitrogen recommendation (per cut)
// ---------------------------------------------------------------------
//
// RB209 N logic differs from P/K: it's driven by target DM yield (which sets
// the per-cut table row) and SNS status (which adjusts the rate). For silage,
// the SNS adjustment is PER CUT, not a flat total: high SNS = −10 first cut /
// −20 second cut; low SNS = +10 first cut / +20 second cut (Table 3.8 notes).
// Grazing and hay use simpler whole-season / per-cut adjustments.

/** Map a silage cut system (number of cuts) to the Table 3.8 yield row index. */
export function silageYieldRowForCutCount(cutCount: number): number {
  // 1-cut→5-7t(row0), 2-cut→7-9t(row1), 3-cut→9-12t(row2), 4-cut→12-15t(row3)
  return Math.max(0, Math.min(3, cutCount - 1));
}

/**
 * Silage N for ONE specific cut, with the per-cut SNS adjustment applied.
 * cutNumber is 1-based. Returns kg/ha N for that cut (never below zero).
 */
export function silageNForCut(cutCount: number, cutNumber: number, sns: SNSStatus): number {
  const row = SILAGE_N_BY_YIELD[silageYieldRowForCutCount(cutCount)];
  const base = row.perCut[cutNumber - 1] ?? 0;
  if (base === 0) return 0;
  // Per-cut SNS adjustment (Table 3.8 notes).
  let adj = 0;
  if (cutNumber === 1) adj = sns === 'high' ? -10 : sns === 'low' ? 10 : 0;
  else if (cutNumber === 2) adj = sns === 'high' ? -20 : sns === 'low' ? 20 : 0;
  return Math.max(0, base + adj);
}

/** Map a grazing system to a Table 3.9 yield row index from target DM yield (t/ha). */
export function grazingYieldRow(targetDmYield: number): number {
  // Find the closest band by upper bound.
  const uppers = [5, 7, 8, 9, 12, 13, 15];
  for (let i = 0; i < uppers.length; i++) if (targetDmYield <= uppers[i]) return i;
  return uppers.length - 1;
}

/** Total grazing N for the season at a target DM yield, with whole-season SNS ±30. */
export function grazingNTotal(targetDmYield: number, sns: SNSStatus): number {
  const row = GRAZING_N_BY_YIELD[grazingYieldRow(targetDmYield)];
  return Math.max(0, row.total + SNS_TOTAL_N_ADJUST[sns]);
}

/** Hay N per cut by SNS (Table 3.10). */
export function hayNForCut(sns: SNSStatus): number {
  return HAY_N_BY_SNS[sns];
}

// ---------------------------------------------------------------------
// Decimal-index bridge
// ---------------------------------------------------------------------
//
// The app stores P/K as a DECIMAL index (e.g. 2.5), not mg/L — that's how the
// soil form already captures it. These helpers map that decimal onto the RB209
// recommendation bands, including the K 2-/2+ split:
//   * P decimal index → nearest whole band 0..4 (4 = "4 and higher").
//   * K decimal index → 0,1,'2-','2+',3,4 where 2.0–2.49 → 2-, 2.5–2.99 → 2+.
//
// This is an app convention (RB209 itself bands mg/L, not the index), but it
// lets the engine honour the extra precision the user already enters without a
// schema migration to mg/L.

/** Map a decimal P index (e.g. 2.4) to a recommendation band 0..4. */
export function pBandFromDecimal(idx: number | null | undefined): PIndex {
  if (idx == null) return TARGET_P_INDEX;
  const r = Math.round(idx);
  if (r <= 0) return 0;
  if (r >= 4) return 4;
  return r as PIndex;
}

/** Map a decimal K index (e.g. 2.6) to a recommendation band incl. 2-/2+. */
export function kBandFromDecimal(idx: number | null | undefined): KIndexBand {
  if (idx == null) return TARGET_K_BAND;
  if (idx < 0.5) return 0;
  if (idx < 1.5) return 1;
  if (idx < 2.5) return '2-';   // 1.5–2.49 → lower half of index 2
  if (idx < 3.0) return '2+';   // 2.5–2.99 → upper half of index 2
  if (idx < 3.5) return 3;
  return 4;
}

/** Human label for where a decimal index sits relative to the target band. */
export function kBandLabel(band: KIndexBand): string {
  return String(band);
}

// ============================================================
// LIME — RB209 soil acidity / liming (grassland)
// Source: RB209 + AHDB "Soil pH and liming recommendations".
// Grassland lime is for a 15 cm soil depth; recommendations assume
// ground limestone / chalk (NV 50–55). All figures are an ESTIMATE to
// guide spreading — sense-check against a current soil report.
// ============================================================

/** Optimum grassland soil pH by broad soil category (RB209 Table 1). */
export type LimeSoilCategory = 'mineral' | 'organic' | 'peaty';

/** Optimum pH for continuous grass / grass-clover swards. */
export const GRASS_OPTIMUM_PH: Record<LimeSoilCategory, number> = {
  mineral: 6.0,
  organic: 5.7,
  peaty: 5.3,
};

/** RB209 advises aiming 0.2 pH above optimum — this is the default target. */
export const GRASS_TARGET_PH: Record<LimeSoilCategory, number> = {
  mineral: 6.2,
  organic: 5.9,
  peaty: 5.5,
};

/**
 * Grassland liming factors (t/ha of ground limestone per 1.0 pH unit) by soil
 * type, from AHDB Table 2b. Lime requirement = (target − measured) × factor.
 */
export const GRASS_LIMING_FACTOR: Record<string, number> = {
  sands: 4,          // sands and loamy sands
  loams: 5,          // sandy loams and silt loams
  clays: 6,          // clay loams and clays
  organic: 7.5,
  peaty: 12,
};

/** Never recommend liming above this pH (trace-element lock-up risk). */
export const LIME_MAX_PH = 7.0;

/** Max lime in a single application on grassland (no cultivation) — t/ha.
 *  Anything above this is split, the balance applied the following year. */
export const LIME_MAX_SINGLE_THA = 7.5;

/**
 * Soil magnesium index thresholds. At Index 0–1, magnesian (dolomitic)
 * limestone is the cost-effective way to lift both pH and Mg; at Index 2+,
 * ordinary calcium limestone. RB209 maintains soil Mg at Index 2.
 */
export function mgIndexFromDecimal(idx: number | null | undefined): number | null {
  if (idx == null) return null;
  if (idx < 0) return 0;
  if (idx > 9) return 9;
  return Math.round(idx);
}

export type LimeType = 'magnesian' | 'calcium';

/** Choose lime type from soil Mg index: low Mg (0–1) → magnesian. */
export function limeTypeForMg(mgIdx: number | null | undefined): LimeType {
  const m = mgIndexFromDecimal(mgIdx);
  if (m == null) return 'calcium';      // no Mg data → default calcium
  return m <= 1 ? 'magnesian' : 'calcium';
}

export interface LimeRecommendation {
  needsLime: boolean;
  measuredPh: number | null;
  targetPh: number;
  /** Total lime requirement, t/ha (0 if at/above target). */
  totalTha: number;
  /** Dressings to apply, t/ha each — 1 entry if ≤ max, else split over years. */
  dressings: number[];
  limeType: LimeType;
  /** Why no lime / any caveat (e.g. already at target, above pH 7). */
  note: string | null;
}

/**
 * RB209 grassland lime recommendation for a field.
 * @param measuredPh  current soil pH (null = unsampled)
 * @param targetPh    target pH (caller resolves from soil category / settings)
 * @param limingFactor t/ha per 1.0 pH (from GRASS_LIMING_FACTOR by soil type)
 * @param mgIdx       soil magnesium index (decimal) for lime-type choice
 * @param stonePct    optional stone % to discount the rate (0–100)
 */
export function limeRecommendation(
  measuredPh: number | null,
  targetPh: number,
  limingFactor: number,
  mgIdx: number | null | undefined,
  stonePct = 0,
): LimeRecommendation {
  const limeType = limeTypeForMg(mgIdx);

  if (measuredPh == null) {
    return {
      needsLime: false, measuredPh: null, targetPh,
      totalTha: 0, dressings: [], limeType,
      note: 'Not sampled — no pH on record.',
    };
  }
  if (measuredPh >= targetPh) {
    return {
      needsLime: false, measuredPh, targetPh,
      totalTha: 0, dressings: [], limeType,
      note: 'At or above target pH.',
    };
  }
  if (measuredPh >= LIME_MAX_PH) {
    return {
      needsLime: false, measuredPh, targetPh,
      totalTha: 0, dressings: [], limeType,
      note: 'Above pH 7 — do not lime (trace-element lock-up).',
    };
  }

  const deficit = targetPh - measuredPh;
  let tha = deficit * limingFactor;
  if (stonePct > 0) tha *= (1 - Math.min(95, stonePct) / 100);
  tha = Math.round(tha * 10) / 10;   // 0.1 t/ha precision

  // Split into yearly dressings if over the single-application cap.
  const dressings: number[] = [];
  let remaining = tha;
  while (remaining > LIME_MAX_SINGLE_THA + 0.05) {
    dressings.push(LIME_MAX_SINGLE_THA);
    remaining = Math.round((remaining - LIME_MAX_SINGLE_THA) * 10) / 10;
  }
  if (remaining > 0.05) dressings.push(remaining);

  return {
    needsLime: tha > 0.05, measuredPh, targetPh,
    totalTha: tha, dressings, limeType,
    note: dressings.length > 1
      ? `Split over ${dressings.length} years — max ${LIME_MAX_SINGLE_THA} t/ha per dressing on grassland.`
      : null,
  };
}
