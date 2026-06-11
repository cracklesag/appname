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
} from '@/lib/data';
import { getSeasonStart } from '@/lib/rules';

export const dynamic = 'force-dynamic';

export default async function GrazingReportPage({
  searchParams,
}: {
  searchParams: { group?: string; window?: string; due?: string; fields?: string; from?: string };
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
      <Header tone="forest" title="Grazing top-up" subtitle="N cadence schedule" backHref={searchParams.from || '/'} />
      <GrazingReportShell
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
