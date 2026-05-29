import { Header } from '@/components/Header';
import { BatchCutForm } from '@/components/BatchCutForm';
import {
  loadFields,
  loadAllCuts,
  loadGroups,
  loadSettings,
} from '@/lib/data';
import { getSeasonStart } from '@/lib/rules';

export const dynamic = 'force-dynamic';

/**
 * Batch cut entry. Lets the user log the same date/type/yield/next-action
 * across multiple fields in one go, with per-row overrides via tap-to-
 * expand row editors. Fields that have already hit their cut profile this
 * season are hidden from the picker.
 */
export default async function BatchCutPage({
  searchParams,
}: {
  searchParams: { from?: string };
}) {
  const [fields, cuts, groups, settings] = await Promise.all([
    loadFields(),
    loadAllCuts(),
    loadGroups(),
    loadSettings(),
  ]);

  const seasonStart = getSeasonStart();

  // Pre-compute season cut counts per field, since the form needs to know
  // (a) how many cuts each field has already had (drives the cut number for
  // the new row), and (b) whether the field is "complete" (filter out).
  const seasonCutCountByField = new Map<string, number>();
  for (const c of cuts) {
    if (c.cut_date < seasonStart) continue;
    seasonCutCountByField.set(c.field_id, (seasonCutCountByField.get(c.field_id) ?? 0) + 1);
  }

  // Eligible = at least one more cut left in the profile this season.
  const eligibleFields = fields
    .filter((f) => (seasonCutCountByField.get(f.id) ?? 0) < f.cut_profile)
    .map((f) => ({
      field: f,
      cutsDoneThisSeason: seasonCutCountByField.get(f.id) ?? 0,
    }));

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Log batch cut" subtitle="Multiple fields, one go" backHref={searchParams.from || '/activity'} />
      <BatchCutForm
        eligibleFields={eligibleFields}
        groups={groups}
        settings={settings}
      />
    </div>
  );
}
