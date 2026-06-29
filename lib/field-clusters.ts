// Single-linkage geographic clustering, used to decide when a job's fields fall
// into separate areas (e.g. an outlying parcel a couple of km from the main
// block) so the job-card map can draw one frame per group instead of zooming out
// so far the main block becomes a postage stamp.

export interface GeoPoint {
  lng: number;
  lat: number;
}

const R_KM = 6371;

/** Great-circle distance between two lng/lat points, in kilometres. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Diagonal of the bounding box covering all points, in kilometres. */
export function bboxDiagonalKm(points: GeoPoint[]): number {
  if (points.length < 2) return 0;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const p of points) {
    if (p.lng < minLng) minLng = p.lng;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lng > maxLng) maxLng = p.lng;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  return haversineKm({ lng: minLng, lat: minLat }, { lng: maxLng, lat: maxLat });
}

/**
 * Single-linkage clustering: two items join the same group when they sit within
 * `gapKm` of each other, directly or via a chain of other items. So a contiguous
 * block (adjacent fields a few hundred metres apart) stays one group, while a
 * parcel well beyond the gap falls out as its own. Groups are returned in input
 * order of their first member. O(n^2) — fine for the handful of fields on a job.
 */
export function clusterByGap<T extends GeoPoint>(items: T[], gapKm: number): T[][] {
  const n = items.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (i: number, j: number) => {
    const ri = find(i), rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (haversineKm(items[i], items[j]) <= gapKm) union(i, j);
    }
  }
  const groups = new Map<number, T[]>();
  const order: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) { groups.set(r, []); order.push(r); }
    groups.get(r)!.push(items[i]);
  }
  return order.map((r) => groups.get(r)!);
}
