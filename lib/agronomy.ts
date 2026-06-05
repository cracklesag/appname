// =====================================================================
// lib/agronomy.ts — agronomist-editable RB209 reference values
// =====================================================================
//
// The engine (rb209.ts / rules.ts) reads RB209 figures with a PER-CELL
// fallback: an override value if the farm has set one, otherwise the built-in
// constant. This module provides the *defaults* (built directly from the
// rb209.ts constants, so there is a single source of truth) plus a resolver
// that produces the full effective config for the editor to display, and the
// key/label metadata the editor grids are rendered from.

import {
  SILAGE_P, SILAGE_K, GRAZING_P, GRAZING_K,
  SILAGE_K_FIRST_CUT_AUTUMN, FIRST_CUT_SPRING_K_CAP,
  EXTRA_K_AFTER_CUTTING, TARGET_P_INDEX, TARGET_K_BAND,
} from './rb209';
import type { AgronomyConfig, Settings } from './types';

// Stringify the keys of the rb209 Record constants so they line up with the
// string-keyed AgronomyConfig (which is decoupled from the engine's unions).
function strRec(r: Record<string | number, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k), v]));
}
function strRec2(r: Record<string | number, Record<string | number, number>>): Record<string, Record<string, number>> {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k), strRec(v)]));
}

// Base modelled DM yields and offtake-per-tonne mirror the rules.ts constants.
// Kept here (small, rarely-changing) to avoid a rules ↔ agronomy import cycle.
const DEFAULT_BASE_YIELDS: Record<string, number[]> = {
  '1': [5.0],
  '2': [3.7, 3.3],
  '3': [3.5, 3.0, 2.5],
  '4': [3.0, 2.8, 2.5, 2.0],
};
const DEFAULT_OFFTAKE_PER_T = { n: 23, p2o5: 8, k2o: 28 };

export const DEFAULT_AGRONOMY: AgronomyConfig = {
  silageP: strRec2(SILAGE_P as unknown as Record<string | number, Record<string | number, number>>),
  silageK: strRec2(SILAGE_K as unknown as Record<string | number, Record<string | number, number>>),
  grazingP: strRec(GRAZING_P as unknown as Record<string | number, number>),
  grazingK: strRec(GRAZING_K as unknown as Record<string | number, number>),
  firstCutAutumnK: strRec(SILAGE_K_FIRST_CUT_AUTUMN as unknown as Record<string | number, number>),
  springCap: FIRST_CUT_SPRING_K_CAP,
  extraK: strRec(EXTRA_K_AFTER_CUTTING as unknown as Record<string | number, number>),
  offtakePerT: { ...DEFAULT_OFFTAKE_PER_T },
  baseYields: JSON.parse(JSON.stringify(DEFAULT_BASE_YIELDS)),
  targetPIndex: TARGET_P_INDEX,
  targetKBand: String(TARGET_K_BAND),
};

/** Deep clone, so the editor can mutate freely without touching DEFAULT_AGRONOMY. */
export function cloneAgronomy(a: AgronomyConfig): AgronomyConfig {
  return JSON.parse(JSON.stringify(a));
}

/**
 * Effective config = the farm's stored overrides merged over the RB209
 * defaults (per top-level table). Used by the editor to display current
 * values. The engine itself uses a finer per-cell fallback at the lookup site.
 */
export function resolveAgronomy(settings: Settings): AgronomyConfig {
  const ov = settings.agronomy;
  if (!ov) return cloneAgronomy(DEFAULT_AGRONOMY);
  return {
    silageP: ov.silageP ?? cloneAgronomy(DEFAULT_AGRONOMY).silageP,
    silageK: ov.silageK ?? cloneAgronomy(DEFAULT_AGRONOMY).silageK,
    grazingP: ov.grazingP ?? { ...DEFAULT_AGRONOMY.grazingP },
    grazingK: ov.grazingK ?? { ...DEFAULT_AGRONOMY.grazingK },
    firstCutAutumnK: ov.firstCutAutumnK ?? { ...DEFAULT_AGRONOMY.firstCutAutumnK },
    springCap: ov.springCap ?? DEFAULT_AGRONOMY.springCap,
    extraK: ov.extraK ?? { ...DEFAULT_AGRONOMY.extraK },
    offtakePerT: ov.offtakePerT ?? { ...DEFAULT_AGRONOMY.offtakePerT },
    baseYields: ov.baseYields ?? JSON.parse(JSON.stringify(DEFAULT_AGRONOMY.baseYields)),
    targetPIndex: ov.targetPIndex ?? DEFAULT_AGRONOMY.targetPIndex,
    targetKBand: ov.targetKBand ?? DEFAULT_AGRONOMY.targetKBand,
  };
}

// ----- Editor metadata: key ordering + display labels for the grids ---------
export const P_INDEX_KEYS = ['0', '1', '2', '3', '4'];
export const P_INDEX_LABELS = ['0', '1', '2', '3', '4+'];
export const K_BAND_KEYS = ['0', '1', '2-', '2+', '3', '4'];
export const K_BAND_LABELS = ['0', '1', '2-', '2+', '3', '4+'];
export const CUT_KEYS = ['1', '2', '3', '4'];
export const CUT_LABELS = ['Cut 1', 'Cut 2', 'Cut 3', 'Cut 4'];
