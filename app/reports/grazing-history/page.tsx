import { redirect } from 'next/navigation';
import { loadFields, loadAllApplications, loadAllProducts, loadGroups, loadSettings, loadPlateReadings, loadGrazingEvents } from '@/lib/data';
import { buildGrazingHistory, summariseBlocks, getSeasonStart, getSeasonLabel } from '@/lib/rules';
import { GrazingHistoryShell } from '@/components/GrazingHistoryShell';

export const dynamic = 'force-dynamic';

export default async function GrazingHistoryPage({
  searchParams,
}: {
  searchParams: { from?: string };
}) {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');

  const [fields, applications, products, groups, readings, grazings] = await Promise.all([
    loadFields(),
    loadAllApplications(),
    loadAllProducts(),
    loadGroups(),
    loadPlateReadings(),
    loadGrazingEvents(),
  ]);

  const seasonStart = getSeasonStart();
  const history = buildGrazingHistory(fields, applications, products, readings, grazings, groups, settings, seasonStart);
  const blocks = summariseBlocks(history);

  return (
    <GrazingHistoryShell
      history={history}
      blocks={blocks}
      seasonLabel={getSeasonLabel()}
      fromHref={searchParams.from || '/grazing'}
    />
  );
}
