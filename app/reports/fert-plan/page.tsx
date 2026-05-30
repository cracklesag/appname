import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  loadFields, loadAllApplications, loadAllCuts, loadAllProducts, loadGroups, loadSettings,
} from '@/lib/data';
import {
  getSeasonStart, sumNutrients, getFieldPKShortfall, displayFieldArea,
  getFieldNRecommendation,
} from '@/lib/rules';
import { FertPlanShell, FertPlanRow } from '@/components/FertPlanShell';
import { Product } from '@/lib/types';

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
      const fieldCuts = cuts.filter((c) => c.field_id === f.id);
      const seasonCuts = fieldCuts
        .filter((c) => c.cut_date >= seasonStart)
        .sort((a, b) => b.cut_date.localeCompare(a.cut_date));
      const lastCut = seasonCuts[0];
      const cutNumber = Math.min((f.cut_profile || 1), seasonCuts.length + 1);

      // Applied this season — used for P & K, which accumulate against the
      // season's offtake/index maintenance.
      const seasonApps = applications.filter(
        (a) => a.field_id === f.id && a.date_applied >= seasonStart,
      );
      const applied = sumNutrients(seasonApps, products);

      // Applied since the last cut — used for NITROGEN, which is a per-cut
      // recommendation. Each cut removes the crop N, so N starts fresh: only
      // count what's gone on since the last cut (or season start if no cut yet).
      // This stops a heavy first-cut dressing wrongly suppressing the
      // second-cut N recommendation.
      const nWindowStart = lastCut ? lastCut.cut_date : seasonStart;
      const sinceCutApps = seasonApps.filter((a) => a.date_applied >= nWindowStart);
      const appliedNSinceCut = sumNutrients(sinceCutApps, products).n;

      const { rec, p2o5ToApply, k2oToApply } = getFieldPKShortfall(
        f, cutNumber, applied.p, applied.k, fieldCuts,
      );
      const nRec = getFieldNRecommendation(f, cutNumber, fieldCuts);
      const nToApply = Math.max(0, Math.round(nRec.n - appliedNSinceCut));

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
        ph: f.ph,
        pIdx: f.p_idx,
        kIdx: f.k_idx,
        pBand: rec.pBand,
        kBandLabel: rec.kBand,
        cutType: rec.cutType,
        cutNumber: rec.cutNumber,
        p2o5ToApply,
        k2oToApply,
        nToApply,
        nNeed: Math.round(nRec.n),
        pNeed: rec.p2o5,
        kNeed: rec.k2o + rec.extraKAfterCut,
        appliedN: Math.round(appliedNSinceCut),
        appliedP: Math.round(applied.p),
        appliedK: Math.round(applied.k),
      };
    });

  const isOrganic = (p: Product) => p.type === 'slurry' || p.type === 'solid_manure';
  const planProducts = products.filter(
    (p) => p.type === 'bag_fert' || isOrganic(p),
  );

  return (
    <div style={{ paddingBottom: 90 }}>
      <div style={{ background: 'var(--forest-dark)', padding: '14px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link href={searchParams.from || '/'} aria-label="Back" style={{ color: 'var(--brand-cream)', display: 'inline-flex', marginLeft: -4 }}>
            <ArrowLeft size={22} />
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/swardly-mark-cream.png" alt="" width={26} height={19} style={{ objectFit: 'contain' }} />
            <span style={{ fontFamily: '"Fraunces", serif', fontSize: 18, fontWeight: 600, color: 'var(--brand-cream)' }}>swardly</span>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontFamily: '"Fraunces", serif', fontSize: 21, fontWeight: 600, color: 'var(--brand-cream)' }}>Fertiliser plan</div>
          <div style={{ fontSize: 12, color: 'rgba(239,231,214,0.7)', marginTop: 1 }}>RB209 — slurry first, then granular</div>
        </div>
      </div>
      <FertPlanShell
        rows={rows}
        groups={groups}
        initialGroup={groupFilter}
        unitSystem={settings.unitSystem}
        products={planProducts}
        slurryUnit={settings.slurryUnit}
      />
    </div>
  );
}
