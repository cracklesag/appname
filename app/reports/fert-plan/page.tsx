import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import {
  loadFields, loadAllApplications, loadAllCuts, loadAllProducts, loadGroups, loadSettings,
} from '@/lib/data';
import {
  getSeasonStart, sumNutrients, getFieldPKShortfall, planFieldFertiliser, displayFieldArea,
} from '@/lib/rules';
import { FertPlanShell, FertPlanRow } from '@/components/FertPlanShell';

export const dynamic = 'force-dynamic';

export default async function FertPlanPage({
  searchParams,
}: {
  searchParams: { group?: string; from?: string };
}) {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');

  const [fields, applications, cuts, products, groups] = await Promise.all([
    loadFields(),
    loadAllApplications(),
    loadAllCuts(),
    loadAllProducts(),
    loadGroups(),
  ]);

  const seasonStart = getSeasonStart();
  const groupFilter = searchParams.group || 'all';

  const rows: FertPlanRow[] = fields
    .filter((f) => !f.needs_setup)
    .map((f) => {
      const fieldApps = applications.filter(
        (a) => a.field_id === f.id && a.date_applied >= seasonStart,
      );
      const applied = sumNutrients(fieldApps, products);

      const fieldCuts = cuts.filter((c) => c.field_id === f.id);
      const seasonCuts = fieldCuts.filter((c) => c.cut_date >= seasonStart);
      const cutNumber = Math.min((f.cut_profile || 1), seasonCuts.length + 1);

      const { rec, p2o5ToApply, k2oToApply } = getFieldPKShortfall(
        f, cutNumber, applied.p, applied.k, fieldCuts,
      );

      const plan = planFieldFertiliser(p2o5ToApply, k2oToApply, products);
      const area = displayFieldArea(f, settings.unitSystem);
      const haActual = f.ha || 0;
      const groupName = groups.find((g) => g.id === f.group_id)?.name ?? null;

      return {
        id: f.id,
        name: f.name,
        groupId: f.group_id,
        groupName,
        areaValue: area.value,
        areaUnit: area.unit,
        ha: haActual,
        sampled: f.sampled,
        pBand: rec.pBand,
        kBandLabel: rec.kBand,
        cutType: rec.cutType,
        cutNumber: rec.cutNumber,
        p2o5ToApply,
        k2oToApply,
        plan: plan
          ? {
              products: plan.products.map((pp) => ({
                productId: pp.productId,
                productName: pp.productName,
                rateKgPerHa: pp.rateKgPerHa,
                // kg of product over the whole field
                totalKg: Math.round(pp.rateKgPerHa * haActual),
              })),
              note: plan.note,
              p2o5Balance: plan.p2o5Balance,
              k2oBalance: plan.k2oBalance,
            }
          : null,
      };
    });

  return (
    <div style={{ paddingBottom: 90 }}>
      <Header title="Fertiliser plan" subtitle="RB209 — product & rate per field" backHref={searchParams.from || '/'} />
      <FertPlanShell rows={rows} groups={groups} initialGroup={groupFilter} unitSystem={settings.unitSystem} />
    </div>
  );
}
