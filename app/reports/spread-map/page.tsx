import { redirect } from 'next/navigation';
import {
  loadFields, loadAllApplications, loadAllCuts, loadAllProducts, loadGroups, loadSettings,
} from '@/lib/data';
import { loadMapSettings } from '@/lib/map-data';
import { buildFertPlanRows } from '@/lib/fertplan';
import { SpreadMapShell, SpreadMapField } from '@/components/SpreadMapShell';
import { Product } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SpreadMapPage({
  searchParams,
}: {
  searchParams: { mode?: string; from?: string };
}) {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');

  const [fields, applications, cuts, products, groups, mapSettings] = await Promise.all([
    loadFields(),
    loadAllApplications(),
    loadAllCuts(),
    loadAllProducts(),
    loadGroups(),
    loadMapSettings(),
  ]);

  const rows = buildFertPlanRows(fields, applications, cuts, products, settings, groups);

  const isOrganic = (p: Product) => p.type === 'slurry' || p.type === 'solid_manure';
  const planProducts = products.filter((p) => p.type === 'bag_fert' || isOrganic(p));

  const mode = (searchParams.mode === 'slurry' ? 'slurry' : 'granular') as 'granular' | 'slurry';

  // Geometry the map needs — only fields that actually have a boundary can be
  // drawn. Keyed by id so the shell can match them to planned rows.
  const geometry: SpreadMapField[] = fields
    .filter((f) => f.boundary)
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
      fromHref={searchParams.from || `/reports/spread-list?mode=${mode}&from=/reports/fert-plan`}
      minSpreadP2O5KgPerHa={settings.reportDefaults.minSpreadP2O5KgPerHa}
      minSpreadK2OKgPerHa={settings.reportDefaults.minSpreadK2OKgPerHa}
    />
  );
}
