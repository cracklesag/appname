import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  loadFields, loadAllApplications, loadAllCuts, loadAllProducts, loadGroups, loadSettings, loadGrassSystems,
  loadAllocationTypes, loadAgreements, loadFieldAgreementMap, loadCropAllocations,
} from '@/lib/data';
import { buildFertPlanRows } from '@/lib/fertplan';
import { PlanShell } from '@/components/PlanShell';
import { axisChipOptions, fieldPassesAxisParams, activeCropFieldIds } from '@/lib/grouping';
import { Product } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function PlanPage({
  searchParams,
}: {
  searchParams: { group?: string; from?: string; type?: string; agreement?: string };
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

  const groupFilter = searchParams.group || 'all';
  const typeFilter = searchParams.type || 'all';
  const agreementFilter = searchParams.agreement || 'all';

  const allRows = buildFertPlanRows(fields, applications, cuts, products, settings, groups, grassSystems);

  // A field with an ACTIVE crop allocation is a crop field this season, not
  // grass — it drops out of the grass plan so its nutrients aren't double-counted.
  const activeCropIds = activeCropFieldIds(cropAllocations);
  const grassRows = allRows.filter((r) => !activeCropIds.has(r.id));

  // Type & agreement are applied here by pre-filtering rows to an allowed-field
  // set (the block axis stays in PlanShell's own group filter). Rows are keyed
  // by field id.
  const allowedFieldIds = new Set(
    fields.filter((f) => fieldPassesAxisParams(f, { type: typeFilter, agreement: agreementFilter }, fieldAgreementMap)).map((f) => f.id),
  );
  const rows = (typeFilter === 'all' && agreementFilter === 'all')
    ? grassRows
    : grassRows.filter((r) => allowedFieldIds.has(r.id));

  const axisOptions = axisChipOptions({
    fields,
    blocks: groups.map((g) => ({ id: g.id, name: g.name })),
    types: allocationTypes.map((t) => ({ id: t.id, label: t.label })),
    agreements: agreements.map((a) => ({ id: a.id, code: a.code })),
    fieldAgreementMap,
  });

  // Topic map: soil P & K index across all mapped fields.
  const planTopicFields = fields
    .filter((f) => f.boundary)
    .map((f) => ({
      id: f.id, name: f.name, ha: f.ha ?? 0, ph: f.ph ?? null,
      p_idx: f.p_idx ?? null, k_idx: f.k_idx ?? null,
      boundary: (f.boundary as object | null) ?? null,
      centroid_lat: f.centroid_lat ?? null, centroid_lng: f.centroid_lng ?? null,
    }));

  // Fields on a maintenance allocation type default to showing TOTAL muck N
  // (there you care about full P/K + N loading, not just first-crop availability).
  const maintenanceTypeIds = new Set(
    allocationTypes.filter((t) => t.kind === 'maintenance').map((t) => t.id),
  );
  const maintenanceFieldIds = fields
    .filter((f) => f.allocation_type_id && maintenanceTypeIds.has(f.allocation_type_id))
    .map((f) => f.id);

  const isOrganic = (p: Product) => p.type === 'slurry' || p.type === 'solid_manure';
  const planProducts = products.filter(
    (p) => p.type === 'bag_fert' || isOrganic(p),
  );

  return (
    <div style={{ paddingBottom: 90 }}>
      <div style={{ background: 'var(--forest-dark)', padding: '14px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link href={searchParams.from || '/'} aria-label="Back" className="hero-back-icon" style={{ color: 'var(--brand-cream)' }}>
            <ArrowLeft size={22} />
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/swardly-mark-cream.png" alt="" width={26} height={19} style={{ objectFit: 'contain' }} />
            <span style={{ fontFamily: '"Fraunces", serif', fontSize: 18, fontWeight: 600, color: 'var(--brand-cream)' }}>swardly</span>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontFamily: '"Fraunces", serif', fontSize: 21, fontWeight: 600, color: 'var(--brand-cream)' }}>Plan</div>
          <div style={{ fontSize: 12, color: 'rgba(239,231,214,0.7)', marginTop: 1 }}>Manure first, then fertiliser top-ups</div>
        </div>
      </div>
      <PlanShell
        rows={rows}
        groups={groups}
        initialGroup={groupFilter}
        unitSystem={settings.unitSystem}
        bagFertUnit={settings.bagFertUnit}
        products={planProducts}
        slurryUnit={settings.slurryUnit}
        minSpreadP2O5KgPerHa={settings.reportDefaults.minSpreadP2O5KgPerHa}
        minSpreadK2OKgPerHa={settings.reportDefaults.minSpreadK2OKgPerHa}
        typeOptions={axisOptions.type}
        agreementOptions={axisOptions.agreement}
        typeValue={typeFilter}
        agreementValue={agreementFilter}
        topicFields={planTopicFields}
        maintenanceFieldIds={maintenanceFieldIds}
      />
    </div>
  );
}
