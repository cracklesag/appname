import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, Boxes, SprayCan as SprayIcon } from 'lucide-react';
import { Header } from '@/components/Header';
import { SprayRecordsList, type SprayView } from '@/components/SprayRecordsList';
import { SprayCalculator } from '@/components/SprayCalculator';
import { loadSprayRecords, loadFields, loadSettings, loadSprayProducts } from '@/lib/data';
import { fmtDate } from '@/lib/rules';

export const dynamic = 'force-dynamic';

export default async function SprayRecordsPage({
  searchParams,
}: {
  searchParams: { from?: string };
}) {
  const [records, fields, settings, sprayProducts] = await Promise.all([
    loadSprayRecords(), loadFields(), loadSettings(), loadSprayProducts(),
  ]);
  if (!settings.onboarded) redirect('/welcome');

  const nameById = new Map(fields.map((f) => [f.id, f.name]));
  const backHref = searchParams.from && searchParams.from.startsWith('/') ? searchParams.from : '/';
  const sprayer = settings.sprayer ?? { widthM: null, nozzleFlowLMin: null, nozzleCount: null, defaultSpeedKmh: null };

  const calcFields = fields.filter((f) => !f.needs_setup).map((f) => ({ id: f.id, name: f.name, ha: f.ha }));
  const calcProducts = sprayProducts.map((p) => ({ id: p.id, name: p.name, default_l_per_ha: p.default_l_per_ha }));

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
      <div style={{ padding: '16px 16px 0' }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <Link href="/spray/stock" className="btn-ghost" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, textDecoration: 'none' }}>
            <Boxes size={17} /> Stock list
          </Link>
          <Link href="/spray/sprayer" className="btn-ghost" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, textDecoration: 'none' }}>
            <SprayIcon size={17} /> Sprayer
          </Link>
        </div>
        <SprayCalculator fields={calcFields} products={calcProducts} sprayer={sprayer} unitSystem={settings.unitSystem} />
      </div>
      <SprayRecordsList records={views} unitSystem={settings.unitSystem} />
    </div>
  );
}
