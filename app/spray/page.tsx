import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, Boxes, SprayCan as SprayIcon, Calculator as CalcIcon } from 'lucide-react';
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
  const [records, fields, settings] = await Promise.all([
    loadSprayRecords(), loadFields(), loadSettings(),
  ]);
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
    operator_name: r.operator_name,
    start_time: r.start_time,
    finish_time: r.finish_time,
  }));

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header tone="forest"
        title="Spray records"
        subtitle="Plant protection"
        backHref={backHref}
        right={<Link href="/spray/new" className="icon-btn" aria-label="Add spray record"><Plus size={22} /></Link>}
      />
      <div style={{ padding: '16px 16px 0' }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <Link href="/spray/stock" className="btn-ghost" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, textDecoration: 'none' }}>
            <Boxes size={17} /> Stock list
          </Link>
          <Link href="/spray/sprayer" className="btn-ghost" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, textDecoration: 'none' }}>
            <SprayIcon size={17} /> Sprayer
          </Link>
        </div>
        <Link href="/spray/calculator" className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, marginBottom: 4, textDecoration: 'none' }}>
          <CalcIcon size={20} style={{ color: 'var(--forest)', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: 'var(--ink)' }}>Spray calculator</span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Work out the tank from an area, litres of a spray, or one full load — then log it if you want</span>
          </span>
          <span style={{ color: 'var(--muted)', fontSize: 17 }}>›</span>
        </Link>
      </div>
      <SprayRecordsList records={views} unitSystem={settings.unitSystem} />
    </div>
  );
}
