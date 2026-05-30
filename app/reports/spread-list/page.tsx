import { redirect } from 'next/navigation';
import {
  loadFields, loadAllApplications, loadAllCuts, loadAllProducts, loadGroups, loadSettings,
} from '@/lib/data';
import { buildFertPlanRows } from '@/lib/fertplan';
import { SpreadListShell } from '@/components/SpreadListShell';
import { Product } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SpreadListPage({
  searchParams,
}: {
  searchParams: { mode?: string; from?: string };
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

  const rows = buildFertPlanRows(fields, applications, cuts, products, settings, groups);

  const isOrganic = (p: Product) => p.type === 'slurry' || p.type === 'solid_manure';
  const planProducts = products.filter((p) => p.type === 'bag_fert' || isOrganic(p));

  const mode = (searchParams.mode === 'slurry' ? 'slurry' : 'granular') as 'granular' | 'slurry';

  return (
    <SpreadListShell
      rows={rows}
      products={planProducts}
      unitSystem={settings.unitSystem}
      slurryUnit={settings.slurryUnit}
      mode={mode}
      fromHref={searchParams.from || '/reports/fert-plan'}
    />
  );
}
