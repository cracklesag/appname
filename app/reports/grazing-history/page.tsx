import { redirect } from 'next/navigation';
import { loadFields, loadAllApplications, loadAllProducts, loadGroups, loadSettings, loadPlateReadings } from '@/lib/data';
import { buildGrazingHistory, getSeasonStart, getSeasonLabel } from '@/lib/rules';
import { GrazingHistoryShell } from '@/components/GrazingHistoryShell';

export const dynamic = 'force-dynamic';

export default async function GrazingHistoryPage({
  searchParams,
}: {
  searchParams: { from?: string };
}) {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');

  const [fields, applications, products, groups, readings] = await Promise.all([
    loadFields(),
    loadAllApplications(),
    loadAllProducts(),
    loadGroups(),
    loadPlateReadings(),
  ]);

  const seasonStart = getSeasonStart();
  const history = buildGrazingHistory(fields, applications, products, readings, groups, settings, seasonStart);

  return (
    <GrazingHistoryShell
      history={history}
      seasonLabel={getSeasonLabel()}
      fromHref={searchParams.from || '/grazing'}
    />
  );
}
