// =============================================================================
// Non-grass crop profiles — the knowledge base for the Crops area.
//
// Parallel to the grass engine: grass fields are unaffected by anything here.
// Figures are RB209-first, topped up with AHDB/PDA trial data where RB209 is
// thin, and each profile carries an evidence grade so the UI can be honest
// about how settled a default is. Magnesium and sodium live ONLY here (and in
// crop screens) — they are never surfaced on the grass side. Sulphur and
// micronutrients (e.g. boron for swede) follow the SAME containment: present
// in the crop section only, designed to spread app-wide later.
//
// Sources: RB209 Section 3 (grass/forage) & Section 4 (arable); AHDB maize and
// cereals guidance; PDA/Kingshay forage nutrient-removal work. Cereal grain N
// anchors: AHDB feed-crop trials (~185 kg N/ha wheat, ~162 kg N/ha barley),
// with RB209 driving rate by SNS index. P & K replace crop offtake at Index 2.
//
// NOTE on the structured engine fields (nTargetKgPerHa, pkRegime): these drive
// lib/cropplan.ts. nTargetKgPerHa is the SNS-MODERATE anchor (the engine adjusts
// ±30 for SNS). For the seedbed_low_index_only crops (brassicas) it is treated
// as a CEILING — the engine only ever adjusts it down for high SNS, never up.
// =============================================================================

export type CropCategory = 'forage' | 'cereal_grain' | 'catch';

/** How settled the default is, so the UI can label it. */
export type EvidenceGrade = 'rb209' | 'rb209_plus_trial' | 'trial';

/**
 * How P & K are recommended for the crop:
 *  - 'offtake_replacement': replace offtake at Index 2, build at 0–1, nil at 3+.
 *    (Cereals, maize, fodder beet, wholecrop, intensive catch grass.)
 *  - 'seedbed_low_index_only': a seedbed dressing ONLY at Index 0 or 1; at Index
 *    2+ the crop lives off soil reserves → nil. (Forage brassicas, per RB209 §3.)
 */
export type PKRegime = 'offtake_replacement' | 'seedbed_low_index_only';

/** Crop family — currently only used to trigger the brassica clubroot
 *  (5-year-break) rotation warning, and later to keep crop fields out of grass
 *  groupings. Undefined for non-family crops. */
export type CropFamily = 'brassica';

export interface CropNStage {
  label: string;
  timing: string;
  note?: string;
}

/** A micronutrient note for the crop (e.g. boron for swede). Kept generic so
 *  the list extends without schema churn. `kgPerHa` is indicative only. */
