import { redirect } from 'next/navigation';
import { SprayMapShell, type SprayMapField, type SpraySummary } from '@/components/SprayMapShell';
import { loadSprayRecords, loadFields, loadSettings } from '@/lib/data';
import { fmtDate } from '@/lib/rules';

export const dynamic = 'force-dynamic';

export default async function SprayMapPage({
  searchParams,
}: {
  searchParams: { from?: string };
}) {
  const [records, fields, settings] = await Promise.all([loadSprayRecords(), loadFields(), loadSettings()]);
  if (!settings.onboarded) redirect('/welcome');

  const byField = new Map<string, SpraySummary[]>();
  for (const r of records) {
    const list = byField.get(r.field_id) ?? [];
    list.push({
      dateLabel: fmtDate(r.date_applied),
      product: r.product_name,
      targets: r.targets ?? [],
      coverage: r.coverage,
      areaHa: r.area_ha,
      polygon: (r.polygon as object | null) ?? null,
    });
    byField.set(r.field_id, list);
  }

  const mapFields: SprayMapField[] = fields
    .filter((f) => f.boundary)
    .map((f) => ({
      id: f.id,
      name: f.name,
      boundary: f.boundary as object,
      sprays: byField.get(f.id) ?? [],
    }));

  return (
    <SprayMapShell
      fields={mapFields}
      unitSystem={settings.unitSystem}
      mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? null}
      fromHref={searchParams.from && searchParams.from.startsWith('/') ? searchParams.from : '/spray'}
    />
  );
}
