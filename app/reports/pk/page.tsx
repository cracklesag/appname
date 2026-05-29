import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import {
  loadFields, loadAllApplications, loadAllCuts, loadAllProducts, loadGroups, loadSettings,
} from '@/lib/data';
import {
  getSeasonStart, sumNutrients, getResolvedNextCutType, getPlannedCuts,
  getFieldPKShortfall, displayFieldArea,
} from '@/lib/rules';
import * as rb209 from '@/lib/rb209';
import { PKStatusShell, PKFieldRow } from '@/components/PKStatusShell';

export const dynamic = 'force-dynamic';

export default async function PKStatusPage({
  searchParams,
}: {
  searchParams: { group?: string; from?: string };
}) {
  const [fields, applications, cuts, products, groups, settings] = await Promise.all([
    loadFields(),
    loadAllApplications(),
    loadAllCuts(),
    loadAllProducts(),
    loadGroups(),
    loadSettings(),
  ]);

  const seasonStart = getSeasonStart();
  const groupFilter = searchParams.group || 'all';

  const rows: PKFieldRow[] = fields
    .filter((f) => !f.needs_setup)
    .map((f) => {
      // Season-to-date P/K already applied to this field (kg/ha).
      const fieldApps = applications.filter(
        (a) => a.field_id === f.id && a.date_applied >= seasonStart,
      );
      const applied = sumNutrients(fieldApps, products);

      // Which cut number are we at (cuts done this season + 1)?
      const fieldCuts = cuts.filter((c) => c.field_id === f.id);
      const seasonCuts = fieldCuts.filter((c) => c.cut_date >= seasonStart);
      const cutNumber = Math.min((f.cut_profile || 1), seasonCuts.length + 1);

      const { rec, p2o5ToApply, k2oToApply } = getFieldPKShortfall(
        f, cutNumber, applied.p, applied.k, fieldCuts,
      );

      const area = displayFieldArea(f, settings.unitSystem);
      const groupName = groups.find((g) => g.id === f.group_id)?.name ?? null;

      // Within-band hint: where the decimal index sits, e.g. "K 2- (low in band)".
      const kBandLabel = rec.kBand;

      return {
        id: f.id,
        name: f.name,
        groupId: f.group_id,
        groupName,
        areaValue: area.value,
        areaUnit: area.unit,
        sampled: f.sampled,
        pIdx: f.p_idx,
        kIdx: f.k_idx,
        pBand: rec.pBand,
        kBandLabel,
        cutType: rec.cutType,
        cutNumber: rec.cutNumber,
        p2o5ToApply,
        k2oToApply,
        recP2o5: rec.p2o5,
        recK2o: rec.k2o + rec.extraKAfterCut,
        appliedP: Math.round(applied.p),
        appliedK: Math.round(applied.k),
        atMaintenance: rec.atMaintenance,
        kSplit: rec.kSplit ?? null,
        extraKAfterCut: rec.extraKAfterCut,
      };
    });

  return (
    <div style={{ paddingBottom: 90 }}>
      <Header title="P & K status" subtitle="RB209 — what to apply" backHref={searchParams.from || '/'} />
      <PKStatusShell rows={rows} groups={groups} initialGroup={groupFilter} unitSystem={settings.unitSystem} />
    </div>
  );
}
