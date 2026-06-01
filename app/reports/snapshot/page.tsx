import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { SnapshotReportShell } from '@/components/SnapshotReportShell';
import {
  loadFields,
  loadAllApplications,
  loadAllCuts,
  loadAllProducts,
  loadGrassSystems,
  loadGroups,
  loadSettings,
} from '@/lib/data';
import { getSeasonStart } from '@/lib/rules';

export const dynamic = 'force-dynamic';

export default async function SnapshotReportPage({
  searchParams,
}: {
  searchParams: { group?: string; next?: string; sort?: string; from?: string };
}) {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');

  const [fields, applications, cuts, products, groups, grassSystems] = await Promise.all([
    loadFields(),
    loadAllApplications(),
    loadAllCuts(),
    loadAllProducts(),
    loadGroups(),
    loadGrassSystems(),
  ]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const seasonStart = getSeasonStart();

  return (
    <div style={{ paddingBottom: 80 }}>
      {/* Branded hero — matches the rest of the app */}
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
          <div style={{ fontFamily: '"Fraunces", serif', fontSize: 21, fontWeight: 600, color: 'var(--brand-cream)' }}>Field snapshot</div>
          <div style={{ fontSize: 12, color: 'rgba(239,231,214,0.7)', marginTop: 1 }}>Where everything&apos;s at</div>
        </div>
      </div>
      <SnapshotReportShell
        fields={fields}
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
