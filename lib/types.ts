export type ProductType = 'bag_fert' | 'slurry' | 'solid_manure' | 'lime';
export type CutType = 'silage' | 'bales' | 'grazing';
/**
 * Per-cut "what's next" — set when the user logs a cut. Drives spreading-
 * report mode eligibility and grazing-report inclusion. Nullable on the DB
 * column so existing rows pre-feature stay valid; resolver falls back to
 * the field's planned_cuts array when next_action is null.
 *
 *   another_cut_silage  — field's heading for another silage cut
 *   another_cut_bales   — field's heading for another bales cut
 *   rotational_grazing  — field enters the grazing report rotation
 *   maintenance_grazing — one maintenance fertiliser dose then leave it;
 *                         field appears in spreading-report Maintenance
 *                         mode until any mineral fert is logged after
 *                         the maintenance-flagged cut.
 */
export type NextAction =
  | 'another_cut_silage'
  | 'another_cut_bales'
  | 'rotational_grazing'
  | 'maintenance_grazing';
export type YieldClass = 'light' | 'average' | 'heavy';
export type SlurryMethod = 'splash_plate' | 'dribble_bar' | 'trail_shoe';
export type SolidMethod  = 'surface' | 'soil_incorporated';
export type ApplicationMethod = SlurryMethod | SolidMethod;
export type RateUnit = 'kg/ha' | 'kg/ac' | 'lb/ac' | 'gal/ac' | 'm3/ha' | 't/ac' | 't/ha' | 'l/ha' | 'l/ac';

/**
 * Product categories used to group the picker menu. Aligned with
 * AMENDMENTS_REFERENCE.md. Each category gathers one or more products,
 * with DM-banded categories (dairy_slurry, pig_slurry) showing a band
 * picker built from the rows that share the category.
 */
export type ProductCategory =
  | 'bag_fert'
  | 'lime'
  | 'dairy_slurry'
  | 'pig_slurry'
  | 'separated_slurry'
  | 'fym'
  | 'poultry'
  | 'digestate'
  | 'biosolids'
  | 'custom';

/**
 * Soil type categorisation, drives K target adjustment (light_sand) and
 * report flags (S risk, cold-clay N timing). Default 'medium_loam'.
 */
export type SoilType = 'light_sand' | 'medium_loam' | 'heavy_clay' | 'deep_silt' | 'organic' | 'peaty';

/** A committed soil sample (from the PDF import). Macro values are stored as
 *  named columns; the full mineral/micronutrient panel lives in `extras`. */
export interface SoilSample {
  id: string;
  user_id: string;
  document_id: string | null;
  sample_date: string | null;
  lab_name: string | null;
  lab_sample_ref: string | null;
  lab_sample_label: string | null;
  ph: number | null;
  p_ppm: number | null;
  p_index: number | null;
  k_ppm: number | null;
  k_index: number | null;
  mg_ppm: number | null;
  mg_index: number | null;
  extras: Record<string, unknown>;
  created_by: string | null;
  created_at?: string;
}

/** Sward-management event logged against a field. */
export type FieldEventType = 'reseed' | 'oversow' | 'plough';
export type SeedRateUnit = 'kg/ac' | 'kg/ha';

export interface FieldEvent {
  id: string;
  user_id: string;
  field_id: string;
  /** Which user logged it (admin/staff). Null if the FK was cleared. */
  created_by: string | null;
  event_type: FieldEventType;
  event_date: string;
  /** Grass system sown (reseed/oversow). Null for a plough event, or if the
   *  sown system wasn't recorded. */
  grass_system_id: string | null;
  seed_mix: string | null;
  seed_rate_value: number | null;
  seed_rate_unit: SeedRateUnit | null;
  notes: string | null;
  created_at: string;
}

