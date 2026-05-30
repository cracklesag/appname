// =============================================================================
// Non-grass crop profiles — the knowledge base for the Crops area.
//
// Parallel to the grass engine: grass fields are unaffected by anything here.
// Figures are RB209-first, topped up with AHDB/PDA trial data where RB209 is
// thin, and each profile carries an evidence grade so the UI can be honest
// about how settled a default is. Magnesium and sodium live ONLY here (and in
// crop screens) — they are never surfaced on the grass side.
//
// Sources: RB209 Section 3 (grass/forage) & Section 4 (arable); AHDB maize and
// cereals guidance; PDA/Kingshay forage nutrient-removal work. Cereal grain N
// anchors: AHDB feed-crop trials (~185 kg N/ha wheat, ~162 kg N/ha barley),
// with RB209 driving rate by SNS index. P & K replace crop offtake at Index 2.
// =============================================================================

export type CropCategory = 'forage' | 'cereal_grain' | 'catch';

/** How settled the default is, so the UI can label it. */
export type EvidenceGrade = 'rb209' | 'rb209_plus_trial' | 'trial';

export interface CropNStage {
  label: string;
  timing: string;
  note?: string;
}

export interface CropOfftake {
  /** kg per unit of yield (see `basis`). N is optional — for cereals N rate is
   *  SNS-driven, not offtake-driven, so it's described in `totalN` instead. */
  n?: number;
  p2o5: number;
  k2o: number;
  mgo?: number;
  na2o?: number;
  basis: string;
}

export interface CropProfile {
  key: string;
  label: string;
  category: CropCategory;
  /** Default expected yield (numeric) and its unit/label. */
  yieldDefault: number;
  yieldUnit: string;        // 't DM/ha' | 't FW/ha' | 't grain/ha'
  yieldRange: string;       // human-readable range
  offtake: CropOfftake;
  /** Plain description of total N and how it's driven. */
  totalN: string;
  /** Stage-based N plan (replaces the grass per-cut model). */
  nStages: CropNStage[];
  targetPh: number;
  phNote?: string;
  soilFit: string;
  manureFit: string;
  needsMg?: boolean;
  needsNa?: boolean;
  evidence: EvidenceGrade;
  sources: string;
  summary: string;
}

export const EVIDENCE_LABEL: Record<EvidenceGrade, string> = {
  rb209: 'RB209',
  rb209_plus_trial: 'RB209 + trial data',
  trial: 'Trial-based estimate',
};

export const CATEGORY_LABEL: Record<CropCategory, string> = {
  forage: 'Forage crops',
  cereal_grain: 'Cereals for grain',
  catch: 'Catch crops',
};