export interface CropMicro {
  nutrient: string;      // 'Boron' | 'Manganese' | …
  note: string;
  kgPerHa?: number;
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
  /** SNS-MODERATE anchor N (kg N/ha) the engine adjusts ±30 for SNS. For
   *  seedbed_low_index_only crops this is a ceiling (only ever reduced). */
  nTargetKgPerHa: number;
  /** How the engine recommends P & K (see PKRegime). */
  pkRegime: PKRegime;
  /** Stage-based N plan (replaces the grass per-cut model). */
  nStages: CropNStage[];
  targetPh: number;
  phNote?: string;
  soilFit: string;
  manureFit: string;
  needsMg?: boolean;
  needsNa?: boolean;
  /** Sulphur-hungry crop (brassicas, and often maize on light land). When true
   *  the plan surfaces `sulphurNote`. Containment-following Mg/Na. */
  needsS?: boolean;
  sulphurNote?: string;
  /** Micronutrient advisories (e.g. boron for swede). */
  micros?: CropMicro[];
  /** Crop family — triggers the clubroot rotation warning for brassicas. */
  family?: CropFamily;
  /** Root crops only: advisory about extra K when roots are lifted and tops are
   *  carted off (vs grazed in situ). Surfaced as a note, never auto-applied. */
  kLiftTopUpNote?: string;
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
    nTargetKgPerHa: 120,
    pkRegime: 'offtake_replacement',
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
    needsS: true,
    sulphurNote: 'Maize on light, low-organic-matter land can respond to 25–40 kg SO₃/ha in spring.',
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
    nTargetKgPerHa: 120,
    pkRegime: 'offtake_replacement',
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
    needsS: false,
    kLiftTopUpNote:
      'If roots are lifted and tops carted off, potash offtake rises sharply — apply up to +150 kg K₂O/ha. ' +
      'Grazed in situ returns most nutrients, so no top-up.',
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
    nTargetKgPerHa: 185,
    pkRegime: 'offtake_replacement',
    nStages: [
      { label: 'Early spring', timing: 'GS25–30 (tillering)', note: 'First split' },
      { label: 'Stem extension', timing: 'GS30–32', note: 'Main dressing' },
      { label: 'Flag leaf', timing: 'GS37–39', note: 'Final split / grain quality' },
    ],
    targetPh: 6.5,
    phNote: 'Prefers a well-limed seedbed around pH 6.5.',
    soilFit: 'Fertile, well-drained clay and loam.',
    manureFit: 'Moderate — autumn or early-spring organics, watching nitrogen timing.',
    needsS: true,
    sulphurNote: 'Cereals on light land are increasingly S-responsive — 25–50 kg SO₃/ha in spring is common insurance.',
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
    nTargetKgPerHa: 162,
    pkRegime: 'offtake_replacement',
    nStages: [
      { label: 'Early spring', timing: 'GS25–30', note: 'Firm first split' },
      { label: 'Stem extension', timing: 'GS30–31', note: 'Balance of nitrogen' },
    ],
    targetPh: 6.2,
    phNote: 'Barley is sensitive to low pH — keep at or above pH 6.2 (up to 7.0 is justified).',
    soilFit: 'Grows well on lighter soils and loams, but punishes acidity.',
    manureFit: 'Moderate; spring organics fit spring barley well.',
    needsS: true,
    sulphurNote: 'As for wheat — consider 25–50 kg SO₃/ha on lighter land.',
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
    nTargetKgPerHa: 120,
    pkRegime: 'offtake_replacement',
    nStages: [
      { label: 'Early spring', timing: 'GS25–30', note: 'First split' },
      { label: 'Stem extension', timing: 'GS30–31', note: 'Balance — keep modest to avoid lodging' },
    ],
    targetPh: 5.8,
    phNote: 'The most acid-tolerant cereal — grows down to about pH 5.5.',
    soilFit: 'Tolerant of a range of soils and lower pH than wheat or barley.',
    manureFit: 'Moderate; tolerant crop, fits organics reasonably.',
    needsS: true,
    sulphurNote: 'Lower demand than wheat/barley, but light-land crops still benefit from spring S.',
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
    nTargetKgPerHa: 180,
    pkRegime: 'offtake_replacement',
    nStages: [
      { label: 'Early spring', timing: 'GS25–30', note: 'First split' },
      { label: 'Stem extension', timing: 'GS30–32', note: 'Top-up' },
    ],
    targetPh: 6.5,
    soilFit: 'As for wheat — fertile, well-drained clay and loam.',
    manureFit: 'Good with planned spring organics.',
    needsS: true,
    sulphurNote: 'As for grain wheat on lighter land.',
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
    nTargetKgPerHa: 150,
    pkRegime: 'offtake_replacement',
    nStages: [
      { label: 'Early spring', timing: 'GS25–30', note: 'Firm first split' },
      { label: 'Stem extension', timing: 'GS30–31', note: 'Balance' },
    ],
    targetPh: 6.2,
    phNote: 'Barley is sensitive to low pH — keep at or above pH 6.2.',
    soilFit: 'Lighter soils and loams; pH-sensitive.',
    manureFit: 'Good in spring-drilled systems.',
    needsS: true,
    sulphurNote: 'As for grain barley on lighter land.',
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
    nTargetKgPerHa: 110,
    pkRegime: 'offtake_replacement',
    nStages: [
      { label: 'Early spring', timing: 'GS25–30', note: 'First split' },
      { label: 'Stem extension', timing: 'GS30–31', note: 'Balance' },
    ],
    targetPh: 5.8,
    phNote: 'Oats tolerate more acidity — down to about pH 5.5.',
    soilFit: 'Tolerant of a range of soils.',
    manureFit: 'Good in spring-drilled systems.',
    needsS: true,
    sulphurNote: 'Light-land crops benefit from spring S.',
    evidence: 'rb209',
    sources: 'RB209 Section 3 (wholecrop) & Section 4 (spring cereals N).',
    summary: 'Acid-tolerant; uses the generic wholecrop P and K basis.',
  },

  // ----- Forage brassicas (main crops) --------------------------------------
  // RB209 §3: N low and SNS-driven; P & K SEEDBED-ONLY and only at Index 0–1;
  // Mg only at Mg Index 0; brassicas are S-hungry; clubroot needs a 5-year
  // break. Per-index N figures here are conservative — confirm against your
  // RB209 copy; the catalogue is editable so you can tune them per field.
  {
    key: 'kale',
    label: 'Kale (forage)',
    category: 'forage',
    yieldDefault: 10,
    yieldUnit: 't DM/ha',
    yieldRange: '8–12 t DM/ha at 12–15% DM',
    offtake: { p2o5: 3.0, k2o: 30, basis: 'per t DM (estimate — brassicas are K-hungry; confirm against RB209).' },
    totalN:
      'Winter-hardy main crop, ~10 months in the ground; the highest N and K demand of the forage brassicas. ' +
      'N is still low by silage-grass standards and SNS-driven — most goes on in the seedbed with an early top-dress.',
    nTargetKgPerHa: 100,
    pkRegime: 'seedbed_low_index_only',
    nStages: [
      { label: 'Seedbed', timing: 'At sowing', note: 'Bulk of the nitrogen' },
      { label: 'Early top-dress', timing: '6–8 weeks after emergence', note: 'Balance, while the crop is actively growing' },
    ],
    targetPh: 6.0,
    phNote: 'Aim for pH 6.0+; clubroot risk rises on acid soils.',
    soilFit: 'Wide soil tolerance; wants reasonable drainage and a firm seedbed. Grazed in situ.',
    manureFit: 'Good slurry/FYM crop in the seedbed — but P & K are reserve-driven at Index 2+, so don’t overload.',
    needsMg: true,
    needsS: true,
    sulphurNote: 'Brassicas are S-hungry — 25–40 kg SO₃/ha in the seedbed is well justified, especially on light land.',
    family: 'brassica',
    evidence: 'rb209_plus_trial',
    sources: 'RB209 Section 3 (forage brassicas); AHDB brassica guidance.',
    summary: 'Highest N & K of the brassicas; grazed in situ; mind clubroot and pH.',
  },
  {
    key: 'swede',
    label: 'Swede (forage)',
    category: 'forage',
    yieldDefault: 9,
    yieldUnit: 't DM/ha (roots)',
    yieldRange: '8–11 t DM/ha',
    offtake: { p2o5: 2.5, k2o: 25, basis: 'per t DM, roots (estimate; confirm against RB209).' },
    totalN:
      'Precision-drilled main-crop root. N low and SNS-driven — a little less than kale. ' +
      'Boron-sensitive: brown heart shows up where boron is short.',
    nTargetKgPerHa: 90,
    pkRegime: 'seedbed_low_index_only',
    nStages: [
      { label: 'Seedbed', timing: 'At drilling', note: 'Most of the nitrogen' },
      { label: 'Early top-dress', timing: 'Once established', note: 'Small balance if needed' },
    ],
    targetPh: 6.0,
    phNote: 'Aim for pH 6.0+ to manage clubroot.',
    soilFit: 'Deep, well-drained loams; precision-drilled. Can be lifted or grazed in situ.',
    manureFit: 'Seedbed organics fine; P & K reserve-driven at Index 2+.',
    needsMg: true,
    needsS: true,
    sulphurNote: 'S-hungry like the other brassicas — include S in the seedbed on light land.',
    micros: [
      { nutrient: 'Boron', note: 'Swede is boron-sensitive (brown heart). Apply ~1–3 kg/ha boron where soils are low, especially light/high-pH land. Do NOT over-apply — boron is toxic in excess.', kgPerHa: 2 },
    ],
    family: 'brassica',
    kLiftTopUpNote:
      'If swedes are lifted and carted rather than grazed in situ, potash offtake rises — top up K accordingly.',
    evidence: 'rb209_plus_trial',
    sources: 'RB209 Section 3 (forage brassicas); AHDB root brassica guidance.',
    summary: 'Boron-sensitive root brassica; low N; seedbed-only P & K at low index.',
  },
  {
    key: 'hybrid_brassica',
    label: 'Hybrid brassica (rape × kale)',
    category: 'forage',
    yieldDefault: 8,
    yieldUnit: 't DM/ha',
    yieldRange: '6–10 t DM/ha',
    offtake: { p2o5: 3.0, k2o: 28, basis: 'per t DM (estimate; confirm against RB209).' },
    totalN:
      'Fast, leafy hybrids (e.g. Redstart). RB209 says use the rape / swede / stubble-turnip recommendations — ' +
      'low, SNS-driven N, seedbed-led.',
    nTargetKgPerHa: 90,
    pkRegime: 'seedbed_low_index_only',
    nStages: [
      { label: 'Seedbed', timing: 'At sowing', note: 'Most of the nitrogen' },
      { label: 'Top-dress', timing: 'If taking a second graze', note: 'Modest follow-up' },
    ],
    targetPh: 6.0,
    phNote: 'Aim for pH 6.0+; clubroot risk on acid soils.',
    soilFit: 'Flexible; good for multi-graze catch/main-crop use. Grazed in situ.',
    manureFit: 'Seedbed organics fine; reserve-driven P & K at Index 2+.',
    needsMg: true,
    needsS: true,
    sulphurNote: 'S-hungry — seedbed SO₃ on light land.',
    family: 'brassica',
    evidence: 'trial',
    sources: 'RB209 Section 3 (use rape/swede/turnip recommendations); breeder guidance.',
    summary: 'Use rape/swede/turnip rules; low N; clubroot break still applies.',
  },

  // ----- Catch crops --------------------------------------------------------
  {
    key: 'forage_rape',
    label: 'Forage rape (catch)',
    category: 'catch',
    yieldDefault: 4,
    yieldUnit: 't DM/ha',
    yieldRange: '3–5 t DM/ha',
    offtake: { p2o5: 3.0, k2o: 30, basis: 'per t DM (estimate; confirm against RB209).' },
    totalN:
      'Fast catch crop (~6 months). RB209 ceiling is ≤75 kg N/ha at N Index 0–1 — apply less if the soil is ' +
      'moist or freshly cultivated (more mineralised N available). Mostly seedbed N.',
    nTargetKgPerHa: 75,
    pkRegime: 'seedbed_low_index_only',
    nStages: [
      { label: 'Seedbed', timing: 'At sowing', note: 'Up to the 75 kg N/ha ceiling — less on moist/cultivated soils' },
    ],
    targetPh: 6.0,
    phNote: 'pH 6.0+ preferred; clubroot break applies.',
    soilFit: 'Quick cover after cereals or before a reseed. Grazed in situ.',
    manureFit: 'A little seedbed slurry helps; P & K reserve-driven at Index 2+.',
    needsS: true,
    sulphurNote: 'Brassica — S-hungry; seedbed SO₃ on light land.',
    family: 'brassica',
    evidence: 'rb209',
    sources: 'RB209 Section 3 (forage brassicas / catch crops).',
    summary: '≤75 kg N/ha at Index 0–1; fast brassica catch crop; clubroot break applies.',
  },
  {
    key: 'stubble_turnips',
    label: 'Stubble turnips (catch)',
    category: 'catch',
    yieldDefault: 5.5,
    yieldUnit: 't DM/ha',
    yieldRange: '5–6 t DM/ha',
    offtake: { p2o5: 3.0, k2o: 30, basis: 'per t DM (estimate; confirm against RB209).' },
    totalN:
      'After-cereal catch crop. Same RB209 ceiling as forage rape — ≤75 kg N/ha at N Index 0–1, less on ' +
      'moist or freshly cultivated soils. Roughly half the DM yield of kale.',
    nTargetKgPerHa: 75,
    pkRegime: 'seedbed_low_index_only',
    nStages: [
      { label: 'Seedbed', timing: 'At sowing', note: 'Up to the 75 kg N/ha ceiling — less on moist/cultivated soils' },
    ],
    targetPh: 6.0,
    phNote: 'pH 6.0+ preferred; clubroot break applies.',
    soilFit: 'Sown into cereal stubble for autumn/winter grazing. Grazed in situ.',
    manureFit: 'Modest seedbed organics; P & K reserve-driven at Index 2+.',
    needsS: true,
    sulphurNote: 'Brassica — S-hungry; seedbed SO₃ on light land.',
    family: 'brassica',
    evidence: 'rb209',
    sources: 'RB209 Section 3 (forage brassicas / catch crops).',
    summary: '≤75 kg N/ha at Index 0–1; after-cereal brassica catch crop.',
  },
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
    nTargetKgPerHa: 280,
    pkRegime: 'offtake_replacement',
    nStages: [
      { label: 'First dressing', timing: 'At establishment / early growth', note: 'Get nitrogen on early' },
      { label: 'Per-cut top-ups', timing: 'After each cut', note: 'Replace what the cut removed' },
    ],
    targetPh: 6.2,
    soilFit: 'Fast-growing and hungry; suffers badly if potash runs short.',
    manureFit: 'A very good slurry / FYM user if the timing is right.',
    needsMg: false,
    needsNa: false,
    needsS: false,
    evidence: 'trial',
    sources: 'Kingshay/PDA forage-crop nutrient-removal work (cited in AHDB’s RB209 Section 3 review).',
    summary: 'Treat it as intensive silage grass — fast and very potash-hungry.',
  },
];

