// app/map/page.tsx
// Server page for the whole-farm map. Loads fields + map settings on the server, then hands
// plain props to the client shell. Follows the app's server-page → client-shell pattern.
//
// INTEGRATION:
//   - `loadFields` and `Header` should resolve to the app's existing modules.
//   - Header props used here (title/subtitle/backHref) match the documented Header API; adjust if needed.

import { loadFields } from "@/lib/data";
import { loadMapSettings } from "@/lib/map-data";
import { Header } from "@/components/Header";
import FarmMapShell from "@/components/FarmMapShell";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  const [fields, mapSettings] = await Promise.all([loadFields(), loadMapSettings()]);

  // Keep the payload small — send only what the map needs.
  const mapFields = fields.map((f) => ({
    id: f.id,
    name: f.name,
    ha: f.ha ?? 0,
    acres: f.acres ?? 0,
    ph: f.ph ?? null,
    p_idx: f.p_idx ?? null,
    k_idx: f.k_idx ?? null,
    boundary: (f.boundary as object | null) ?? null,
    centroid_lat: f.centroid_lat ?? null,
    centroid_lng: f.centroid_lng ?? null,
    area_ha_mapped: f.area_ha_mapped ?? null,
    boundary_source: f.boundary_source ?? null,
  }));

  return (
    <div className="min-h-screen bg-stone-50">
      <Header title="Farm map" subtitle="Boundaries, areas and field status" backHref="/" />
      <FarmMapShell
        fields={mapFields}
        mapSettings={mapSettings}
        mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? null}
      />
    </div>
  );
}
