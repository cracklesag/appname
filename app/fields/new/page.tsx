import { Header } from '@/components/Header';
import { AddFieldForm } from '@/components/AddFieldForm';
import { loadGrassSystems, loadGroups, loadSettings } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function NewFieldPage({
  searchParams,
}: {
  searchParams: { from?: string };
}) {
  const [settings, groups, grassSystems] = await Promise.all([
    loadSettings(),
    loadGroups(),
    loadGrassSystems(),
  ]);
  return (
    <div>
      <Header title="Add field" subtitle="Swardly" backHref={searchParams.from || '/fields'} />
      <AddFieldForm
        unitSystem={settings.unitSystem}
        groups={groups}
        grassSystems={grassSystems}
        hiddenGrassSystemIds={settings.hiddenGrassSystemIds ?? []}
      />
    </div>
  );
}
