// lib/partials.ts
// ---------------------------------------------------------------------------
// Partial (part-field) applications: the accounting gate, K₂O-loading bands,
// the per-field overlap-accumulation grid, and reconciliation coverage.
//
// PURE + ISOMORPHIC. No DOM, no React, no next, no Supabase. Safe to import
// from both server actions (reconciliation) and client components (heat map).
// Coordinates are GeoJSON order throughout: [longitude, latitude].
//
// THE MODEL (see the feature spec):
//  - A partial application deposits its rate's K₂O *per hectare* across the
//    drawn area. A point's loading = the SUM of the K₂O/ha of every patch
//    covering it (overlaps accumulate), expressed in kg K₂O per ACRE and
//    banded. The drawn area cancels for a single patch — only OVERLAP raises
//    the band. K₂O is not N-availability-discounted, so loading = raw potash.
//  - A partial application is PENDING (excluded from every field nutrient
//    metric) until its field reconciles — i.e. until the union of the field's
//    pending partial areas covers >= RECONCILE_COVERAGE_THRESHOLD of the field.
//    On reconciliation it folds in AREA-WEIGHTED: a patch covering fraction f
//    of the field at intensity I contributes I × f to the field per-ha figure.
// ---------------------------------------------------------------------------

import { calcNutrients } from "@/lib/rules";
import {
  bboxOfGeometry,
  polygonAreaHectares,
  type FieldGeometry,
  type Position,
} from "@/lib/geo";
import type { Application, Product } from "@/lib/types";

/** Union of pending partial areas must cover at least this fraction of the
 *  field before the partials fold into the field's nutrient metrics. Kept as a
 *  constant for now (hand-drawing slop tolerance); promote to a per-farm
 *  setting later if needed. */
export const RECONCILE_COVERAGE_THRESHOLD = 0.80;

/** 1 acre = 0.404686 ha. kg/ha → kg/ac is a multiply by this (areal factor). */
export const KG_PER_HA_TO_KG_PER_AC = 0.404686;

// ---- K₂O loading bands (kg K₂O per acre) ---------------------------------
// Upper edges of the first five bands; the sixth (>150) is open-ended.
export const K_BAND_EDGES = [30, 60, 90, 120, 150] as const;
export const K_BAND_LABELS = ["<30", "30–60", "60–90", "90–120", "120–150", ">150"] as const;
// Yellow → orange → red ramp (extends SpreadMapShell's BAND_COLOURS to 6
// stops; <30 and >150 get their own shades).
export const K_BAND_COLOURS = [
  "#FDE9A6", // <30      pale yellow
  "#FDE047", // 30–60    yellow
  "#F6B73C", // 60–90    amber
  "#FB923C", // 90–120   orange
  "#EF4444", // 120–150  red
  "#B91C1C", // >150     deep red
] as const;

/** Band index 0..5 for a kg K₂O/ac value. */
export function kBandIndex(kPerAc: number): number {
  for (let i = 0; i < K_BAND_EDGES.length; i++) {
    if (kPerAc < K_BAND_EDGES[i]) return i;
  }
  return K_BAND_EDGES.length; // 5 → ">150"
}

// ---- Pending / reconciled classification ---------------------------------

/** A partial application whose field has NOT reconciled — visible on the heat
 *  map + the part-applications list, but excluded from all nutrient metrics. */
export function isPendingPartial(a: Application): boolean {
  return a.coverage === "partial" && !a.reconciled_at;
}

/** A partial application whose field HAS reconciled — folds into metrics
 *  (area-weighted). */
export function isReconciledPartial(a: Application): boolean {
  return a.coverage === "partial" && !!a.reconciled_at;
}

// ---- The accounting gate -------------------------------------------------
// Wrap any list of applications before summing nutrients for a field. Drops
// pending partials entirely; scales reconciled partials' rate by their
// coverage fraction so calcNutrients yields the area-weighted per-ha figure
// (calcNutrients is linear in rate; N availability is rate-independent, so
// scaling the rate scales N/P/K/S/Mg by the same fraction — exactly the
// area-weighting we want). Whole-field applications pass through unchanged.
//
// fieldHa resolves a field_id to the field's area (ha) used as the coverage
// denominator — use fieldAreaHa(field) so it matches the heat map / coverage.

