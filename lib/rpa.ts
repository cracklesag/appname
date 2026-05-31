// lib/rpa.ts
// Server-side client for the RPA (England) Land Parcels WFS.
//   Docs:  https://environment.data.gov.uk/rpa/api-doc/
//   Data:  © Crown copyright / Rural Payments Agency, OS-derived (see licence note below).
//
// Returns each registered parcel's boundary as GeoJSON in [lng,lat] order, plus its
// official area (AREA_HA) and national grid reference (SHEET_ID + PARCEL_ID).
//
// ENGLAND ONLY. Wales/Scotland/NI run separate systems — those farms use draw-your-own.
//
// LICENCE: parcels are derived from OS MasterMap. Before calling this for a farm, the user
// must have accepted the OS End User Licence (we gate on map_settings.os_licence_accepted_at).
// Call this from the server only — keeps the SBI out of the browser's network tab and avoids CORS.

import { bboxOfGeometry, centroidOfBbox, type FieldGeometry, type Bbox } from "./geo";

const RPA_BASE = "https://environment.data.gov.uk/data-services/RPA";

export type RpaParcel = {
  rpaId: string; // RPA primary key
  sheetId: string; // 1km grid sheet — with parcelId this is the field's reference
  parcelId: string;
  areaHa: number; // official area in hectares (what subsidies are paid on)
  geometry: FieldGeometry;
  centroid: { lng: number; lat: number };
  bbox: Bbox;
};

export class RpaError extends Error {}

export function isValidSbi(sbi: string): boolean {
  return /^\d{9}$/.test(sbi.trim());
}

function buildLandParcelsUrl(sbi: string): string {
  const params = new URLSearchParams({
    version: "2.0.0",
    request: "GetFeature",
    typeNames: "RPA:LandParcels",
    cql_filter: `SBI=${sbi}`,
    srsname: "EPSG:4326",
    outputFormat: "application/json",
  });
  return `${RPA_BASE}/LandParcels/wfs/?${params.toString()}`;
}

/**
 * WFS can return EPSG:4326 in lat,lng order. UK longitude is always between -9 and +2,
 * so it can never land in the 49–61 latitude band. If the first number of a pair sits in
 * that band, the pair is lat,lng and we flip it to GeoJSON's lng,lat. Reliable for UK data.
 */
function normalisePosition(p: number[]): [number, number] {
  const [a, b] = p;
  if (a >= 49 && a <= 61) return [b, a];
  return [a, b];
}

function normaliseGeometry(geom: { type: string; coordinates: unknown }): FieldGeometry {
  if (geom.type === "Polygon") {
    const rings = geom.coordinates as number[][][];
    return { type: "Polygon", coordinates: rings.map((ring) => ring.map(normalisePosition)) };
  }
  if (geom.type === "MultiPolygon") {
    const polys = geom.coordinates as number[][][][];
    return {
      type: "MultiPolygon",
      coordinates: polys.map((poly) => poly.map((ring) => ring.map(normalisePosition))),
    };
  }
  throw new RpaError(`Unsupported geometry type from RPA: ${geom.type}`);
}

/** Fetch all registered land parcels for an SBI. Throws RpaError on a bad response. */
export async function fetchRpaParcels(sbi: string): Promise<RpaParcel[]> {
  const trimmed = sbi.trim();
  if (!isValidSbi(trimmed)) throw new RpaError("SBI must be 9 digits.");

  // `next.revalidate` caches the gov WFS for an hour (it only refreshes twice weekly).
  const init: RequestInit & { next?: { revalidate?: number } } = {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
  };

  let res: Response;
  try {
    res = await fetch(buildLandParcelsUrl(trimmed), init);
  } catch {
    throw new RpaError("Could not reach the RPA land service. Please try again shortly.");
  }
  if (!res.ok) throw new RpaError(`RPA land service returned ${res.status}.`);

  const json = (await res.json()) as { features?: unknown[] };
  const features = Array.isArray(json.features) ? json.features : [];

  return features.map((raw) => {
    const f = raw as { id?: string; geometry: { type: string; coordinates: unknown }; properties?: Record<string, unknown> };
    const geometry = normaliseGeometry(f.geometry);
    const bbox = bboxOfGeometry(geometry);
    const props = f.properties ?? {};
    const areaRaw = props.AREA_HA;
    return {
      rpaId: String(props.ID ?? f.id ?? ""),
      sheetId: String(props.SHEET_ID ?? ""),
      parcelId: String(props.PARCEL_ID ?? ""),
      areaHa: typeof areaRaw === "number" ? areaRaw : Number(areaRaw) || 0,
      geometry,
      bbox,
      centroid: centroidOfBbox(bbox),
    } satisfies RpaParcel;
  });
}
