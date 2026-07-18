import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ClipboardList, Save, SlidersHorizontal } from 'lucide-react';
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
import { displayNutrient, getSeasonStart, ukTodayIso } from '@/lib/rules';
import { getFarmContext } from '@/lib/farm';
import { saveGrazingCadence } from '@/lib/actions';
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

  const todayIso = ukTodayIso();
  const seasonStart = getSeasonStart();
  const farmCtx = await getFarmContext();
  const canEditCadence = farmCtx?.isAdmin ?? false;
  const cadenceDisplay = displayNutrient(
    settings.reportDefaults.grazingCadenceKgN,
    settings.bagFertUnit,
  );

  const agreementFilter = searchParams.agreement || 'all';

  // This report is rotational-grazing only: computeGrazingSchedule already
  // scopes to fields heading for rotational grazing, so a type picker is
  // redundant (any other type just empties it). We keep the active-crop
  // exclusion and an optional agreement filter; block stays in the shell.
  const activeCropIds = activeCropFieldIds(cropAllocations);
  // Review-only types (low input by default) aren't on a recurring dressing
  // cadence — they belong in the low-input review, not this schedule.
  const reviewOnlyTypeIds = new Set(
    allocationTypes.filter((t) => t.dressing_rhythm === 'none').map((t) => t.id),
  );
  const grassFields = fields.filter(
    (f) => !activeCropIds.has(f.id)
      && !(f.allocation_type_id != null && reviewOnlyTypeIds.has(f.allocation_type_id)),
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
      <div style={{ padding: '12px 16px 0' }}>
        <details className="card" style={{ padding: '11px 13px', marginBottom: 10 }}>
          <summary style={{ listStyle: 'none', cursor: canEditCadence ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 8 }}>
            <SlidersHorizontal size={15} style={{ color: 'var(--forest)' }} />
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>
              Default top-up: {Math.round(cadenceDisplay.value)} {cadenceDisplay.unit} N every {settings.reportDefaults.grazingCadenceWeeks} week{settings.reportDefaults.grazingCadenceWeeks === 1 ? '' : 's'}
            </span>
            {canEditCadence && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Change</span>}
          </summary>
          {canEditCadence && (
            <form action={saveGrazingCadence} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end', marginTop: 12 }}>
              <input type="hidden" name="bag_fert_unit" value={settings.bagFertUnit} />
              <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                N per dressing
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="1"
                    step="1"
                    name="grazing_n_display"
                    className="input"
                    defaultValue={Math.round(cadenceDisplay.value)}
                    style={{ minWidth: 0, width: '100%' }}
                    required
                  />
                  <span style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{cadenceDisplay.unit}</span>
                </div>
              </label>
              <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                Repeat every
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="12"
                    step="1"
                    name="grazing_weeks"
                    className="input"
                    defaultValue={settings.reportDefaults.grazingCadenceWeeks}
                    style={{ minWidth: 0, width: '100%' }}
                    required
                  />
                  <span style={{ fontSize: 11 }}>weeks</span>
                </div>
              </label>
              <button type="submit" className="btn-primary" style={{ minHeight: 40, padding: '0 12px' }}>
                <Save size={14} /> Save
              </button>
            </form>
          )}
        </details>
        <Link
          href="/reports/grazing/job?from=%2Freports%2Fgrazing"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--forest)', color: 'var(--paper)', borderRadius: 10, padding: 12, fontSize: 14, fontWeight: 700, textDecoration: 'none' }}
        >
          <ClipboardList size={16} /> Create top-up job sheet
        </Link>
      </div>
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
