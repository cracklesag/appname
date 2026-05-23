import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { SpreadingReportShell } from '@/components/SpreadingReportShell';
import {
  loadFields,
  loadAllApplications,
  loadAllCuts,
  loadAllProducts,
  loadGroups,
  loadSettings,
} from '@/lib/data';
import { getSeasonStart } from '@/lib/rules';

export const dynamic = 'force-dynamic';

type ReportMode = 'post_cut' | 'spring' | 'mid_season';

function pickDefaultMode(
  fields: Awaited<ReturnType<typeof loadFields>>,
  cuts: Awaited<ReturnType<typeof loadAllCuts>>,
  seasonStart: string,
  todayIso: string,
  windowDays: number,
): ReportMode {
  // If any field has been cut within the post-cut window, default to post_cut.
  // Otherwise: any field with at least one cut this season → mid_season.
  // Else (early in the year, nothing cut yet) → spring.
  const seasonCuts = cuts.filter((c) => c.cut_date >= seasonStart);
  if (seasonCuts.length === 0) return 'spring';
  const cutoff = isoDaysAgo(todayIso, windowDays);
  const anyRecent = seasonCuts.some((c) => c.cut_date >= cutoff);
  return anyRecent ? 'post_cut' : 'mid_season';
}

function isoDaysAgo(todayIso: string, days: number): string {
  const d = new Date(todayIso);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default async function SpreadingReportPage({
  searchParams,
}: {
  searchParams: { mode?: ReportMode; window?: string; fields?: string; group?: string };
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

  const todayIso = new Date().toISOString().slice(0, 10);
  const seasonStart = getSeasonStart();
  const windowDays = clampWindow(parseInt(searchParams.window ?? '14', 10));

  const mode: ReportMode =
    (searchParams.mode as ReportMode | undefined) ??
    pickDefaultMode(fields, cuts, seasonStart, todayIso, windowDays);

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Spreading report" subtitle="Plan and review" backHref="/" />
      <SpreadingReportShell
        initialMode={mode}
        initialWindowDays={windowDays}
        initialFieldsParam={searchParams.fields ?? null}
        initialGroupParam={searchParams.group ?? null}
        fields={fields}
        applications={applications}
        cuts={cuts}
        products={products}
        groups={groups}
        settings={settings}
        seasonStart={seasonStart}
        todayIso={todayIso}
      />
    </div>
  );
}

function clampWindow(n: number): number {
  if (!Number.isFinite(n)) return 14;
  return Math.max(1, Math.min(120, n));
}
