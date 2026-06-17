import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { GrazingReportShell } from '@/components/GrazingReportShell';
import {
  loadFields,
  loadAllApplications,
  loadAllCuts,
  loadAllProducts,
  loadGrassSystems,
  loadGroups,
  loadSettings,
  loadAllocationTypes,
  loadAgreements,
  loadFieldAgreementMap,
  loadCropAllocations,
} from '@/lib/data';
import { getSeasonStart } from '@/lib/rules';
import { ReportAxisFilters } from '@/components/ReportAxisFilters';
import { axisChipOptions, fieldPassesAxisParams, activeCropFieldIds } from '@/lib/grouping';

export const dynamic = 'force-dynamic';

export default async function GrazingReportPage({
  searchParams,
}: {
  searchParams: { group?: string; window?: string; due?: string; fields?: string; from?: string; type?: string; agreement?: string };
}) {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');

  const [fields, applications, cuts, products, groups, grassSystems, allocationTypes, agreements, fieldAgreementMap, cropAllocations] = await Promise.all([
    loadFields(),
    loadAllApplications(),
    loadAllCuts(),
    loadAllProducts(),
    loadGroups(),
    loadGrassSystems(),
    loadAllocationTypes(),
    loadAgreements(),
    loadFieldAgreementMap(),
    loadCropAllocations(),
  ]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const seasonStart = getSeasonStart();

  const agreementFilter = searchParams.agreement || 'all';

  // This report is rotational-grazing only: computeGrazingSchedule already
  // scopes to fields heading for rotational grazing, so a type picker is
  // redundant (any other type just empties it). We keep the active-crop
  // exclusion and an optional agreement filter; block stays in the shell.
  const activeCropIds = activeCropFieldIds(cropAllocations);
  // Low-input fields aren't on a recurring dressing cadence — they belong in the
  // low-input review, not the rotational-grazing schedule.
  const lowInputTypeIds = new Set(
    allocationTypes.filter((t) => t.kind === 'low_input').map((t) => t.id),
  );
  const grassFields = fields.filter(
    (f) => !activeCropIds.has(f.id)
      && !(f.allocation_type_id != null && lowInputTypeIds.has(f.allocation_type_id)),
  );
  const visibleFields = agreementFilter === 'all'
    ? grassFields
    : grassFields.filter((f) => fieldPassesAxisParams(f, { agreement: agreementFilter }, fieldAgreementMap));

  const axisOptions = axisChipOptions({
    fields,
    blocks: groups.map((g) => ({ id: g.id, name: g.name })),
    types: allocationTypes.map((t) => ({ id: t.id, label: t.label })),
    agreements: agreements.map((a) => ({ id: a.id, code: a.code })),
    fieldAgreementMap,
  });

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header tone="forest" title="Grazing top-up" subtitle="Rotational grazing · N cadence" backHref={searchParams.from || '/'} />
      <ReportAxisFilters
        typeOptions={[]}
        agreementOptions={axisOptions.agreement}
        typeValue="all"
        agreementValue={agreementFilter}
      />
      <GrazingReportShell
        fields={visibleFields}
        applications={applications}
        cuts={cuts}
        products={products}
        groups={groups}
        grassSystems={grassSystems}
        settings={settings}
        seasonStart={seasonStart}
        todayIso={todayIso}
      />
    </div>
  );
}