export interface Field {
  id: string;
  user_id: string;
  group_id: string | null;
  /** FK to allocation_types (the middle grouping axis). Null = untyped. */
  allocation_type_id: string | null;
  name: string;
  acres: number;
  ha: number;
  cut_profile: number;
  /** Grazing-only RB209 yield band 0..6 (see GRAZING_N_BY_YIELD). Null = derive
   *  from cut_profile (legacy behaviour). Ignored for silage/bales fields. */
  grazing_yield_band: number | null;
  planned_cuts: CutType[];
  ph: number | null;
  p_idx: number | null;
  k_idx: number | null;
  /** Soil magnesium index (decimal, e.g. 1.0). Drives Mg-based lime type
   *  (magnesian vs calcium) on the lime report. Null = not sampled for Mg. */
  mg_idx: number | null;
  /** Visual mapping (all nullable; populated via the /map area). boundary is a
   *  GeoJSON Polygon/MultiPolygon in [lng,lat]. area_ha_mapped is the official
   *  RPA area or the computed drawn area; it stays separate from `ha` until the
   *  user accepts it. */
  boundary: unknown | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
  area_ha_mapped: number | null;
  boundary_source: string | null;
  rpa_sheet_id: string | null;
  rpa_parcel_id: string | null;
  boundary_updated_at: string | null;
  sampled: boolean;
  sample_date: string | null;
  soil_type: SoilType;
  /** FK to grass_systems. Migration backfills existing rows to perennial_ryegrass. */
  grass_system_id: string | null;
  last_ploughed: string | null;
  last_reseeded: string | null;
  notes: string | null;
  needs_setup: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * A grass system / sward type — drives N caps, N target multipliers and K
 * multipliers in nutrient reports. Library has shared seed rows
 * (user_id = null) shipped by the migration, plus user-owned custom rows
 * users can add via Settings → Grass systems.
 *
 * Per-user visibility (hiding shared systems the user doesn't want in
 * their dropdown) lives in Settings.hiddenGrassSystemIds — NOT a column
 * here — because it's a UI state, not part of the system definition.
 */
export interface GrassSystem {
  id: string;
  /** null for shared seeds; user uuid for custom rows. */
  user_id: string | null;
  /** Stable string key for shared seeds, NULL for user-owned. Used by code
   *  that needs to find a specific shared system (e.g. flag logic). */
  seed_key: string | null;
  name: string;
  short_label: string;
  description: string | null;
  n_cap_kg_per_ha: number;
  n_target_multiplier: number;
  k_multiplier: number;
  is_legume_rich: boolean;
  sort_order: number;
  created_at: string;
}

/**
 * A user-named grouping of fields ("block of land"). Plain entity — no
 * cascading rules, no nutrient defaults yet. Fields reference these via
 * fields.group_id; deleting a group sets that FK to null, leaving the
 * fields ungrouped rather than orphaned.
 */
export interface Group {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  management_type: 'silage' | 'rotational' | 'maintenance' | null;
  earliest_fert_md: string | null;   // 'MM-DD', repeats yearly
  low_input: boolean;
  max_n_kg_per_ha: number | null;
  nvz: boolean;
  profile_note: string | null;
  /** Optional flat grazing maintenance schedule: this much N every N days.
   *  Advisory (a reminder) — never auto-applied. */
  graze_n_kg_per_ha: number | null;
  graze_interval_days: number | null;
}

/** A rising-plate-meter reading: a field's grass cover (kg DM/ha) on a date. */
export interface PlateReading {
  id: string;
  user_id: string;
  field_id: string;
  reading_date: string;       // YYYY-MM-DD
  cover_kg_dm_ha: number;
  height_cm: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

/** A grazing event in the weekly-walk model: the paddock was grazed on a date,
 *  down to a residual (post_cover). The pre-grazing cover is normally derived
 *  from the latest plate reading, not entered — so pre_cover is optional. */
export interface GrazingEvent {
  id: string;
  user_id: string;
  field_id: string;
  graze_date: string;         // YYYY-MM-DD
  post_cover_kg_dm_ha: number;  // residual left after grazing
  pre_cover_kg_dm_ha: number | null; // optional measured pre-cover (rarely used)
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Product {
  id: number;
  user_id: string | null;
  name: string;
  type: ProductType;
  category: ProductCategory | null;
  sort_order: number;
  dm_pct: number | null;
  /** Bag fert only: 'granular' (rate kg/ha) or 'liquid' (rate L/ha + density). */
  form: 'granular' | 'liquid' | null;
  /** Liquid bag fert: product density in kg per litre, for L→kg conversion. */
  density_kg_per_l: number | null;
  // bag fert (% w/w)
  n_pct: number | null;
  p2o5_pct: number | null;
  k2o_pct: number | null;
  s_pct: number | null;
  // slurry / liquid manure (kg per m³)
  n_kg_per_m3: number | null;
  p2o5_kg_per_m3: number | null;
  k2o_kg_per_m3: number | null;
  so3_kg_per_m3: number | null;
  mgo_kg_per_m3: number | null;
  // solid manure (kg per tonne fresh weight)
  n_kg_per_t: number | null;
  p2o5_kg_per_t: number | null;
  k2o_kg_per_t: number | null;
  so3_kg_per_t: number | null;
  mgo_kg_per_t: number | null;
  /** Dated analysis history (newest-or-any order). When present, an application
   *  is valued using the version effective on its date rather than these base
   *  values. Base columns above mirror the most-recent version. */
  analyses?: ProductAnalysis[];
}

/** One dated version of a product's analysis. See lib/rules.ts:effectiveProductOn. */
export interface ProductAnalysis {
  id: string;
  product_id: number;
  effective_from: string; // 'YYYY-MM-DD'
  dm_pct: number | null;
  form: 'granular' | 'liquid' | null;
  density_kg_per_l: number | null;
  n_pct: number | null;
  p2o5_pct: number | null;
  k2o_pct: number | null;
  s_pct: number | null;
  n_kg_per_m3: number | null;
  p2o5_kg_per_m3: number | null;
  k2o_kg_per_m3: number | null;
  so3_kg_per_m3: number | null;
  mgo_kg_per_m3: number | null;
  n_kg_per_t: number | null;
  p2o5_kg_per_t: number | null;
  k2o_kg_per_t: number | null;
  so3_kg_per_t: number | null;
  mgo_kg_per_t: number | null;
}

export interface Application {
  id: string;
  user_id: string;
  /** Which user actually entered this row (admin or staff). Null for legacy
   *  rows predating multi-user; backfilled to user_id by migration. */
  created_by: string | null;
  field_id: string;
  product_id: number;
  date_applied: string;
  rate_value: number;
  rate_unit: RateUnit;
  method: ApplicationMethod | null;
  notes: string | null;
  applied_by: string;
  created_at: string;
  /** 'whole' (normal — applied across the field) | 'partial' (a drawn
   *  sub-area only; see application_areas). Defaults to 'whole' for every
   *  pre-existing row. */
  coverage: 'whole' | 'partial';
  /** Set when a partial application's field reaches full coverage and the
   *  partial folds into the field's nutrient metrics. NULL = still pending
   *  (excluded from all field-level nutrient figures). */
  reconciled_at: string | null;
  /** Total drawn area (ha) for a partial application = sum of its
   *  application_areas.area_ha. Cached so nutrient sums can area-weight a
   *  reconciled partial without loading application_areas. */
  drawn_ha: number | null;
}

/** A drawn sub-area of a partial application (the finger-drawn spread shape). */
export interface ApplicationArea {
  id: string;
  /** Farm owner (admin) — all shared data is owned by this id. */
  user_id: string;
  /** Who actually drew it (admin or staff). */
  created_by: string | null;
  application_id: string;
  field_id: string;
  /** GeoJSON Polygon/MultiPolygon, [lng,lat]. */
  polygon: unknown;
  area_ha: number;
  created_at: string;
}

export interface Cut {
  id: string;
  user_id: string;
  /** Which user actually entered this row (admin or staff). Null for legacy
   *  rows predating multi-user; backfilled to user_id by migration. */
  created_by: string | null;
  field_id: string;
  cut_number: number;
  cut_date: string;
  cut_type: CutType;
  yield_class: YieldClass;
  /** What's next for this field, set when the cut was logged. Nullable for
   *  legacy rows; resolver falls back to planned_cuts when null. */
  next_action: NextAction | null;
  notes: string | null;
  /** Set when the user dismisses the After-cut N prompt for this cut window
   *  ("happy it ran short"). Null = prompt behaves normally. */
  n_dismissed_at: string | null;
  created_at: string;
}

/**
 * Agronomist-editable RB209 reference values. Stored as a JSON block on the
 * farm settings record (Settings.agronomy, a partial override). The engine
 * merges any overrides over the built-in RB209 defaults via resolveAgronomy().
 * String keys throughout so this type stays decoupled from the engine's index
 * unions; the engine indexes with String(cut)/String(band).
 */
export interface AgronomyConfig {
  /** Silage P₂O₅ recommendation, kg/ha: cut ('1'..'4') → P index ('0'..'4'). */
  silageP: Record<string, Record<string, number>>;
  /** Silage K₂O recommendation, kg/ha: cut ('1'..'4') → K band ('0','1','2-','2+','3','4'). */
  silageK: Record<string, Record<string, number>>;
  /** Grazing P₂O₅ recommendation, kg/ha: P index → value. */
  grazingP: Record<string, number>;
  /** Grazing K₂O recommendation, kg/ha: K band → value. */
  grazingK: Record<string, number>;
  /** First-cut potash to apply the PREVIOUS AUTUMN, kg/ha: K band → value. */
  firstCutAutumnK: Record<string, number>;
  /** Spring potash cap for the first cut, kg/ha. */
  springCap: number;
  /** Extra K₂O after cutting (index ≤2+), kg/ha: cuts-in-system ('1'..'4') → value. */
  extraK: Record<string, number>;
  /** Crop offtake per tonne of dry matter, kg: { n, p2o5, k2o }. */
  offtakePerT: { n: number; p2o5: number; k2o: number };
  /** Base modelled DM yield (t/ha) by cut profile ('1'..'4') → per-cut array. */
  baseYields: Record<string, number[]>;
  /** Recommendation target P index (RB209 maintenance target). */
  targetPIndex: number;
  /** Recommendation target K band (RB209 maintenance target). */
  targetKBand: string;
}

export type AgronomyOverrides = Partial<AgronomyConfig>;

export interface Settings {
  /** The farm's display name, e.g. "Mill Farm". Set during onboarding. */
  farmName?: string | null;
  businessName?: string | null;
  yieldMultipliers: { light: number; average: number; heavy: number };
  cutTypeMultipliers: { silage: number; bales: number; grazing: number };
  grazingReturnPct: number;
  nTargets: { 1: number; 2: number; 3: number; 4: number };
  soilTargets: { pH: number; pIdx: number; kIdx: number };
  unitSystem: 'acres' | 'hectares';
  bagFertUnit: 'kg/ha' | 'kg/ac' | 'lb/ac' | 'units/ac';
  slurryUnit: 'gal/ac' | 'm3/ha';
  limeUnit: 't/ac' | 't/ha';
  /** Report defaults — used by the spreading recommendation report. */
  reportDefaults: {
    /**
     * Front-loaded percentage for a split dressing's first application.
     * 60% means dressing 1 of 2 gets 60% of the target, dressing 2 gets 40%.
     * Bounded 40-80 in the UI.
     */
    splitFrontLoadPct: number;
    /**
     * Fallback annual N cap (kg N/ha). Used only when a field has no grass
     * system assigned (rare — the migration backfills every field with PRG).
     * Per-system caps live on the grass_systems table now.
     */
    annualNCapKgPerHa: number;
    /**
     * Grazing top-up cadence — used by the grazing report (chunk 2).
     * Carrying the slot now so the schema doesn't need migrating later.
     */
    grazingCadenceKgN: number;
    grazingCadenceWeeks: number;
    /**
     * Maintenance dose threshold (kg N/ha). A field flagged for maintenance
     * (next_action = 'maintenance_grazing' on its most recent cut) shows in
     * the spreading report's Maintenance mode until the cumulative N applied
     * since that cut crosses this threshold. Slurry, liquid digestate and
     * mineral fertiliser ALL count toward the threshold. Solid manures (FYM,
     * compost, solid digestate, poultry litter) do not — they're slow-release
     * and don't behave like a top-up dose.
     */
    maintenanceDoseThresholdKgN: number;
    /**
     * Carryover release model (fert plan) — ESTIMATE, not RB209. Controls how
     * much of an earlier organic application's P & K is treated as crop-
     * available now, by material and months elapsed:
     *   fraction = min(cap, startPct/100 + perMonthPct/100 × monthsElapsed)
     * Slurry/digestate is fast; FYM/solid manure slow. All as percentages.
     */
    releaseSlurryStartPct: number;   // availability in the month of spreading
    releaseSlurryPerMonthPct: number; // extra availability per month after
    releaseFymStartPct: number;
    releaseFymPerMonthPct: number;
    releaseFymCapPct: number;        // FYM never exceeds this (soft cap)
    /**
     * Minimum granular spread rate (kg of NUTRIENT per ha) below which the
     * fert plan won't recommend a dribble — too small to calibrate a spreader
     * for. When this cut's P (or K) shortfall is under the threshold, it's
     * held and rolled into the next cut's need, surfacing once it's worth
     * spreading. Set per nutrient. 0 disables (always recommend any rate).
     */
    minSpreadP2O5KgPerHa: number;
    minSpreadK2OKgPerHa: number;
  };
  /**
   * Timing parameters for the home-screen "Coming up" prompts. All in days
   * unless noted. User-adjustable in Settings so each farm can tune to its
   * own system. Nitrogen after a cut is the time-critical one; grazing
   * dressings and lead-time are planning prompts.
   */
  timingDefaults: {
    /** Days after a cut before its after-cut N shows as "due" on home. 0 = day of cut. */
    nDueAfterCutDays: number;
    /** Days after a cut before the after-cut N is flagged "overdue" (amber). */
    nOverdueAfterCutDays: number;
    /** Grazing topping-dressing interval, in days, from the last dressing/cut. */
    grazingDressingIntervalDays: number;
    /** How many days ahead to start showing a "dressing due soon" planning prompt. */
    planLeadTimeDays: number;
  };
  /**
   * Part-field spreading: the % of a field its part-applications must cover
   * (combined) before they count as a full spread and fold into the field's
   * nutrient totals. Below this they stay "pending". Default 80.
   */
  spreadCoverageThresholdPct?: number;
  /**
   * Grass system IDs the user has hidden from their dropdown. Shared seeds
   * appear by default; users tick visibility checkboxes in Settings →
   * Grass systems. Stored as IDs because seed_key isn't unique across
   * user-custom rows.
   */
  hiddenGrassSystemIds: string[];
  /**
   * Sprayer calibration settings for the spray calculator. Total boom flow =
   * nozzleFlowLMin × nozzleCount; application volume (L/ha) = totalFlow × 600
   * ÷ (speed km/h × width m).
   */
  sprayer?: {
    widthM: number | null;
    /** Total boom output (all nozzles together) in L/min — drives the calculator. */
    totalFlowLMin: number | null;
    defaultSpeedKmh: number | null;
    /** Sprayer tank capacity (L) — optional; lets the calculator split a field into loads. */
    tankLitres?: number | null;
    /** Legacy (pre 2026-06-09) — derived into totalFlowLMin when present. */
    nozzleFlowLMin?: number | null;
    nozzleCount?: number | null;
  };
  /**
   * Agronomist-editable RB209 overrides (partial — only the values changed
   * from the built-in defaults are stored). Undefined = use RB209 defaults.
   */
  agronomy?: AgronomyOverrides;
  /** 'farm' (default) or 'contractor' (lighter, jobs-only account). */
  accountType?: 'farm' | 'contractor' | 'agronomist';
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  yieldMultipliers: { light: 0.70, average: 1.00, heavy: 1.30 },
  cutTypeMultipliers: { silage: 1.00, bales: 0.70, grazing: 1.00 },
  grazingReturnPct: 0.70,
  nTargets: { 1: 110, 2: 80, 3: 65, 4: 50 },
  soilTargets: { pH: 6.0, pIdx: 2.0, kIdx: 2.0 },
  unitSystem: 'hectares',
  bagFertUnit: 'kg/ha',
  slurryUnit: 'gal/ac',
  limeUnit: 't/ac',
  reportDefaults: {
    splitFrontLoadPct: 60,
    annualNCapKgPerHa: 320,
    grazingCadenceKgN: 40,
    grazingCadenceWeeks: 4,
    maintenanceDoseThresholdKgN: 30,
    releaseSlurryStartPct: 70,
    releaseSlurryPerMonthPct: 15,
    releaseFymStartPct: 35,
    releaseFymPerMonthPct: 10,
    releaseFymCapPct: 95,
    minSpreadP2O5KgPerHa: 20,
    minSpreadK2OKgPerHa: 25,
  },
  timingDefaults: {
    nDueAfterCutDays: 0,
    nOverdueAfterCutDays: 7,
    grazingDressingIntervalDays: 28,
    planLeadTimeDays: 7,
  },
  spreadCoverageThresholdPct: 80,
  hiddenGrassSystemIds: [],
  sprayer: { widthM: null, totalFlowLMin: null, defaultSpeedKmh: null, tankLitres: null },
  accountType: 'farm',
  onboarded: false,
};

// ---------------------------------------------------------------
// Document ingestion
// ---------------------------------------------------------------

export type DocumentType = 'soil_report';

export type DocumentStatus =
  | 'queued'
  | 'processing'
  | 'ready_for_review'
  | 'committed'
  | 'failed'
  | 'discarded';

export interface ImportDocument {
  id: string;
  user_id: string;
  storage_path: string;
  original_filename: string | null;
  mime_type: string | null;
  byte_size: number | null;
  doc_type: DocumentType;
  status: DocumentStatus;
  extractor_name: string | null;
  extractor_version: string | null;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
  committed_at: string | null;
}

export type UserDecision = 'pending' | 'accepted' | 'edited' | 'rejected';

export interface SuggestedFieldMatch {
  field_id: string;
  field_name: string;
  score: number;
}

export interface ExtractedSample {
  id: string;
  document_id: string;
  user_id: string;
  raw_payload: Record<string, unknown>;
  lab_sample_label: string | null;
  lab_sample_ref: string | null;
  sample_date: string | null;
  ph: number | null;
  p_ppm: number | null;
  p_index: number | null;
  k_ppm: number | null;
  k_index: number | null;
  mg_ppm: number | null;
  mg_index: number | null;
  extras: Record<string, unknown>;
  confidence: Record<string, number> | { all?: number };
  suggested_field_matches: SuggestedFieldMatch[];
  user_decision: UserDecision;
  user_overrides: Record<string, unknown>;
  committed_sample_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A plant-protection (spray) record. Separate from Application — never enters
 *  nutrient calculations. Optional drawn sprayed area (coverage = 'partial'). */
export interface SprayRecord {
  id: string;
  field_id: string;
  user_id: string;
  created_by: string | null;
  date_applied: string;
  product_name: string;
  product_litres: number | null;
  water_l_per_ha: number | null;
  area_ha: number | null;
  coverage: 'whole' | 'partial';
  polygon: unknown | null;
  wind_dir: string | null;
  wind_speed_mph: number | null;
  temp_c: number | null;
  weather_note: string | null;
  targets: string[] | null;
  notes: string | null;
  /** Links to a catalogue spray_product so usage draws down stock; null for free-text one-offs. */
  spray_product_id: string | null;
  /** Tank mix — every product in this one spray. Stock draws down per entry. */
  products: SprayProductLine[] | null;
  created_at: string;
}

export interface SprayProductLine {
  name: string;
  spray_product_id: string | null;
  litres: number | null;
}

export interface SprayProduct {
  id: string;
  user_id: string;
  created_by: string | null;
  name: string;
  default_l_per_ha: number | null;
  notes: string | null;
  created_at: string;
}

export interface SprayPurchase {
  id: string;
  user_id: string;
  created_by: string | null;
  product_id: string;
  purchase_date: string;
  litres: number;
  unit_cost: number | null;
  supplier: string | null;
  notes: string | null;
  created_at: string;
}


// ---- Job sheets ---------------------------------------------------------
export type JobStatus = 'draft' | 'sent' | 'submitted' | 'approved' | 'archived' | 'declined';
export type JobFieldStatus = 'pending' | 'done' | 'partial' | 'skipped';

export interface SpraySpecLine { name: string; spray_product_id: string | null; l_per_ha: number | null; }

export interface Job {
  id: string;
  user_id: string;
  created_by: string | null;
  title: string;
  job_type: string;
  status: JobStatus;
  product_id: number | null;
  rate_value: number | null;
  rate_unit: string | null;
  water_l_per_ha: number | null;
  spray_spec: SpraySpecLine[] | null;
  instruction: string | null;
  notes: string | null;
  due_date: string | null;
  assignee_user_id: string | null;
  delegated_to_user_id: string | null;
  contractor_label: string | null;
  work_started_at: string | null;
  work_minutes: number | null;
  farm_name: string | null;
  share_token: string | null;
  share_pin: string | null;
  share_expires_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  declined_reason: string | null;
  declined_at: string | null;
  created_at: string;
}

export interface JobField {
  id: string;
  job_id: string;
  field_id: string | null;
  field_name: string;
  boundary: unknown | null;
  area_ha: number | null;
  planned_rate_value: number | null;
  planned_rate_unit: string | null;
  status: JobFieldStatus;
  actual_rate_value: number | null;
  completion_note: string | null;
  sort_order: number;
  created_at: string;
}

export interface JobWithFields extends Job { fields: JobField[]; }


export interface ContractorProfile {
  user_id: string;
  code: string;
  business_name: string | null;
  created_at: string;
}

export interface FarmContractor {
  id: string;
  owner_id: string;
  contractor_user_id: string;
  label: string | null;
  created_at: string;
}

// =====================================================================
// Crops — catalogue rows + per-field, per-season crop allocations
// =====================================================================
//
// A field's "use this season" is DERIVED, not stored on the field: a field
// with an active crop allocation for the current season (1 Oct–30 Sep) is a
// crop field; otherwise it's grass (default, unchanged). See lib/cropplan.ts.
//
// Season is identified by its END year to match getSeasonLabel():
//   season 2026 == 1 Oct 2025 – 30 Sep 2026.

/** Lifecycle of a crop on a field. Only one 'active' allocation per field at a
 *  time (enforced by a partial unique index) — a catch crop goes 'harvested'
 *  before a main crop becomes 'active'. */
export type CropAllocationStatus = 'planned' | 'active' | 'harvested' | 'terminated';

/** A row in the user-editable crop catalogue (public.crops). Shared seed rows
 *  have user_id = null + a stable seed_key; user forks/customs have a user_id
 *  and (usually) null seed_key. The row is a superset of CropProfile, so it
 *  maps straight onto the in-memory profile the engine consumes — CropProfile
 *  lives in lib/crops.ts to avoid a circular import with the agronomy engine. */
export interface CropCatalogueRow {
  id: string;
  user_id: string | null;
  seed_key: string | null;
  sort_order: number;
  created_at: string;
  // ...plus every CropProfile field, persisted as columns / jsonb.
}

/** A field allocated to a crop for a season. Drives the crop nutrient plan and
 *  removes the field from the grass machinery for that season. */
export interface FieldCropAllocation {
  id: string;
  /** Farm owner (admin) — all shared data is owned by this id. */
  user_id: string;
  field_id: string;
  /** FK → public.crops.id (the chosen profile: a shared seed or a user fork). */
  crop_id: string;
  /** Denormalised stable key of the crop, copied at allocation time so the
   *  engine and rotation logic don't need a join. Null only if the crop row
   *  had no key. */
  crop_key: string | null;
  /** Season end-year, e.g. 2026 = 1 Oct 2025 – 30 Sep 2026. */
  season: number;
  expected_yield: number | null;
  expected_yield_unit: string | null;
  sown_date: string | null;
  harvest_date: string | null;
  status: CropAllocationStatus;
  notes: string | null;
  /** Who created the allocation (admin or staff). */
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// --- Agri-environment agreements (third grouping axis) -----------------
// The agreement row shape lives with its logic in lib/agreements.ts; re-export
// it here under the app-facing name so loaders/actions import from one place.
export type { AgreementRow as Agreement, AgreementScheme } from './agreements';
export type { AllocationTypeRow as AllocationType, AllocationKind, DressingRhythm } from './allocation_types';

/** A field's membership in an agreement (many-to-many join row). */
export interface FieldAgreement {
  id: string;
  /** Farm owner (admin) — all shared data is owned by this id. */
  user_id: string;
  field_id: string;
  agreement_id: string;
  /** Who created the membership (admin or staff). */
  created_by: string | null;
  created_at: string;
}