export type FieldHaResolver = (fieldId: string) => number | null | undefined;

export function meteredApps(apps: Application[], fieldHa: FieldHaResolver): Application[] {
  const out: Application[] = [];
  for (const a of apps) {
    if (a.coverage === "partial") {
      if (!a.reconciled_at) continue; // pending → excluded from metrics
      const ha = fieldHa(a.field_id) ?? 0;
      const w = ha > 0 && a.drawn_ha ? Math.min(1, a.drawn_ha / ha) : 1;
      out.push({ ...a, rate_value: a.rate_value * w });
    } else {
      out.push(a);
    }
  }
  return out;
}

/** The field-area denominator for coverage + area-weighting: the mapped
 *  boundary area when present (consistent with the drawn-patch geodesic
 *  areas), else the entered hectares. */
export function fieldAreaHa(field: { ha: number; area_ha_mapped?: number | null }): number {
  const mapped = field.area_ha_mapped;
  return mapped != null && mapped > 0 ? mapped : field.ha;
}

// ---- Per-patch K₂O intensity --------------------------------------------

/** kg K₂O per hectare delivered by an application at its logged rate. Reuses
 *  the canonical nutrient engine — never re-derive the rate→K₂O conversion. */
export function patchK2oPerHa(app: Application, products: Product[]): number {
  const product = products.find((p) => p.id === app.product_id);
  return calcNutrients(product, app.rate_value, app.rate_unit, app.date_applied, app.method).k2oPerHa || 0;
}

// ---- Point-in-polygon (pure ray-casting, fast inner loop) ----------------
// Hand-rolled even-odd test so the grid can run hundreds of thousands of hits
// without per-call allocations. Holes handled for Polygon (ring 0 outer, rest
// holes); MultiPolygon = inside any sub-polygon.

function pointInRing(lng: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, rings: Position[][]): boolean {
  if (rings.length === 0) return false;
  if (!pointInRing(lng, lat, rings[0])) return false; // outside the outer ring
  for (let h = 1; h < rings.length; h++) {
    if (pointInRing(lng, lat, rings[h])) return false; // inside a hole
  }
  return true;
}

/** Is [lng,lat] inside a Polygon / MultiPolygon? */
export function pointInGeometry(lng: number, lat: number, geom: FieldGeometry): boolean {
  if (geom.type === "Polygon") {
    return pointInPolygon(lng, lat, geom.coordinates as Position[][]);
  }
  for (const poly of geom.coordinates as Position[][][]) {
    if (pointInPolygon(lng, lat, poly)) return true;
  }
  return false;
}

// ---- The accumulation grid -----------------------------------------------

export interface HeatPatch {
  geometry: FieldGeometry;
  /** kg K₂O per hectare this patch deposits across its area. */
  kPerHa: number;
}

export interface HeatGrid {
  cols: number;
  rows: number;
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number };
  /** Per-cell band: -1 outside the field; -2 in-field but no application;
   *  0..5 the K₂O/ac band. Row-major, length cols*rows. */
  band: Int8Array;
  /** Per-cell summed kg K₂O/ac (0 where outside / uncovered). */
  kPerAc: Float32Array;
  inFieldCells: number;
  coveredCells: number;
  /** coveredCells / inFieldCells — the reconciliation coverage. */
  coverageFraction: number;
  /** Highest band index present (for legend trimming); -1 if none. */
  maxBand: number;
}

/** Choose aspect-correct grid dimensions for a bbox, `resolution` cells on the
 *  longer side (in metres, using cos(lat) so cells are ~square). */
