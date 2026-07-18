import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { GrazingJobSheetForm, GrazingJobField, GrazingJobProduct } from '@/components/GrazingJobSheetForm';
import {
  loadFields, loadAllApplications, loadAllCuts, loadAllProducts,
  loadGrassSystems, loadSettings, loadAllocationTypes, loadCropAllocations,
} from '@/lib/data';
import { getSeasonStart, ukTodayIso } from '@/lib/rules';
import { computeGrazingSchedule, GrazingDueStatus } from '@/lib/grazing';
import { activeCropFieldIds } from '@/lib/grouping';
import { fieldAreaHa } from '@/lib/partials';

export const dynamic = 'force-dynamic';

const isDue = (s: GrazingDueStatus): boolean =>
  s.kind === 'overdue' || s.kind === 'due_now' || s.kind === 'no_history' || (s.kind === 'upcoming' && s.days <= 7);

export default async function GrazingJobSheetPage({
  searchParams,
}: {
  searchParams: { from?: string };
}) {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');

  const [fields, applications, cuts, products, grassSystems, allocationTypes, cropAllocations] = await Promise.all([
    loadFields(),
    loadAllApplications(),
    loadAllCuts(),
    loadAllProducts(),
    loadGrassSystems(),
    loadAllocationTypes(),
    loadCropAllocations(),
  ]);

  const todayIso = ukTodayIso();
  const seasonStart = getSeasonStart();

  // Same scope as the grazing report: drop active-crop fields and review-only
  // (no-cadence) allocation types.
  const activeCropIds = activeCropFieldIds(cropAllocations);
  const reviewOnlyTypeIds = new Set(
    allocationTypes.filter((t) => t.dressing_rhythm === 'none').map((t) => t.id),
  );
  const grassFields = fields.filter(
    (f) => !activeCropIds.has(f.id)
      && !(f.allocation_type_id != null && reviewOnlyTypeIds.has(f.allocation_type_id)),
  );

  const schedule = computeGrazingSchedule({
    fields: grassFields, applications, cuts, products, grassSystems, settings, seasonStart, todayIso,
  });

  const jobFields: GrazingJobField[] = schedule
    .map((row) => ({
      id: row.field.id,
      name: row.field.name,
      areaHa: fieldAreaHa(row.field),
      due: isDue(row.status),
    }))
    .sort((a, b) => Number(b.due) - Number(a.due) || a.name.localeCompare(b.name));

  const nProducts: GrazingJobProduct[] = products
    .filter((p) => p.type === 'bag_fert' && (p.n_pct ?? 0) > 0)
    .map((p) => ({ id: p.id, name: p.name, nPct: p.n_pct as number }))
    .sort((a, b) => b.nPct - a.nPct);

  const cadenceKgN = settings.reportDefaults.grazingCadenceKgN;
  const from = searchParams.from || '/reports/grazing';

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header tone="forest" title="Top-up job sheet" subtitle="Spread N on grazing ground" backHref={from} />
      <GrazingJobSheetForm
        fields={jobFields}
        products={nProducts}
        settings={settings}
        cadenceKgN={cadenceKgN}
      />
    </div>
  );
}
