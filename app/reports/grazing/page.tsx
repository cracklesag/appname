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

  const typeFilter = searchParams.type || 'all';
  const agreementFilter = searchParams.agreement || 'all';

  // Active-crop fields drop out of the grass grazing schedule this season, then
  // type & agreement pre-filter the rest; block stays in the grazing shell.
  const activeCropIds = activeCropFieldIds(cropAllocations);
  const grassFields = fields.filter((f) => !activeCropIds.has(f.id));
  const visibleFields = (typeFilter === 'all' && agreementFilter === 'all')
    ? grassFields
    : grassFields.filter((f) => fieldPassesAxisParams(f, { type: typeFilter, agreement: agreementFilter }, fieldAgreementMap));

  const axisOptions = axisChipOptions({
    fields,
    blocks: groups.map((g) => ({ id: g.id, name: g.name })),
    types: allocationTypes.map((t) => ({ id: t.id, label: t.label })),
    agreements: agreements.map((a) => ({ id: a.id, code: a.code })),
    fieldAgreementMap,
  });

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header tone="forest" title="Grazing top-up" subtitle="N cadence schedule" backHref={searchParams.from || '/'} />
      <ReportAxisFilters
        typeOptions={axisOptions.type}
        agreementOptions={axisOptions.agreement}
        typeValue={typeFilter}
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