export function getCropProfile(key: string): CropProfile | undefined {
  return CROP_PROFILES.find((c) => c.key === key);
}

/** Profiles grouped by category, in display order. */
export function cropProfilesByCategory(profiles: CropProfile[] = CROP_PROFILES): { category: CropCategory; label: string; crops: CropProfile[] }[] {
  const order: CropCategory[] = ['forage', 'cereal_grain', 'catch'];
  return order
    .map((category) => ({
      category,
      label: CATEGORY_LABEL[category],
      crops: profiles.filter((c) => c.category === category),
    }))
    .filter((g) => g.crops.length > 0);
}

// =============================================================================
// DB catalogue mapping. The public.crops table stores a superset of CropProfile
// in snake_case (offtake/n_stages/micros as jsonb). These map a row to the
// in-memory profile the engine consumes, and carry the row's DB identity so the
// allocate UI can reference a crop by id. See lib/data.ts:loadCrops.
// =============================================================================

/** A raw public.crops row (snake_case, as returned by Supabase). */
export interface CropRow {
  id: string;
  user_id: string | null;
  seed_key: string | null;
  label: string;
  category: CropCategory;
  yield_default: number;
  yield_unit: string;
  yield_range: string;
  offtake: CropOfftake;
  total_n: string;
  n_target_kg_per_ha: number;
  pk_regime: PKRegime;
  n_stages: CropNStage[];
  target_ph: number;
  ph_note: string | null;
  soil_fit: string;
  manure_fit: string;
  needs_mg: boolean;
  needs_na: boolean;
  needs_s: boolean;
  sulphur_note: string | null;
  micros: CropMicro[] | null;
  family: CropFamily | null;
  k_lift_top_up_note: string | null;
  evidence: EvidenceGrade;
  sources: string;
  summary: string;
  sort_order: number;
  created_at: string;
}

