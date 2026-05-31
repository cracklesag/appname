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

// ---------------------------------------------------------------------------
// Snap-to-boundary (draw assist)
// ---------------------------------------------------------------------------
// When hand-drawing a field on a phone, snap each tapped vertex onto a nearby
// boundary the app already knows: the edges/corners of pulled RPA parcels and
// of fields already mapped, plus the user's own in-progress drawing. This is
// pure geometry against data we hold — it does NOT analyse the satellite image
// (detecting a hedge from pixels isn't feasible client-side).

/** A boundary as a flat list of rings, each ring a list of [lng,lat] points. */
export type SnapRing = Position[];

/** Local metres-per-degree at a latitude, for planar near-distance maths.
 *  Good enough at field scale; we use haversine for the final accept test. */
function metresPerDegree(lat: number): { x: number; y: number } {
  const latRad = (lat * Math.PI) / 180;
  return {
    x: 111320 * Math.cos(latRad), // lng
    y: 110540,                    // lat
  };
}

/** Closest point on segment a→b to point p, all [lng,lat], plus its distance
 *  in metres. Planar projection around p's latitude (fine at field scale). */
function closestOnSegment(
  p: Position,
  a: Position,
  b: Position,
): { point: Position; meters: number } {
  const m = metresPerDegree(p[1]);
  const px = p[0] * m.x, py = p[1] * m.y;
  const ax = a[0] * m.x, ay = a[1] * m.y;
  const bx = b[0] * m.x, by = b[1] * m.y;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  const meters = Math.hypot(px - cx, py - cy);
  const point: Position = [(ax + t * dx) / m.x, (ay + t * dy) / m.y];
  return { point, meters };
}

/**
 * Snap a tapped point to the nearest known boundary within `toleranceMeters`.
 * Prefers snapping to a VERTEX (corner) when one is within tolerance — corners
 * are what people aim for — otherwise to the nearest point along an edge.
 * Returns the snapped point and what it locked onto, or the original point with
 * `snapped: false` if nothing's near.
 */
export function snapPoint(
  point: Position,
  rings: SnapRing[],
  toleranceMeters = 12,
): { point: Position; snapped: boolean; kind: "vertex" | "edge" | null } {
  let bestVertex: { point: Position; meters: number } | null = null;
  let bestEdge: { point: Position; meters: number } | null = null;

  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const v = ring[i];
      // Vertex distance
      const vd = haversineMeters(point, v);
      if (vd <= toleranceMeters && (!bestVertex || vd < bestVertex.meters)) {
        bestVertex = { point: v, meters: vd };
      }
      // Edge distance (segment to the next vertex)
      if (i < ring.length - 1) {
        const seg = closestOnSegment(point, v, ring[i + 1]);
        if (seg.meters <= toleranceMeters && (!bestEdge || seg.meters < bestEdge.meters)) {
          bestEdge = seg;
        }
      }
    }
  }

  // Vertices win ties / take priority when comparably close.
  if (bestVertex && (!bestEdge || bestVertex.meters <= bestEdge.meters + 1)) {
    return { point: bestVertex.point, snapped: true, kind: "vertex" };
  }
  if (bestEdge) {
    return { point: bestEdge.point, snapped: true, kind: "edge" };
  }
  return { point, snapped: false, kind: null };
}

/** Pull every ring out of a polygon / multipolygon geometry for snapping. */
export function ringsOfGeometry(geometry: FieldGeometry | null | undefined): SnapRing[] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates as SnapRing[];
  if (geometry.type === "MultiPolygon") {
    const out: SnapRing[] = [];
    for (const poly of geometry.coordinates) for (const ring of poly) out.push(ring as SnapRing);
    return out;
  }
  return [];
}
