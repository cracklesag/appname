import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  loadFields, loadAllApplications, loadAllCuts, loadAllProducts, loadGroups, loadSettings,
} from '@/lib/data';
import { buildFertPlanRows } from '@/lib/fertplan';
import { PlanShell } from '@/components/PlanShell';
import { Product } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function PlanPage({
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

  const groupFilter = searchParams.group || 'all';

  const rows = buildFertPlanRows(fields, applications, cuts, products, settings, groups);

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
          <div style={{ fontSize: 12, color: 'rgba(239,231,214,0.7)', marginTop: 1 }}>RB209 — slurry first, then granular</div>
        </div>
      </div>
      <PlanShell
        rows={rows}
        groups={groups}
        initialGroup={groupFilter}
        unitSystem={settings.unitSystem}
        products={planProducts}
        slurryUnit={settings.slurryUnit}
        minSpreadP2O5KgPerHa={settings.reportDefaults.minSpreadP2O5KgPerHa}
        minSpreadK2OKgPerHa={settings.reportDefaults.minSpreadK2OKgPerHa}
      />
    </div>
  );
}
