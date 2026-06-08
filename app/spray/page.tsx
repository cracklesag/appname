import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Header } from '@/components/Header';
import { SprayRecordsList, type SprayView } from '@/components/SprayRecordsList';
import { loadSprayRecords, loadFields, loadSettings } from '@/lib/data';
import { fmtDate } from '@/lib/rules';

export const dynamic = 'force-dynamic';

export default async function SprayRecordsPage({
  searchParams,
}: {
  searchParams: { from?: string };
}) {
  const [records, fields, settings] = await Promise.all([loadSprayRecords(), loadFields(), loadSettings()]);
  if (!settings.onboarded) redirect('/welcome');

  const nameById = new Map(fields.map((f) => [f.id, f.name]));
  const backHref = searchParams.from && searchParams.from.startsWith('/') ? searchParams.from : '/';

  const views: SprayView[] = records.map((r) => ({
    id: r.id,
    fieldName: nameById.get(r.field_id) ?? 'Unknown field',
    dateLabel: fmtDate(r.date_applied),
    product_name: r.product_name,
    product_litres: r.product_litres,
    water_l_per_ha: r.water_l_per_ha,
    area_ha: r.area_ha,
    coverage: r.coverage,
    wind_dir: r.wind_dir,
    wind_speed_mph: r.wind_speed_mph,
    temp_c: r.temp_c,
    weather_note: r.weather_note,
    targets: r.targets,
    notes: r.notes,
  }));

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header
        title="Spray records"
        subtitle="Plant protection"
        backHref={backHref}
        right={<Link href="/spray/new" className="icon-btn" aria-label="Add spray record"><Plus size={22} /></Link>}
      />
      <SprayRecordsList records={views} unitSystem={settings.unitSystem} />
    </div>
  );
}