/** Map a DB row to the in-memory CropProfile the engine eats. For a user fork
 *  with no seed_key, the row id doubles as the engine key. */
export function cropProfileFromRow(r: CropRow): CropProfile {
  return {
    key: r.seed_key ?? r.id,
    label: String(r.label).replace(/\s*\(copy\)\s*$/i, ''),
    category: r.category,
    yieldDefault: Number(r.yield_default),
    yieldUnit: r.yield_unit,
    yieldRange: r.yield_range,
    offtake: r.offtake,
    totalN: r.total_n,
    nTargetKgPerHa: Number(r.n_target_kg_per_ha),
    pkRegime: r.pk_regime,
    nStages: r.n_stages ?? [],
    targetPh: Number(r.target_ph),
    phNote: r.ph_note ?? undefined,
    soilFit: r.soil_fit,
    manureFit: r.manure_fit,
    needsMg: r.needs_mg,
    needsNa: r.needs_na,
    needsS: r.needs_s,
    sulphurNote: r.sulphur_note ?? undefined,
    micros: r.micros ?? undefined,
    family: r.family ?? undefined,
    kLiftTopUpNote: r.k_lift_top_up_note ?? undefined,
    evidence: r.evidence,
    sources: r.sources,
    summary: r.summary,
  };
}

