import { loadFields, loadGroups, loadSettings, loadAllApplications, loadAllProducts, loadAllocationTypes, loadAgreements, loadFieldAgreementMap, loadCropAllocations } from '@/lib/data';
import { getFieldLimeRecommendation, resolveTargetPh, displayFieldArea } from '@/lib/rules';
import { LimeReportShell, LimeRow } from '@/components/LimeReportShell';
import { ReportAxisFilters } from '@/components/ReportAxisFilters';
import { TopicMap } from '@/components/TopicMap';
import { axisChipOptions, fieldPassesAxisParams, activeCropFieldIds } from '@/lib/grouping';

export const dynamic = 'force-dynamic';

export default async function LimeReportPage({
  searchParams,
}: {
  searchParams: { group?: string; from?: string; type?: string; agreement?: string };
}) {
  const [fields, groups, settings, applications, products, allocationTypes, agreements, fieldAgreementMap, cropAllocations] = await Promise.all([
    loadFields(),
    loadGroups(),
    loadSettings(),
    loadAllApplications(),
    loadAllProducts(),
    loadAllocationTypes(),
    loadAgreements(),
    loadFieldAgreementMap(),
    loadCropAllocations(),
  ]);

  const groupFilter = searchParams.group || 'all';
  const typeFilter = searchParams.type || 'all';
  const agreementFilter = searchParams.agreement || 'all';
  const fromHref = searchParams.from || '/';

  const axisOptions = axisChipOptions({
    fields,
    blocks: groups.map((g) => ({ id: g.id, name: g.name })),
    types: allocationTypes.map((t) => ({ id: t.id, label: t.label })),
    agreements: agreements.map((a) => ({ id: a.id, code: a.code })),
    fieldAgreementMap,
  });

  // Lime products, so we can tell whether lime has been spread since sampling.
  const limeProductIds = new Set(products.filter((p) => p.type === 'lime').map((p) => p.id));

  // t/ha → t/ac when the user works in acres (lime is a rate per area too).
  const THA_PER_TAC = 2.4711;
  const inAcres = settings.unitSystem === 'acres';
  const rateUnit = inAcres ? 't/ac' : 't/ha';
  const toRate = (tha: number) => inAcres ? tha / THA_PER_TAC : tha;

  const allRows: LimeRow[] = fields
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

      // Most recent lime application of any kind (date + the rate logged), so
      // the report can show when this field was last limed and how much —
      // regardless of whether it was before or after the soil sample.
      let lastLime: { date: string; rate: number; unit: string } | null = null;
      for (const a of applications) {
        if (a.field_id !== f.id) continue;
        if (!limeProductIds.has(a.product_id)) continue;
        if (!lastLime || a.date_applied > lastLime.date) {
          lastLime = { date: a.date_applied, rate: a.rate_value, unit: a.rate_unit };
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
        soilType: f.soil_type,
        lastLimeDate: lastLime?.date ?? null,
        lastLimeRate: lastLime?.rate ?? null,
        lastLimeUnit: lastLime?.unit ?? null,
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

  // Active-crop fields drop out of the grass lime report this season.
  const activeCropIds = activeCropFieldIds(cropAllocations);
  const grassRows = allRows.filter((r) => !activeCropIds.has(r.id));

  // Type & agreement applied by pre-filtering to an allowed-field set; block
  // stays in LimeReportShell's group filter. Rows are keyed by field id.
  const allowedFieldIds = new Set(
    fields.filter((f) => fieldPassesAxisParams(f, { type: typeFilter, agreement: agreementFilter }, fieldAgreementMap)).map((f) => f.id),
  );
  const rows = (typeFilter === 'all' && agreementFilter === 'all')
    ? grassRows
    : grassRows.filter((r) => allowedFieldIds.has(r.id));

  // Topic map: lime status across all mapped fields (overview, not table-filtered).
  const limeTopicFields = fields
    .filter((f) => f.boundary)
    .map((f) => {
      const rec = getFieldLimeRecommendation(f, settings);
      const limeStatus: 'ok' | 'low' | 'due' | 'unknown' =
        f.ph == null ? 'unknown'
          : !rec.needsLime ? 'ok'
            : (rec.targetPh - (f.ph ?? 0)) >= 0.5 ? 'due' : 'low';
      return {
        id: f.id, name: f.name, ha: f.ha ?? 0, ph: f.ph ?? null,
        p_idx: f.p_idx ?? null, k_idx: f.k_idx ?? null, limeStatus,
        boundary: (f.boundary as object | null) ?? null,
        centroid_lat: f.centroid_lat ?? null, centroid_lng: f.centroid_lng ?? null,
      };
    });

  return (
    <div style={{ paddingBottom: 80 }}>
      <LimeReportShell
        rows={rows}
        afterHero={
          <>
            <ReportAxisFilters
              typeOptions={axisOptions.type}
              agreementOptions={axisOptions.agreement}
              typeValue={typeFilter}
              agreementValue={agreementFilter}
            />
            <div style={{ padding: '12px 16px 0' }}>
              <TopicMap title="Lime status map" modes={['ph']} fields={limeTopicFields} />
            </div>
          </>
        }
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        initialGroup={groupFilter}
        rateUnit={rateUnit}
        targetPhDefault={fields[0] ? resolveTargetPh(fields[0], settings) : (settings.soilTargets?.pH ?? 6.2)}
        fromHref={fromHref}
      />
    </div>
  );
}
