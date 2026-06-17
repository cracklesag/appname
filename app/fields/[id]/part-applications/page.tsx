import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MapPin } from 'lucide-react';
import { Header } from '@/components/Header';
import PartApplicationsHeatMap, { type HeatListItem } from '@/components/PartApplicationsHeatMap';
import {
  loadField, loadApplicationsForField, loadApplicationAreasForField, loadAllProducts, loadSettings,
} from '@/lib/data';
import { displayRate, fmtDate } from '@/lib/rules';
import {
  patchK2oPerHa, isReconciledPartial, KG_PER_HA_TO_KG_PER_AC, type HeatPatch,
} from '@/lib/partials';
import type { FieldGeometry } from '@/lib/geo';

export const dynamic = 'force-dynamic';

export default async function PartApplicationsPage({ params }: { params: { id: string } }) {
  const [field, applications, areas, products, settings] = await Promise.all([
    loadField(params.id),
    loadApplicationsForField(params.id),
    loadApplicationAreasForField(params.id),
    loadAllProducts(),
    loadSettings(),
  ]);
  if (!field) notFound();

  const backHref = `/fields/${field.id}?tab=season`;
  const boundary = (field.boundary ?? null) as FieldGeometry | null;
  const areaUnit = settings.unitSystem === 'acres' ? 'ac' : 'ha';
  const areaInUnit = (ha: number) => (settings.unitSystem === 'acres' ? ha * 2.47105 : ha);

  // No boundary yet → the heat map has nothing to draw against. Point the user
  // at the map to add one first (drawing a fresh outline here is deferred).
  if (!boundary) {
    return (
      <div>
        <Header title="Part applications" subtitle={field.name} backHref={backHref} />
        <div style={{ padding: 16 }}>
          <div className="card" style={{ padding: 20, textAlign: 'center' }}>
            <MapPin size={26} style={{ color: 'var(--muted)' }} />
            <div className="display" style={{ fontSize: 16, fontWeight: 600, marginTop: 8 }}>Map this field first</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
              Part applications and the K loading heat map need the field&rsquo;s boundary. Add it on the map, then come back.
            </div>
            <Link href="/map" className="btn-primary" style={{ display: 'inline-flex', marginTop: 14, padding: '10px 18px' }}>
              Go to map
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // One heat patch per drawn sub-area; one list row per partial application.
  const appById = new Map(applications.map((a) => [a.id, a]));
  const patches: HeatPatch[] = [];
  for (const ar of areas) {
    const app = appById.get(ar.application_id);
    if (!app) continue;
    patches.push({ geometry: ar.polygon as FieldGeometry, kPerHa: patchK2oPerHa(app, products) });
  }

  const areaHaByApp = new Map<string, number>();
  for (const ar of areas) areaHaByApp.set(ar.application_id, (areaHaByApp.get(ar.application_id) ?? 0) + ar.area_ha);

  const items: HeatListItem[] = applications
    .filter((a) => a.coverage === 'partial')
    .map((a) => {
      const product = products.find((p) => p.id === a.product_id);
      const disp = product ? displayRate(a, settings, product.type) : { value: a.rate_value, unit: a.rate_unit };
      const ha = areaHaByApp.get(a.id) ?? a.drawn_ha ?? 0;
      return {
        id: a.id,
        dateLabel: fmtDate(a.date_applied),
        product: product?.name ?? 'Unknown product',
        rateLabel: `${disp.value} ${disp.unit}`,
        areaLabel: `${areaInUnit(ha).toFixed(2)} ${areaUnit}`,
        kPerAc: Math.round(patchK2oPerHa(a, products) * KG_PER_HA_TO_KG_PER_AC),
        status: isReconciledPartial(a) ? 'counted' : 'pending',
      };
    });

  return (
    <div>
      <Header title="Part applications" subtitle={`${field.name} · K loading`} backHref={backHref} />
      <div style={{ padding: 16 }}>
        <PartApplicationsHeatMap
          boundary={boundary}
          patches={patches}
          items={items}
          unitSystem={settings.unitSystem}
          thresholdPct={settings.spreadCoverageThresholdPct ?? 80}
        />
      </div>
    </div>
  );
}