function gridDims(
  b: { minLng: number; minLat: number; maxLng: number; maxLat: number },
  resolution: number,
): { cols: number; rows: number } {
  const latMid = (b.minLat + b.maxLat) / 2;
  const kx = Math.cos((latMid * Math.PI) / 180) || 1;
  const wM = (b.maxLng - b.minLng) * 111320 * kx;
  const hM = (b.maxLat - b.minLat) * 110540;
  if (wM <= 0 || hM <= 0) return { cols: resolution, rows: resolution };
  if (wM >= hM) {
    return { cols: resolution, rows: Math.max(1, Math.round((resolution * hM) / wM)) };
  }
  return { cols: Math.max(1, Math.round((resolution * wM) / hM)), rows: resolution };
}

/**
 * Build the K₂O-loading grid for a field: for each cell centre inside the
 * boundary, sum the K₂O/ha of every patch covering it, convert to kg K₂O/ac,
 * and band it. Also returns the reconciliation coverage (fraction of in-field
 * cells covered by >= 1 patch). `resolution` is cells on the longer side.
 */
export function buildHeatGrid(
  boundary: FieldGeometry,
  patches: HeatPatch[],
  resolution = 120,
): HeatGrid {
  const bbox = bboxOfGeometry(boundary);
  const { cols, rows } = gridDims(bbox, resolution);
  const band = new Int8Array(cols * rows);
  const kPerAc = new Float32Array(cols * rows);
  const wDeg = bbox.maxLng - bbox.minLng;
  const hDeg = bbox.maxLat - bbox.minLat;

  let inFieldCells = 0;
  let coveredCells = 0;
  let maxBand = -1;

  for (let r = 0; r < rows; r++) {
    const lat = bbox.maxLat - ((r + 0.5) / rows) * hDeg; // top-down
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const lng = bbox.minLng + ((c + 0.5) / cols) * wDeg;
      if (!pointInGeometry(lng, lat, boundary)) {
        band[idx] = -1; // outside the field
        continue;
      }
      inFieldCells++;
      let sumKHa = 0;
      let covered = false;
      for (let p = 0; p < patches.length; p++) {
        if (pointInGeometry(lng, lat, patches[p].geometry)) {
          sumKHa += patches[p].kPerHa;
          covered = true;
        }
      }
      if (!covered) {
        band[idx] = -2; // in-field, no application here
        continue;
      }
      coveredCells++;
      const perAc = sumKHa * KG_PER_HA_TO_KG_PER_AC;
      kPerAc[idx] = perAc;
      const bi = kBandIndex(perAc);
      band[idx] = bi as number;
      if (bi > maxBand) maxBand = bi;
    }
  }

  return {
    cols,
    rows,
    bbox,
    band,
    kPerAc,
    inFieldCells,
    coveredCells,
    coverageFraction: inFieldCells > 0 ? coveredCells / inFieldCells : 0,
    maxBand,
  };
}

/**
 * Reconciliation coverage only (no banding) — fraction of the field's in-field
 * grid cells covered by >= 1 of the given drawn areas. Used server-side to
 * decide whether a field's partials fold into the metrics.
 */
export function coverageFraction(
  boundary: FieldGeometry,
  patchGeoms: FieldGeometry[],
  resolution = 120,
): number {
  const bbox = bboxOfGeometry(boundary);
  const { cols, rows } = gridDims(bbox, resolution);
  const wDeg = bbox.maxLng - bbox.minLng;
  const hDeg = bbox.maxLat - bbox.minLat;
  let inField = 0;
  let covered = 0;
  for (let r = 0; r < rows; r++) {
    const lat = bbox.maxLat - ((r + 0.5) / rows) * hDeg;
    for (let c = 0; c < cols; c++) {
      const lng = bbox.minLng + ((c + 0.5) / cols) * wDeg;
      if (!pointInGeometry(lng, lat, boundary)) continue;
      inField++;
      for (let p = 0; p < patchGeoms.length; p++) {
        if (pointInGeometry(lng, lat, patchGeoms[p])) {
          covered++;
          break;
        }
      }
    }
  }
  return inField > 0 ? covered / inField : 0;
}

/** Convenience: geodesic area (ha) of a drawn sub-area. Re-exported from geo
 *  so callers have one import for the partials maths. */
export function drawnAreaHectares(geometry: FieldGeometry): number {
  return polygonAreaHectares(geometry);
}