/** A catalogue crop loaded from the DB: its identity plus the engine profile. */
export interface LoadedCrop {
  id: string;
  userId: string | null;
  seedKey: string | null;
  sortOrder: number;
  profile: CropProfile;
}

export function loadedCropFromRow(r: CropRow): LoadedCrop {
  return {
    id: r.id,
    userId: r.user_id,
    seedKey: r.seed_key,
    sortOrder: r.sort_order,
    profile: cropProfileFromRow(r),
  };
}

/** Group loaded crops by category for the guide/picker, in display order. */
export function loadedCropsByCategory(crops: LoadedCrop[]): { category: CropCategory; label: string; crops: LoadedCrop[] }[] {
  const order: CropCategory[] = ['forage', 'cereal_grain', 'catch'];
  return order
    .map((category) => ({
      category,
      label: CATEGORY_LABEL[category],
      // Custom crops (userId set) sort to the top of each category, ahead of the
      // read-only seeded crops. sort() is stable, so the existing order within
      // the custom block and within the seed block is preserved.
      crops: crops
        .filter((c) => c.profile.category === category)
        .slice()
        .sort((a, b) => (a.userId !== null ? 0 : 1) - (b.userId !== null ? 0 : 1)),
    }))
    .filter((g) => g.crops.length > 0);
}