export const CROP_PROFILES: CropProfile[] = [
  // ----- Forage crops -------------------------------------------------------
  {
    key: 'forage_maize',
    label: 'Forage maize',
    category: 'forage',
    yieldDefault: 12,
    yieldUnit: 't DM/ha',
    yieldRange: '10–16 t DM/ha',
    offtake: { n: 14.6, p2o5: 6.2, k2o: 24.3, basis: 'per t DM (measured forage trial)' },
    totalN:
      'RB209 SNS-based — typically ~80–150 kg N/ha, much of which can come from spring slurry. ' +
      'Place all the phosphate plus 10–15 kg N/ha in the seedbed below the seed, then top-dress the balance as the crop emerges.',
    nStages: [
      { label: 'Seedbed starter', timing: 'At drilling', note: 'All P₂O₅ + 10–15 kg N/ha placed below the seed' },
      { label: 'Early top-dress', timing: 'Crop emergence (2–6 leaf)', note: 'Balance of the nitrogen' },
    ],
    targetPh: 6.5,
    phNote: 'No lime needed above pH 6.5; maize struggles below about pH 5.0.',
    soilFit: 'Best on warm, medium-textured, free-draining ground. Poor on heavy, wet or compacted soils, and marginal on exposed western sites.',
    manureFit: 'Excellent spring slurry / FYM / digestate crop — but easy to overload P and K, so account for the manure nutrients.',
    needsMg: true,
    needsNa: false,
    evidence: 'rb209_plus_trial',
    sources: 'AHDB forage maize guide; PDA/AHDB forage nutrient-removal trial.',
    summary: 'A great manure crop, but field choice matters.',
  },
  {
    key: 'fodder_beet',
    label: 'Fodder beet',
    category: 'forage',
    yieldDefault: 16,
    yieldUnit: 't DM/ha (roots)',
    yieldRange: '50–100+ t fresh/ha roots',
    offtake: { n: 9, p2o5: 4.4, k2o: 24.9, mgo: 3.8, na2o: 7.5, basis: 'per t DM, roots only (PDA)' },
    totalN:
      'About 120–130 kg N/ha on light sandy soils, 100–120 kg N/ha on medium and heavier soils. ' +
      'Roughly 45 kg N/ha at drilling, then the balance in early May once the crop is established.',
    nStages: [
      { label: 'At drilling', timing: 'Sowing', note: '~45 kg N/ha' },
      { label: 'Balance', timing: 'Early May, once established', note: 'Remainder of the nitrogen' },
    ],
    targetPh: 6.8,
    phNote: 'Likes a high pH — broadly 6.5–7.0+.',
    soilFit: 'Needs deep, well-drained, free-draining light-to-medium soil and a fine but firm seedbed.',
    manureFit: 'Excellent slurry / FYM opportunity — but cap it so K and P don’t build above Index 3.',
    needsMg: true,
    needsNa: true,
    evidence: 'rb209_plus_trial',
    sources: 'RB209 Section 4; PDA fodder beet nutrient-removal leaflet.',
    summary: 'A high-K, high-Mg, often sodium-responsive root crop — K demand peaks fast in midsummer.',
  },

  // ----- Cereals for grain --------------------------------------------------
  {
    key: 'cereal_wheat',
    label: 'Winter / spring wheat (grain)',
    category: 'cereal_grain',
    yieldDefault: 10,
    yieldUnit: 't grain/ha',
    yieldRange: 'Winter ~10.4, spring ~7.5 t/ha',
    offtake: { p2o5: 7.8, k2o: 5.6, basis: 'per t grain at 85% DM (grain only). Removing straw adds ~1.5 kg P₂O₅ and ~9–10 kg K₂O per tonne of straw (~0.5 t straw per t grain).' },
    totalN:
      'RB209 Section 4, driven by your SNS index. Feed wheat commonly works out around ~185 kg N/ha total ' +
      '(AHDB trials), split early-spring → stem extension → flag leaf. Add nitrogen for milling, and adjust down at higher SNS.',
    nStages: [
      { label: 'Early spring', timing: 'GS25–30 (tillering)', note: 'First split' },
      { label: 'Stem extension', timing: 'GS30–32', note: 'Main dressing' },
      { label: 'Flag leaf', timing: 'GS37–39', note: 'Final split / grain quality' },
    ],
    targetPh: 6.5,
    phNote: 'Prefers a well-limed seedbed around pH 6.5.',
    soilFit: 'Fertile, well-drained clay and loam.',
    manureFit: 'Moderate — autumn or early-spring organics, watching nitrogen timing.',
    evidence: 'rb209',
    sources: 'RB209 Section 4; AHDB feed-wheat N optimisation trials.',
    summary: 'Feed wheat ~185 kg N/ha; P and K replace grain (and straw) offtake.',
  },
  {
    key: 'cereal_barley',
    label: 'Winter / spring barley (grain)',
    category: 'cereal_grain',
    yieldDefault: 7.5,
    yieldUnit: 't grain/ha',
    yieldRange: 'Winter ~9.4, spring ~7.4 t/ha',
    offtake: { p2o5: 7.8, k2o: 5.6, basis: 'per t grain at 85% DM (grain only); straw removal adds potash as for wheat.' },
    totalN:
      'RB209 Section 4 by SNS index. Feed barley commonly works out around ~162 kg N/ha total (AHDB trials); ' +
      'winter barley needs more than spring. Keep the early split firm — barley sets yield early.',
    nStages: [
      { label: 'Early spring', timing: 'GS25–30', note: 'Firm first split' },
      { label: 'Stem extension', timing: 'GS30–31', note: 'Balance of nitrogen' },
    ],
    targetPh: 6.2,
    phNote: 'Barley is sensitive to low pH — keep at or above pH 6.2 (up to 7.0 is justified).',
    soilFit: 'Grows well on lighter soils and loams, but punishes acidity.',
    manureFit: 'Moderate; spring organics fit spring barley well.',
    evidence: 'rb209',
    sources: 'RB209 Section 4; AHDB feed-barley N optimisation trials.',
    summary: 'Feed barley ~162 kg N/ha; pH-sensitive — keep the lime up.',
  },
  {
    key: 'cereal_oats',
    label: 'Winter / spring oats (grain)',
    category: 'cereal_grain',
    yieldDefault: 8,
    yieldUnit: 't grain/ha',
    yieldRange: 'Winter ~8.4, spring ~8.2 t/ha',
    offtake: { p2o5: 7.8, k2o: 5.6, basis: 'per t grain at 85% DM (grain only); straw is potash-rich if removed.' },
    totalN:
      'RB209 Section 4 (oats now have their own N economics table). Generally lower N than wheat — push it too hard and oats lodge.',
    nStages: [
      { label: 'Early spring', timing: 'GS25–30', note: 'First split' },
      { label: 'Stem extension', timing: 'GS30–31', note: 'Balance — keep modest to avoid lodging' },
    ],
    targetPh: 5.8,
    phNote: 'The most acid-tolerant cereal — grows down to about pH 5.5.',
    soilFit: 'Tolerant of a range of soils and lower pH than wheat or barley.',
    manureFit: 'Moderate; tolerant crop, fits organics reasonably.',
    evidence: 'rb209',
    sources: 'RB209 Section 4 (oats N table).',
    summary: 'A lower-N, acid-tolerant cereal — mind lodging.',
  },

  // Wholecrop cereals (cut whole for forage) ---------------------------------
  {
    key: 'wholecrop_wheat',
    label: 'Wholecrop wheat',
    category: 'forage',
    yieldDefault: 11,
    yieldUnit: 't DM/ha',
    yieldRange: '10–12 t DM/ha (winter)',
    offtake: { n: 12.6, p2o5: 4.8, k2o: 14.7, basis: 'per t DM (measured). RB209 uses a generic wholecrop-cereal P/K basis — about 55 kg P₂O₅ and 160 kg K₂O/ha at Index 2 for a 30 t fresh/ha crop.' },
    totalN:
      'Uses the grain-wheat N table (winter or spring) because it’s cut late — early-spring nitrogen then a GS30–32 top-up.',
    nStages: [
      { label: 'Early spring', timing: 'GS25–30', note: 'First split' },
      { label: 'Stem extension', timing: 'GS30–32', note: 'Top-up' },
    ],
    targetPh: 6.5,
    soilFit: 'As for wheat — fertile, well-drained clay and loam.',
    manureFit: 'Good with planned spring organics.',
    evidence: 'rb209',
    sources: 'RB209 Section 3 (wholecrop) & Section 4 (wheat N); AHDB/PDA forage trial.',
    summary: 'Wholecrop wheat uses grain-wheat nitrogen logic.',
  },
  {
    key: 'wholecrop_barley',
    label: 'Wholecrop barley',
    category: 'forage',
    yieldDefault: 11,
    yieldUnit: 't DM/ha',
    yieldRange: '10–13 winter / 8–11 spring t DM/ha',
    offtake: { n: 12, p2o5: 4.8, k2o: 14.7, basis: 'per t DM (generic wholecrop-cereal basis).' },
    totalN:
      'Winter- or spring-barley RB209 table by sowing season. Keep the early barley nitrogen split firm.',
    nStages: [
      { label: 'Early spring', timing: 'GS25–30', note: 'Firm first split' },
      { label: 'Stem extension', timing: 'GS30–31', note: 'Balance' },
    ],
    targetPh: 6.2,
    phNote: 'Barley is sensitive to low pH — keep at or above pH 6.2.',
    soilFit: 'Lighter soils and loams; pH-sensitive.',
    manureFit: 'Good in spring-drilled systems.',
    evidence: 'rb209',
    sources: 'RB209 Section 3 (wholecrop) & Section 4 (barley N).',
    summary: 'Switch winter/spring table by sowing; keep the first N split firm.',
  },
  {
    key: 'wholecrop_oats',
    label: 'Wholecrop oats / rye / triticale',
    category: 'forage',
    yieldDefault: 10,
    yieldUnit: 't DM/ha',
    yieldRange: '8–12 t DM/ha',
    offtake: { n: 12, p2o5: 4.8, k2o: 14.7, basis: 'per t DM (generic wholecrop-cereal basis).' },
    totalN:
      'Spring oats, rye and triticale share a spring N table. Keep splits sensible to avoid lodging.',
    nStages: [
      { label: 'Early spring', timing: 'GS25–30', note: 'First split' },
      { label: 'Stem extension', timing: 'GS30–31', note: 'Balance' },
    ],
    targetPh: 5.8,
    phNote: 'Oats tolerate more acidity — down to about pH 5.5.',
    soilFit: 'Tolerant of a range of soils.',
    manureFit: 'Good in spring-drilled systems.',
    evidence: 'rb209',
    sources: 'RB209 Section 3 (wholecrop) & Section 4 (spring cereals N).',
    summary: 'Acid-tolerant; uses the generic wholecrop P and K basis.',
  },

  // ----- Catch crops --------------------------------------------------------
  {
    key: 'italian_ryegrass',
    label: 'Italian ryegrass (catch crop)',
    category: 'catch',
    yieldDefault: 14,
    yieldUnit: 't DM/ha',
    yieldRange: '10–15 t DM/ha',
    offtake: { n: 22, p2o5: 7.9, k2o: 36.8, basis: 'per t DM (Kingshay/PDA trial average).' },
    totalN:
      'Manage like intensive silage grass — silage-style N timing with generous totals across the growing window.',
    nStages: [
      { label: 'First dressing', timing: 'At establishment / early growth', note: 'Get nitrogen on early' },
      { label: 'Per-cut top-ups', timing: 'After each cut', note: 'Replace what the cut removed' },
    ],
    targetPh: 6.2,
    soilFit: 'Fast-growing and hungry; suffers badly if potash runs short.',
    manureFit: 'A very good slurry / FYM user if the timing is right.',
    needsMg: false,
    needsNa: false,
    evidence: 'trial',
    sources: 'Kingshay/PDA forage-crop nutrient-removal work (cited in AHDB’s RB209 Section 3 review).',
    summary: 'Treat it as intensive silage grass — fast and very potash-hungry.',
  },
];

export function getCropProfile(key: string): CropProfile | undefined {
  return CROP_PROFILES.find((c) => c.key === key);
}

/** Profiles grouped by category, in display order. */
export function cropProfilesByCategory(): { category: CropCategory; label: string; crops: CropProfile[] }[] {
  const order: CropCategory[] = ['forage', 'cereal_grain', 'catch'];
  return order
    .map((category) => ({
      category,
      label: CATEGORY_LABEL[category],
      crops: CROP_PROFILES.filter((c) => c.category === category),
    }))
    .filter((g) => g.crops.length > 0);
}
