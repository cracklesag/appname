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
} from '@/lib/data';
import { getSeasonStart } from '@/lib/rules';
import { ReportAxisFilters } from '@/components/ReportAxisFilters';
import { axisChipOptions, fieldPassesAxisParams } from '@/lib/grouping';

export const dynamic = 'force-dynamic';

export default async function GrazingReportPage({
  searchParams,
}: {
  searchParams: { group?: string; window?: string; due?: string; fields?: string; from?: string; type?: string; agreement?: string };
}) {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');

  const [fields, applications, cuts, products, groups, grassSystems, allocationTypes, agreements, fieldAgreementMap] = await Promise.all([
    loadFields(),
    loadAllApplications(),
    loadAllCuts(),
    loadAllProducts(),
    loadGroups(),
    loadGrassSystems(),
    loadAllocationTypes(),
    loadAgreements(),
    loadFieldAgreementMap(),
  ]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const seasonStart = getSeasonStart();

  const typeFilter = searchParams.type || 'all';
  const agreementFilter = searchParams.agreement || 'all';

  // Type & agreement applied by pre-filtering the field set; block stays in the
  // grazing shell's own group filter.
  const visibleFields = (typeFilter === 'all' && agreementFilter === 'all')
    ? fields
    : fields.filter((f) => fieldPassesAxisParams(f, { type: typeFilter, agreement: agreementFilter }, fieldAgreementMap));

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
