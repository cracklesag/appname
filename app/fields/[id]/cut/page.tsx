import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { LogCutForm } from '@/components/LogCutForm';
import { loadField, loadCutsForField, loadSettings } from '@/lib/data';
import { getPlannedCuts, getSeasonStart } from '@/lib/rules';

export const dynamic = 'force-dynamic';

export default async function LogCutPage({ params, searchParams }: { params: { id: string }; searchParams: { from?: string } }) {
  const [field, cuts, settings] = await Promise.all([
    loadField(params.id),
    loadCutsForField(params.id),
    loadSettings(),
  ]);
  if (!field) notFound();

  const seasonStart = getSeasonStart();
  const seasonCuts = cuts.filter((c) => c.cut_date >= seasonStart);
  const cutsDone = seasonCuts.length;
  const nextCutNumber = Math.min(cutsDone + 1, field.cut_profile);
  const plannedCuts = getPlannedCuts(field);
  const plannedType = plannedCuts[nextCutNumber - 1] || 'silage';

  return (
    <div>
      <Header title="Log cut" subtitle={field.name} backHref={searchParams.from || `/fields/${field.id}`} />
      <LogCutForm field={field} settings={settings} nextCutNumber={nextCutNumber} plannedType={plannedType} returnTo={searchParams.from} />
    </div>
  );
}
