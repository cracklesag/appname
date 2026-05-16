// Single source of truth for input validation ranges.
// Hard limits → save is blocked.
// Soft limits → user sees an amber warning but save proceeds.

// ---- Application rates --------------------------------------------

// All ranges are expressed in the canonical / typical UK unit per type.
export const APPLICATION_RANGES = {
  slurry:   { min: 100,  max: 5000, unit: 'gal/ac' as const, label: 'gallons/acre' },
  bag_fert: { min: 50,   max: 1000, unit: 'kg/ha'  as const, label: 'kg/ha' },
  lime:     { min: 0.5,  max: 4,    unit: 't/ac'  as const, label: 't/ac' },
};

// ---- Field properties ---------------------------------------------

export const FIELD_RANGES = {
  acres: { min: 0.1, max: 500 },   // HARD limit — typoed acres breaks per-ha calcs
  ha:    { min: 0.04, max: 202 },  // = acres ÷ 2.4711
};

// ---- Soil ---------------------------------------------------------

export const SOIL_RANGES = {
  pH:   { min: 4, max: 8.5 },  // hard limits — readings outside are physically implausible
  pIdx: { min: 0, max: 10 },
  kIdx: { min: 0, max: 10 },
};

// ---- Dates --------------------------------------------------------

export const DATE_BOUNDARIES = {
  minHistorical: '2020-01-01',                          // Anything earlier is almost certainly a typo
  futureWindowDays: 30,                                  // Allow planning up to 30d ahead
};

// ---- Validation result type ---------------------------------------

export type FieldWarning = { kind: 'warning' | 'error'; message: string } | null;

// ---- Validators ----------------------------------------------------

/** Validate an application rate; returns null if fine, or a warning to display. */
export function validateApplicationRate(
  rate: number,
  productType: 'slurry' | 'bag_fert' | 'lime',
  displayedUnit: string
): FieldWarning {
  if (!rate || rate <= 0) return { kind: 'error', message: 'Rate must be greater than 0' };
  // Only sanity-check when the user is on the canonical unit; converting first would be confusing
  const range = APPLICATION_RANGES[productType];
  if (displayedUnit !== range.unit) return null;
  if (rate < range.min) {
    return { kind: 'warning', message: `Unusually low for ${range.label} (typical is ${range.min}–${range.max}). Check this is right.` };
  }
  if (rate > range.max) {
    return { kind: 'warning', message: `Unusually high for ${range.label} (typical is ${range.min}–${range.max}). Check for a typo.` };
  }
  return null;
}

/** Validate a date string (YYYY-MM-DD); returns null or a warning. */
export function validateDate(dateStr: string): FieldWarning {
  if (!dateStr) return { kind: 'error', message: 'Date is required' };
  if (dateStr < DATE_BOUNDARIES.minHistorical) {
    return { kind: 'warning', message: `Earlier than ${DATE_BOUNDARIES.minHistorical}. Check the year is right.` };
  }
  const today = new Date();
  const max = new Date(today);
  max.setDate(max.getDate() + DATE_BOUNDARIES.futureWindowDays);
  const maxStr = max.toISOString().slice(0, 10);
  if (dateStr > maxStr) {
    return { kind: 'warning', message: `More than ${DATE_BOUNDARIES.futureWindowDays} days in the future. Check the year is right.` };
  }
  return null;
}

/** Validate a field's acres. Returns error/null. Hard limit. */
export function validateAcres(acres: number): FieldWarning {
  if (!acres || acres <= 0) return { kind: 'error', message: 'Acres must be greater than 0' };
  if (acres < FIELD_RANGES.acres.min) return { kind: 'error', message: `Acres must be at least ${FIELD_RANGES.acres.min}` };
  if (acres > FIELD_RANGES.acres.max) return { kind: 'error', message: `Acres must be at most ${FIELD_RANGES.acres.max}` };
  return null;
}

/** Validate hectares. Returns error/null. Hard limit. */
export function validateHa(ha: number): FieldWarning {
  if (!ha || ha <= 0) return { kind: 'error', message: 'Hectares must be greater than 0' };
  if (ha < FIELD_RANGES.ha.min) return { kind: 'error', message: `Hectares must be at least ${FIELD_RANGES.ha.min}` };
  if (ha > FIELD_RANGES.ha.max) return { kind: 'error', message: `Hectares must be at most ${FIELD_RANGES.ha.max}` };
  return null;
}

/** Validate soil pH. Returns warning if outside plausible range. */
export function validatePH(ph: number | null): FieldWarning {
  if (ph == null) return null;
  if (ph < SOIL_RANGES.pH.min || ph > SOIL_RANGES.pH.max) {
    return { kind: 'warning', message: `pH ${ph} is outside the typical ${SOIL_RANGES.pH.min}–${SOIL_RANGES.pH.max} range. Check the value.` };
  }
  return null;
}

/** Validate soil P or K index. */
export function validateSoilIndex(value: number | null, label: 'P' | 'K'): FieldWarning {
  if (value == null) return null;
  if (value < SOIL_RANGES.pIdx.min || value > SOIL_RANGES.pIdx.max) {
    return { kind: 'warning', message: `${label} index ${value} is outside the typical 0–10 range. Check the value.` };
  }
  return null;
}
