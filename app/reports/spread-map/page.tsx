import { redirect } from 'next/navigation';
import {
  loadFields, loadAllApplications, loadAllCuts, loadAllProducts, loadGroups, loadSettings, loadGrassSystems,
} from '@/lib/data';
import { loadMapSettings } from '@/lib/map-data';
import { buildFertPlanRows } from '@/lib/fertplan';
import { SpreadMapShell, SpreadMapField } from '@/components/SpreadMapShell';
import { Product } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SpreadMapPage({
  searchParams,
}: {
  searchParams: { mode?: string; from?: string; group?: string };
}) {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');

  const [fields, applications, cuts, products, groups, mapSettings, grassSystems] = await Promise.all([
    loadFields(),
    loadAllApplications(),
    loadAllCuts(),
    loadAllProducts(),
    loadGroups(),
    loadMapSettings(),
    loadGrassSystems(),
  ]);

  const allRows = buildFertPlanRows(fields, applications, cuts, products, settings, groups, grassSystems);

  // Respect the same block filter the spread list used, so the map sheets show
  // only the block's fields.
  const group = searchParams.group;
  const rows = !group
    ? allRows
    : group === 'ungrouped'
      ? allRows.filter((r) => !r.groupId)
      : allRows.filter((r) => r.groupId === group);

  const isOrganic = (p: Product) => p.type === 'slurry' || p.type === 'solid_manure';
  const planProducts = products.filter((p) => p.type === 'bag_fert' || isOrganic(p));

  const mode = (searchParams.mode === 'slurry' ? 'slurry' : 'granular') as 'granular' | 'slurry';

  // Only fields appearing in the (possibly filtered) rows are eligible, and
  // only those with a boundary can actually be drawn.
  const rowIds = new Set(rows.map((r) => r.id));
  const geometry: SpreadMapField[] = fields
    .filter((f) => f.boundary && rowIds.has(f.id))
    .map((f) => ({
      id: f.id,
      name: f.name,
      boundary: f.boundary as object,
      centroid_lat: f.centroid_lat ?? null,
      centroid_lng: f.centroid_lng ?? null,
    }));

  return (
    <SpreadMapShell
      rows={rows}
      geometry={geometry}
      products={planProducts}
      unitSystem={settings.unitSystem}
      slurryUnit={settings.slurryUnit}
      mode={mode}
      mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? null}
      fromHref={searchParams.from || `/reports/spread-list?mode=${mode}&from=/plan`}
      minSpreadP2O5KgPerHa={settings.reportDefaults.minSpreadP2O5KgPerHa}
      minSpreadK2OKgPerHa={settings.reportDefaults.minSpreadK2OKgPerHa}
    />
  );
}
