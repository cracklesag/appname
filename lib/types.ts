export type ProductType = 'bag_fert' | 'slurry' | 'solid_manure' | 'lime';
export type CutType = 'silage' | 'bales' | 'grazing';
export type YieldClass = 'light' | 'average' | 'heavy';
export type SlurryMethod = 'splash_plate' | 'dribble_bar' | 'trail_shoe';
export type SolidMethod  = 'surface' | 'soil_incorporated';
export type ApplicationMethod = SlurryMethod | SolidMethod;
export type RateUnit = 'kg/ha' | 'kg/ac' | 'lb/ac' | 'gal/ac' | 'm3/ha' | 't/ac' | 't/ha';

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
  sampled: boolean;
  sample_date: string | null;
  soil_type: SoilType;
  last_ploughed: string | null;
  last_reseeded: string | null;
  notes: string | null;
  needs_setup: boolean;
  created_at: string;
  updated_at: string;
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
}

export interface Product {
  id: number;
  user_id: string | null;
  name: string;
  type: ProductType;
  category: ProductCategory | null;
  sort_order: number;
  dm_pct: number | null;
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
  field_id: string;
  product_id: number;
  date_applied: string;
  rate_value: number;
  rate_unit: RateUnit;
  method: ApplicationMethod | null;
  notes: string | null;
  applied_by: string;
  created_at: string;
}

export interface Cut {
  id: string;
  user_id: string;
  field_id: string;
  cut_number: number;
  cut_date: string;
  cut_type: CutType;
  yield_class: YieldClass;
  notes: string | null;
  created_at: string;
}

export interface Settings {
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
     * Maximum N allowed across the season for an intensive grass system,
     * kg N/ha. RB209 default 320 for cut+grazed; lower for clover-rich.
     * One global default; per-field override deferred to a later chunk.
     */
    annualNCapKgPerHa: number;
    /**
     * Grazing top-up cadence — used by the grazing report (chunk 2).
     * Carrying the slot now so the schema doesn't need migrating later.
     */
    grazingCadenceKgN: number;
    grazingCadenceWeeks: number;
  };
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
  },
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
