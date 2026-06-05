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
export type SoilType = 'light_sand' | 'medium_loam' | 'heavy_clay' | 'deep_silt';

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
  name: string;
  acres: number;
  ha: number;
  cut_profile: number;
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
   * Grass system IDs the user has hidden from their dropdown. Shared seeds
   * appear by default; users tick visibility checkboxes in Settings →
   * Grass systems. Stored as IDs because seed_key isn't unique across
   * user-custom rows.
   */
  hiddenGrassSystemIds: string[];
  /**
   * Agronomist-editable RB209 overrides (partial — only the values changed
   * from the built-in defaults are stored). Undefined = use RB209 defaults.
   */
  agronomy?: AgronomyOverrides;
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
  hiddenGrassSystemIds: [],
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
