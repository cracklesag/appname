// lib/geo.ts
// Pure geometry helpers for field boundaries. No DB or framework dependencies.
// Coordinates are GeoJSON order throughout: [longitude, latitude].

import area from "@turf/area";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

export type Position = [number, number];

export type PolygonGeometry = {
  type: "Polygon";
  coordinates: Position[][];
};

export type MultiPolygonGeometry = {
  type: "MultiPolygon";
  coordinates: Position[][][];
};

export type FieldGeometry = PolygonGeometry | MultiPolygonGeometry;

export type Bbox = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

/**
 * Area of a polygon / multipolygon in hectares.
 * Turf computes a geodesic area on the WGS84 ellipsoid, so this is accurate at
 * UK latitudes without any reprojection. Used only for hand-drawn boundaries —
 * adopted RPA parcels already carry their official AREA_HA.
 */
export function polygonAreaHectares(geometry: FieldGeometry): number {
  const squareMetres = area({ type: "Feature", geometry, properties: {} } as never);
  return squareMetres / 10_000;
}

function forEachPosition(geometry: FieldGeometry, fn: (p: Position) => void): void {
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) for (const p of ring) fn(p);
  } else {
    for (const poly of geometry.coordinates)
      for (const ring of poly) for (const p of ring) fn(p);
  }
}

export function bboxOfGeometry(geometry: FieldGeometry): Bbox {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  forEachPosition(geometry, ([lng, lat]) => {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  });
  return { minLng, minLat, maxLng, maxLat };
}

export function centroidOfBbox(b: Bbox): { lng: number; lat: number } {
  return { lng: (b.minLng + b.maxLng) / 2, lat: (b.minLat + b.maxLat) / 2 };
}

/** Merge several bboxes into one (e.g. to fit the whole farm in view). */
export function mergeBboxes(boxes: Bbox[]): Bbox | null {
  if (boxes.length === 0) return null;
  return boxes.reduce((acc, b) => ({
    minLng: Math.min(acc.minLng, b.minLng),
    minLat: Math.min(acc.minLat, b.minLat),
    maxLng: Math.max(acc.maxLng, b.maxLng),
    maxLat: Math.max(acc.maxLat, b.maxLat),
  }));
}

// ---------------------------------------------------------------------------
// GPS / "which field am I in" — pure helpers.
// Reused by the map (FarmMapShell) and by other screens via the useCurrentField
// hook (lib/use-current-field.ts). Coordinates are [lng,lat].
// ---------------------------------------------------------------------------

/** Is a [lng,lat] point inside a polygon / multipolygon boundary? Handles holes + MultiPolygon. */
export function pointInGeometry(point: Position, geometry: FieldGeometry): boolean {
  return booleanPointInPolygon(point, { type: "Feature", geometry, properties: {} } as never);
}

/** Great-circle distance between two [lng,lat] points, in metres. */
export function haversineMeters(a: Position, b: Position): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type LocatableField = {
  id: string;
  geometry: FieldGeometry | null;
  centroid: { lng: number; lat: number } | null;
};

export type FieldLocation = {
  insideId: string | null; // field the point sits inside, if any
  nearestId: string | null; // closest field by centroid (fallback when not inside one)
  nearestMeters: number | null;
};

/**
 * Resolve which mapped field a GPS point falls in.
 * Primary: point-in-polygon (exact). Fallback: nearest field by centroid (approximate),
 * useful when the reading lands just off a boundary or between fields.
 */
export function locateFieldAtPoint(point: Position, fields: LocatableField[]): FieldLocation {
  let insideId: string | null = null;
  let nearestId: string | null = null;
  let nearestMeters: number | null = null;

  for (const f of fields) {
    if (f.geometry && pointInGeometry(point, f.geometry)) {
      insideId = f.id;
      break;
    }
  }
  for (const f of fields) {
    if (!f.centroid) continue;
    const d = haversineMeters(point, [f.centroid.lng, f.centroid.lat]);
    if (nearestMeters == null || d < nearestMeters) {
      nearestMeters = d;
      nearestId = f.id;
    }
  }
  return { insideId, nearestId, nearestMeters };
}
