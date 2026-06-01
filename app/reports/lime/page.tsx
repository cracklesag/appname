import { loadFields, loadGroups, loadSettings, loadAllApplications, loadAllProducts } from '@/lib/data';
import { getFieldLimeRecommendation, resolveTargetPh, displayFieldArea } from '@/lib/rules';
import { LimeReportShell, LimeRow } from '@/components/LimeReportShell';

export const dynamic = 'force-dynamic';

export default async function LimeReportPage({
  searchParams,
}: {
  searchParams: { group?: string; from?: string };
}) {
  const [fields, groups, settings, applications, products] = await Promise.all([
    loadFields(),
    loadGroups(),
    loadSettings(),
    loadAllApplications(),
    loadAllProducts(),
  ]);

  const groupFilter = searchParams.group || 'all';
  const fromHref = searchParams.from || '/';

  // Lime products, so we can tell whether lime has been spread since sampling.
  const limeProductIds = new Set(products.filter((p) => p.type === 'lime').map((p) => p.id));

  // t/ha → t/ac when the user works in acres (lime is a rate per area too).
  const THA_PER_TAC = 2.4711;
  const inAcres = settings.unitSystem === 'acres';
  const rateUnit = inAcres ? 't/ac' : 't/ha';
  const toRate = (tha: number) => inAcres ? tha / THA_PER_TAC : tha;

  const rows: LimeRow[] = fields
    .filter((f) => !f.needs_setup)
    .map((f) => {
      const rec = getFieldLimeRecommendation(f, settings);
      const area = displayFieldArea(f, settings.unitSystem);
      const groupName = groups.find((g) => g.id === f.group_id)?.name ?? null;

      // Total tonnes of product over the whole field (physical lorry load).
      const totalProductT = Math.round(rec.totalTha * (f.ha || 0) * 10) / 10;

      // Lime spread since the last soil sample? If the stored pH predates a
      // liming, the recommendation is based on out-of-date pH and should be
      // read with caution. Compare lime applications' dates to sample_date.
      const sampleDate = f.sample_date;
      let limeSinceDate: string | null = null;
      if (sampleDate) {
        for (const a of applications) {
          if (a.field_id !== f.id) continue;
          if (!limeProductIds.has(a.product_id)) continue;
          if (a.date_applied > sampleDate) {
            if (!limeSinceDate || a.date_applied > limeSinceDate) limeSinceDate = a.date_applied;
          }
        }
      }

      return {
        id: f.id,
        name: f.name,
        groupId: f.group_id,
        groupName,
        areaValue: area.value,
        areaUnit: area.unit,
        ha: f.ha || 0,
        sampled: f.sampled,
        sampleDate,
        limeSinceSample: limeSinceDate != null,
        limeSinceDate,
        ph: f.ph,
        mgIdx: f.mg_idx,
        targetPh: rec.targetPh,
        needsLime: rec.needsLime,
        totalRate: Math.round(toRate(rec.totalTha) * 100) / 100,
        dressingRates: rec.dressings.map((d) => Math.round(toRate(d) * 100) / 100),
        totalProductT,
        limeType: rec.limeType,
        note: rec.note,
      };
    });

  return (
    <div style={{ paddingBottom: 80 }}>
      <LimeReportShell
        rows={rows}
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        initialGroup={groupFilter}
        rateUnit={rateUnit}
        targetPhDefault={fields[0] ? resolveTargetPh(fields[0], settings) : (settings.soilTargets?.pH ?? 6.2)}
        fromHref={fromHref}
      />
    </div>
  );
}
