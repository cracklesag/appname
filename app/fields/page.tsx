import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, FileUp, SlidersHorizontal } from 'lucide-react';
import { FilterChips } from '@/components/FilterChips';
import { FieldsListClient, FieldRow, FieldGroup } from '@/components/FieldsListClient';
import { getFarmContext } from '@/lib/farm';
import {
  loadAllProducts,
  loadFields,
  loadAllApplications,
  loadAllCuts,
  loadGrassSystems,
  loadGroups,
  loadSettings,
  loadAllocationTypes,
  loadAgreements,
  loadFieldAgreementMap,
} from '@/lib/data';
import { axisChipOptions, fieldPassesAxisParams, axisParamsActive } from '@/lib/grouping';
import {
  fmtDateShort,
  getCutTargets,
  getOfftakeForCut,
  getResolvedNextCutType,
  getSeasonLabel,
  getSeasonStart,
  isSampleStale,
  resolveGrassSystem,
  sampleYear,
  soilMetricColor,
  sumNutrients,
  displayBagAmount,
  displayFieldArea,
  fmt,
  NextCutType,
} from '@/lib/rules';
import { meteredApps, fieldAreaHa } from '@/lib/partials';

export const dynamic = 'force-dynamic';

type NutrientKey = 'n' | 'p' | 'k';

