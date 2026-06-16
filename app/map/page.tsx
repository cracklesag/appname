// app/map/page.tsx
// Server page for the whole-farm map. Loads fields + map settings on the server, then hands
// plain props to the client shell. Follows the app's server-page → client-shell pattern.
//
// INTEGRATION:
//   - `loadFields` and `Header` should resolve to the app's existing modules.
//   - Header props used here (title/subtitle/backHref) match the documented Header API; adjust if needed.

import { loadFields, loadSettings, loadGroups, loadAllocationTypes, loadAgreements, loadFieldAgreementMap } from "@/lib/data";
import { loadMapSettings } from "@/lib/map-data";
import { getFieldLimeRecommendation } from "@/lib/rules";
import { Header } from "@/components/Header";
import FarmMapShell from "@/components/FarmMapShell";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  const [fields, mapSettings, settings, groups, allocationTypes, agreements, fieldAgreementMap] = await Promise.all([
    loadFields(), loadMapSettings(), loadSettings(), loadGroups(), loadAllocationTypes(), loadAgreements(), loadFieldAgreementMap(),
  ]);

  // id → label maps for the categorical colour legends.
  const blockNames: Record<string, string> = Object.fromEntries(groups.map((g) => [g.id, g.name]));
  const typeNames: Record<string, string> = Object.fromEntries(allocationTypes.map((t) => [t.id, t.label]));
  const agreementCodes: Record<string, string> = Object.fromEntries(agreements.map((a) => [a.id, a.code]));

  // Keep the payload small — send only what the map needs.
  const mapFields = fields.map((f) => {
    // Lime status for the heatmap: reflects the real recommendation (each
    // field's soil-specific target pH and whether lime is actually due), not a
    // flat threshold. 'unknown' = no pH on record.
    const lime = getFieldLimeRecommendation(f, settings);
    const limeStatus: 'ok' | 'low' | 'due' | 'unknown' =
      f.ph == null ? 'unknown'
        : !lime.needsLime ? 'ok'
          : (lime.targetPh - (f.ph ?? 0)) >= 0.5 ? 'due' : 'low';
    return {
      id: f.id,
      name: f.name,
      ha: f.ha ?? 0,
      acres: f.acres ?? 0,
      ph: f.ph ?? null,
      p_idx: f.p_idx ?? null,
      k_idx: f.k_idx ?? null,
      limeStatus,
      boundary: (f.boundary as object | null) ?? null,
      centroid_lat: f.centroid_lat ?? null,
      centroid_lng: f.centroid_lng ?? null,
      area_ha_mapped: f.area_ha_mapped ?? null,
      boundary_source: f.boundary_source ?? null,
      rpa_sheet_id: f.rpa_sheet_id ?? null,
      rpa_parcel_id: f.rpa_parcel_id ?? null,
      group_id: f.group_id ?? null,
      allocation_type_id: f.allocation_type_id ?? null,
      agreementIds: fieldAgreementMap[f.id] ?? [],
    };
  });

  return (
    <div className="min-h-screen bg-stone-50">
      <Header title="Farm map" subtitle="Boundaries, areas and field status" backHref="/" />
      <FarmMapShell
        fields={mapFields}
        mapSettings={mapSettings}
        mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? null}
        blockNames={blockNames}
        typeNames={typeNames}
        agreementCodes={agreementCodes}
      />
    </div>
  );
}
