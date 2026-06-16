import { redirect } from 'next/navigation';
import {
  loadFields, loadAllApplications, loadAllCuts, loadAllProducts, loadGroups, loadSettings, loadGrassSystems, loadCropAllocations,
} from '@/lib/data';
import { buildFertPlanRows } from '@/lib/fertplan';
import { activeCropFieldIds } from '@/lib/grouping';
import { SpreadListShell } from '@/components/SpreadListShell';
import { Product } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SpreadListPage({
  searchParams,
}: {
  searchParams: { mode?: string; from?: string; group?: string };
}) {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');

  const [fields, applications, cuts, products, groups, grassSystems, cropAllocations] = await Promise.all([
    loadFields(),
    loadAllApplications(),
    loadAllCuts(),
    loadAllProducts(),
    loadGroups(),
    loadGrassSystems(),
    loadCropAllocations(),
  ]);

  const allRows = buildFertPlanRows(fields, applications, cuts, products, settings, groups, grassSystems);

  // A field with an active crop allocation is a crop field this season, not
  // grass — drop it from the spreading list so it isn't double-counted.
  const activeCropIds = activeCropFieldIds(cropAllocations);
  const grassRows = allRows.filter((r) => !activeCropIds.has(r.id));

  // If the plan was filtered to a group/block when compiling, the report shows
  // only that block's fields — not every field. 'ungrouped' = fields with no
  // group; otherwise match the group id. No param = all fields.
  const group = searchParams.group;
  const rows = !group
    ? grassRows
    : group === 'ungrouped'
      ? grassRows.filter((r) => !r.groupId)
      : grassRows.filter((r) => r.groupId === group);

  const groupName = group && group !== 'ungrouped'
    ? (groups.find((g) => g.id === group)?.name ?? null)
    : group === 'ungrouped' ? 'Ungrouped' : null;

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
      fromHref={searchParams.from || '/plan'}
      groupName={groupName}
      group={group ?? null}
      minSpreadP2O5KgPerHa={settings.reportDefaults.minSpreadP2O5KgPerHa}
      minSpreadK2OKgPerHa={settings.reportDefaults.minSpreadK2OKgPerHa}
    />
  );
}