export default async function FieldsPage({
  searchParams,
}: {
  searchParams: { next?: string; short?: string; group?: string; type?: string; agreement?: string };
}) {
  // Onboarding gate: first-run users land on /welcome to pick their preferred unit
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');

  const [fields, products, applications, cuts, groups, grassSystems, allocationTypes, agreements, fieldAgreementMap] = await Promise.all([
    loadFields(),
    loadAllProducts(),
    loadAllApplications(),
    loadAllCuts(),
    loadGroups(),
    loadGrassSystems(),
    loadAllocationTypes(),
    loadAgreements(),
    loadFieldAgreementMap(),
  ]);

  const seasonStart = getSeasonStart();
  const seasonLabel = getSeasonLabel();
  const farmCtx = await getFarmContext();
  const isAdmin = farmCtx?.isAdmin ?? true;

  // ---- Precompute per-field state -----------------------------------
  //
  // Done before the JSX so we can filter + sort by derived values
  // (next cut type, nutrient shortfall). Mirrors the logic in the
  // field detail page so the home dashboard agrees with the detail
  // view about whether a field is "short" of a nutrient — including
  // P/K carryover from earlier in the season.
  type FieldState = {
    field: typeof fields[number];
    cutsDone: number;
    lastCut: typeof cuts[number] | undefined;
    nextCut: number;
    nextCutType: NextCutType;
    targets: ReturnType<typeof getCutTargets> | null;
    sinceTotals: ReturnType<typeof sumNutrients>;
    /** Available for next cut = since-cut applications + P/K carryover from earlier in season. */
    available: { n: number; p: number; k: number };
    /** Per-nutrient gap: target − available. Positive = short. null when no target (complete). */
    gap: { n: number; p: number; k: number } | null;
  };

  const fieldStates: FieldState[] = fields.map((f) => {
    const system = resolveGrassSystem(f, grassSystems);
    const fApps = meteredApps(applications.filter((a) => a.field_id === f.id), () => fieldAreaHa(f));
    const seasonApps = fApps.filter((a) => a.date_applied >= seasonStart);
    const fCuts = cuts.filter((c) => c.field_id === f.id && c.cut_date >= seasonStart);
    const cutsDone = fCuts.length;
    const lastCut = fCuts[0];
    const windowStart = lastCut ? lastCut.cut_date : seasonStart;
    const sinceCutApps = seasonApps.filter((a) => a.date_applied >= windowStart);
    const sinceTotals = sumNutrients(sinceCutApps, products);
    const nextCut = Math.min(cutsDone + 1, f.cut_profile);
    // Resolved next-cut type drives display + filtering. Per-cut next_action
    // (e.g. maintenance, rotational grazing) trumps the static planned_cuts.
    const nextCutType = getResolvedNextCutType(f, fCuts);
    const targets = cutsDone < f.cut_profile ? getCutTargets(f, nextCut, settings, system, fCuts) : null;

    // P/K carryover from applications before the last cut, minus offtake already
    // taken by cuts done this season. N has no carryover (mobile in soil).
    let carryover = { p: 0, k: 0 };
    if (lastCut) {
      const preCutApps = seasonApps.filter((a) => a.date_applied < windowStart);
      const preCutTotals = sumNutrients(preCutApps, products);
      let pOff = 0, kOff = 0;
      [...fCuts].sort((a, b) => a.cut_date.localeCompare(b.cut_date)).forEach((c) => {
        const o = getOfftakeForCut(f.cut_profile, c.cut_number, c.yield_class, settings, c.cut_type);
        pOff += o.p2o5; kOff += o.k2o;
      });
      carryover = {
        p: Math.max(0, preCutTotals.p - pOff),
        k: Math.max(0, preCutTotals.k - kOff),
      };
    }

    const available = {
      n: sinceTotals.n,
      p: sinceTotals.p + carryover.p,
      k: sinceTotals.k + carryover.k,
    };

    const gap = targets ? {
      n: Math.max(0, targets.n    - available.n),
      p: Math.max(0, targets.p2o5 - available.p),
      k: Math.max(0, targets.k2o  - available.k),
    } : null;

    return { field: f, cutsDone, lastCut, nextCut, nextCutType, targets, sinceTotals, available, gap };
  });

  // ---- Apply filters from URL ---------------------------------------
  //
  // `next` = active (default, complete fields excluded) | silage | bales | grazing | complete
  // `short` = any (default, no shortfall filter) | n | p | k
  // `group` = all (default) | <group_id> | unassigned
  const nextFilter = (searchParams.next ?? 'active') as 'active' | NextCutType;
  const shortFilterRaw = (searchParams.short ?? 'any');
  const shortFilter: NutrientKey | null =
    shortFilterRaw === 'n' || shortFilterRaw === 'p' || shortFilterRaw === 'k'
      ? shortFilterRaw : null;
  const groupFilter = searchParams.group ?? 'all';
  const typeFilter = searchParams.type ?? 'all';
  const agreementFilter = searchParams.agreement ?? 'all';
  const axisParams = { block: groupFilter, type: typeFilter, agreement: agreementFilter };

  // Chip options for the three land axes, limited to values that have fields.
  const axisOptions = axisChipOptions({
    fields,
    blocks: groups.map((g) => ({ id: g.id, name: g.name })),
    types: allocationTypes.map((t) => ({ id: t.id, label: t.label })),
    agreements: agreements.map((a) => ({ id: a.id, code: a.code })),
    fieldAgreementMap,
  });

  let visibleFields = fieldStates.filter((s) => {
    // Land axes: block (?group=) / allocation type (?type=) / agreement
    // (?agreement=). Single-select each, AND'd together. 'all'/absent passes.
    if (!fieldPassesAxisParams(s.field, axisParams, fieldAgreementMap)) return false;
    // Next-cut filter
    if (nextFilter === 'active') {
      if (s.nextCutType === 'complete') return false;
    } else if (s.nextCutType !== nextFilter) {
      return false;
    }
    // Short-of filter: must have a target (so completes already excluded
    // unless user explicitly picked Complete + a shortfall, which is fine
    // because completes have no gap, so they'll naturally drop out).
    if (shortFilter) {
      if (!s.gap) return false;
      if (s.gap[shortFilter] <= 0) return false;
    }
    return true;
  });

  // Sort: when filtering by shortfall, biggest gap first. Otherwise name A-Z.
  if (shortFilter) {
    visibleFields.sort((a, b) =>
      (b.gap?.[shortFilter] ?? 0) - (a.gap?.[shortFilter] ?? 0)
    );
  } else {
    visibleFields.sort((a, b) => a.field.name.localeCompare(b.field.name));
  }

  const hiddenByFilter = fieldStates.length - visibleFields.length;
  const anyFilterActive =
    nextFilter !== 'active' || shortFilter !== null || axisParamsActive(axisParams);
  // Only surface a land axis if it has at least one real value to pick.
  const showLandFilters =
    axisOptions.block.length >= 2 || axisOptions.type.length >= 2 || axisOptions.agreement.length >= 2;

  return (
    <div style={{ paddingBottom: 80 }}>
      {/* Branded hero — matches home, with a back arrow to the dashboard */}
      <div style={{ background: 'var(--forest-dark)', padding: '16px 18px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/swardly-mark-cream.png" alt="" width={30} height={22} style={{ objectFit: 'contain' }} />
            <span style={{ fontFamily: '"Fraunces", serif', fontSize: 21, fontWeight: 600, color: 'var(--brand-cream)' }}>swardly</span>
          </div>
          <div style={{ display: 'inline-flex', gap: 6 }}>
            {isAdmin && (
            <Link href="/import" aria-label="Import a document" style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(239,231,214,0.12)', color: 'var(--brand-cream)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
              <FileUp size={15} />
            </Link>
            )}
            {isAdmin && (
            <Link href="/fields/new" aria-label="Add field" style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(239,231,214,0.12)', color: 'var(--brand-cream)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
              <Plus size={16} />
            </Link>
            )}
          </div>
        </div>
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: '"Fraunces", serif', fontSize: 22, fontWeight: 600, color: 'var(--brand-cream)' }}>Fields</span>
          <span style={{ fontSize: 12, color: 'rgba(239,231,214,0.7)' }}>{seasonLabel}</span>
        </div>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {/* Filter chips — next cut type. URL param: ?next= */}
        {fields.length > 0 && (
          <>
            <FilterChips
              paramName="next"
              ariaLabel="Filter by next cut type"
              options={[
                { value: 'active',      label: 'Active' },
                { value: 'silage',      label: 'Silage' },
                { value: 'bales',       label: 'Bales' },
                { value: 'grazing',     label: 'Grazing' },
                { value: 'maintenance', label: 'Maintenance' },
                { value: 'complete',    label: 'Cuts done' },
              ]}
            />
            {/* Filter chips — shortfall. URL param: ?short= */}
            <FilterChips
              paramName="short"
              ariaLabel="Filter by nutrient shortfall"
              options={[
                { value: 'any', label: 'Any nutrient state' },
                { value: 'n',   label: 'Short of N' },
                { value: 'p',   label: 'Short of P' },
                { value: 'k',   label: 'Short of K' },
              ]}
            />

            {/* Land filters — block / allocation type / agreement. Tucked in a
                panel that stays open while any of them is active. */}
            {showLandFilters && (
              <details open={axisParamsActive(axisParams)} style={{ marginBottom: 12 }}>
                <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: 'var(--forest-dark)', listStyle: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                  <SlidersHorizontal size={14} /> Filter by land{axisParamsActive(axisParams) ? ' · active' : ''}
                </summary>
                <div style={{ marginTop: 8 }}>
                  {axisOptions.block.length >= 2 && (
                    <FilterChips paramName="group" ariaLabel="Filter by block" options={axisOptions.block} />
                  )}
                  {axisOptions.type.length >= 2 && (
                    <FilterChips paramName="type" ariaLabel="Filter by allocation type" options={axisOptions.type} />
                  )}
                  {axisOptions.agreement.length >= 2 && (
                    <FilterChips paramName="agreement" ariaLabel="Filter by agreement" options={axisOptions.agreement} />
                  )}
                </div>
              </details>
            )}

            {anyFilterActive && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                Showing {visibleFields.length} of {fieldStates.length}
                {hiddenByFilter > 0 ? ` · ${hiddenByFilter} hidden by filter` : ''}
                {shortFilter && visibleFields.length > 0 ? ` · sorted by largest gap` : ''}
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 4 }}>
          {/* Build grouped, serialisable data for the collapsible client list.
              When a shortfall sort is active, fold everything into one
              "results" group so the sort isn't fought by grouping. */}
          {fields.length > 0 && visibleFields.length > 0 && (() => {
            const tgt = settings.soilTargets;

            const rowFor = (s: typeof visibleFields[number]): FieldRow => {
              const f = s.field;
              const a = displayFieldArea(f, settings.unitSystem);
              const cutLine = s.targets
                ? `Building toward cut ${s.nextCut}${s.lastCut ? ` · since cut ${s.lastCut.cut_number} on ${fmtDateShort(s.lastCut.cut_date)}` : ' · since season start'}`
                : `All ${f.cut_profile} cuts taken`;
              const bars = s.targets
                ? {
                    n: { applied: displayBagAmount(s.available.n, settings.bagFertUnit).value, target: displayBagAmount(s.targets.n, settings.bagFertUnit).value, unit: displayBagAmount(s.available.n, settings.bagFertUnit).unit },
                    p: { applied: displayBagAmount(s.available.p, settings.bagFertUnit).value, target: displayBagAmount(s.targets.p2o5, settings.bagFertUnit).value, unit: displayBagAmount(s.available.p, settings.bagFertUnit).unit },
                    k: { applied: displayBagAmount(s.available.k, settings.bagFertUnit).value, target: displayBagAmount(s.targets.k2o, settings.bagFertUnit).value, unit: displayBagAmount(s.available.k, settings.bagFertUnit).unit },
                  }
                : null;
              return {
                id: f.id,
                name: f.name,
                meta: `${fmt(a.value, 1)} ${a.unit} · ${f.cut_profile} cut`,
                sampled: !!f.sampled,
                ph: f.ph ?? null,
                pIdx: f.p_idx ?? null,
                kIdx: f.k_idx ?? null,
                phColor: soilMetricColor(f.ph, tgt.pH),
                pColor: soilMetricColor(f.p_idx, tgt.pIdx),
                kColor: soilMetricColor(f.k_idx, tgt.kIdx),
                staleYear: isSampleStale(f) ? sampleYear(f) : null,
                cutLine,
                bars,
              };
            };

            const isShort = (s: typeof visibleFields[number]) =>
              (s.field.p_idx != null && s.field.p_idx < tgt.pIdx) ||
              (s.field.k_idx != null && s.field.k_idx < tgt.kIdx);

            const fieldGroups: FieldGroup[] = [];
            const groupFieldsView = groupFilter === 'all' && shortFilter === null;

            if (!groupFieldsView || groups.length === 0) {
              // Single flat group (filtered or sorted view, or no groups defined)
              fieldGroups.push({
                key: 'all', label: null,
                rows: visibleFields.map(rowFor),
                hasShort: visibleFields.some(isShort),
              });
            } else {
              const buckets = new Map<string | null, typeof visibleFields>();
              for (const s of visibleFields) {
                const k = s.field.group_id ?? null;
                const arr = buckets.get(k) ?? [];
                arr.push(s);
                buckets.set(k, arr);
              }
              for (const g of groups) {
                const b = buckets.get(g.id);
                if (!b || b.length === 0) continue;
                const sorted = b.slice().sort((a, c) => a.field.name.localeCompare(c.field.name));
                fieldGroups.push({
                  key: g.id, label: g.name,
                  rows: sorted.map(rowFor),
                  hasShort: sorted.some(isShort),
                });
              }
              const ungrouped = buckets.get(null);
              if (ungrouped && ungrouped.length > 0) {
                const sorted = ungrouped.slice().sort((a, c) => a.field.name.localeCompare(c.field.name));
                fieldGroups.push({
                  key: 'ungrouped', label: 'Ungrouped',
                  rows: sorted.map(rowFor),
                  hasShort: sorted.some(isShort),
                });
              }
            }

            return <FieldsListClient groups={fieldGroups} />;
          })()}

          {visibleFields.length === 0 && fields.length > 0 && (
            <div className="card" style={{ padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>
                No fields match the current filter.
              </div>
            </div>
          )}

          {fields.length === 0 && (
            <div className="card" style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 14 }}>
                No fields yet. Add your first to get started.
              </div>
              <Link
                href="/fields/new"
                className="btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
              >
                <Plus size={16} /> Add field
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
