'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  Application,
  Cut,
  Field,
  GrassSystem,
  Group,
  NextAction,
  Product,
  Settings,
} from '@/lib/types';
import {
  displayBagAmount,
  displayFieldArea,
  fmt,
  fmtDateShort,
  getCutTargets,
  getNCap,
  getNextCutType,
  getOfftakeForCut,
  getResolvedNextCutType,
  getSoilType,
  isSampleStale,
  NEXT_CUT_LABELS,
  nutrientPerArea,
  NextCutType,
  resolveFieldNextAction,
  resolveGrassSystem,
  ResolvedNextAction,
  sampleYear,
  SOIL_TYPE_SHORT_LABELS,
  sumNutrients,
} from '@/lib/rules';
import { csvFilename, csvRow, downloadCsv } from '@/lib/csv';
import { SoilHeatBar } from '@/components/SoilHeatBar';

// =====================================================================
// Field state snapshot
// =====================================================================
//
// One row per field: a compact "where everything's at" view that
// complements the dashboard. Different from the dashboard in that:
//   - all fields shown by default, including ones with cuts done
//   - more data per row (last application, season totals, etc.)
//   - sortable / groupable / exportable
//
// Filters and sort live in the URL so the view is reload-safe and
// shareable.

type SortKey = 'name' | 'next_cut_n' | 'shortfall_total' | 'area';

const RESOLVED_NEXT_ACTION_LABELS: Record<ResolvedNextAction, string> = {
  another_cut_silage:   'Next cut: silage',
  another_cut_bales:    'Next cut: bales',
  rotational_grazing:   'Rotational grazing',
  maintenance_grazing:  'Maintenance top-up',
  pre_first_cut_silage: 'Silage (planned)',
  pre_first_cut_bales:  'Bales (planned)',
  pre_first_cut_grazing:'Grazing (planned)',
  complete:             'Complete',
};

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name (A-Z)',
  next_cut_n: 'Next cut N target',
  shortfall_total: 'Largest shortfall',
  area: 'Area (largest first)',
};

export function SnapshotReportShell({
  fields,
  applications,
  cuts,
  products,
  groups,
  grassSystems,
  settings,
  seasonStart,
  todayIso,
}: {
  fields: Field[];
  applications: Application[];
  cuts: Cut[];
  products: Product[];
  groups: Group[];
  grassSystems: GrassSystem[];
  settings: Settings;
  seasonStart: string;
  todayIso: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const groupFilter = params.get('group') ?? 'all';
  const nextFilter = (params.get('next') ?? 'all') as 'all' | NextCutType;
  const sortKey = ((params.get('sort') ?? 'name') as SortKey);

  const writeUrl = useCallback(
    (next: { group?: string; nextCut?: string; sort?: SortKey }) => {
      const sp = new URLSearchParams(params.toString());
      if (next.group !== undefined) {
        if (next.group === 'all') sp.delete('group');
        else sp.set('group', next.group);
      }
      if (next.nextCut !== undefined) {
        if (next.nextCut === 'all') sp.delete('next');
        else sp.set('next', next.nextCut);
      }
      if (next.sort !== undefined) {
        if (next.sort === 'name') sp.delete('sort');
        else sp.set('sort', next.sort);
      }
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // ---- Per-field state ---------------------------------------------
  //
  // Mirrors the maths from the home dashboard: season-to-date applied,
  // P/K carryover from earlier in the season, next-cut target if any
  // cuts remain. We compute everything once so filtering and sorting
  // are cheap downstream.
  type FieldState = {
    field: Field;
    /** Resolved grass system for this field, or undefined when not assigned. */
    grassSystem: GrassSystem | undefined;
    groupName: string | null;
    cutsDoneThisSeason: number;
    lastCut: Cut | undefined;
    daysSinceLastCut: number | null;
    nextCutType: NextCutType;
    /** Resolved per-cut next action (from most recent cut), with planned_cuts
     *  fallback for fields with no cuts this season. */
    resolvedNextAction: ResolvedNextAction;
    /** Season-to-date totals (any source). */
    seasonApplied: { n: number; p: number; k: number };
    /** Most recent application of any nutrient-bearing product this season. */
    lastApp: Application | undefined;
    /** Next cut target if cuts remain, null if all cuts done. */
    nextCutTarget: ReturnType<typeof getCutTargets>;
    /** Gap = max(0, target - available). null when no target. */
    gap: { n: number; p: number; k: number } | null;
    /** Sum of all three gaps — used for "largest shortfall" sort. */
    gapTotal: number;
    /** Annual N cap for the cap warning. */
    nCap: number;
  };

  const fieldStates: FieldState[] = useMemo(() => {
    const groupNameById = new Map(groups.map((g) => [g.id, g.name]));
    return fields.map((f) => {
      const system = resolveGrassSystem(f, grassSystems);
      const fApps = applications.filter((a) => a.field_id === f.id);
      const seasonApps = fApps.filter((a) => a.date_applied >= seasonStart);
      const fCuts = cuts
        .filter((c) => c.field_id === f.id && c.cut_date >= seasonStart)
        .sort((a, b) => b.cut_date.localeCompare(a.cut_date));
      const cutsDoneThisSeason = fCuts.length;
      const lastCut = fCuts[0];
      const daysSinceLastCut = lastCut ? daysBetween(lastCut.cut_date, todayIso) : null;
      // Resolved next-cut type — drives row subtitle + chip filtering so
      // maintenance-flagged fields don't misleadingly show as "Silage" etc.
      const nextCutType = getResolvedNextCutType(f, fCuts);

      const seasonTotals = sumNutrients(seasonApps, products);
      const seasonApplied = { n: seasonTotals.n, p: seasonTotals.p, k: seasonTotals.k };
      const resolvedNextAction = resolveFieldNextAction(f, fCuts);

      // Most recent application — useful for "when did you last touch this field"
      const lastApp = [...seasonApps]
        .sort((a, b) => b.date_applied.localeCompare(a.date_applied))[0];

      // Next cut target + available (carryover-aware). System drives N/K multipliers.
      const nextCut = Math.min(cutsDoneThisSeason + 1, f.cut_profile);
      const nextCutTarget = cutsDoneThisSeason < f.cut_profile
        ? getCutTargets(f, nextCut, settings, system, fCuts)
        : null;

      let gap: FieldState['gap'] = null;
      let gapTotal = 0;
      if (nextCutTarget) {
        const windowStart = lastCut ? lastCut.cut_date : seasonStart;
        const sinceWindow = sumNutrients(
          seasonApps.filter((a) => a.date_applied >= windowStart),
          products,
        );
        // P/K carryover from pre-cut applications minus offtake from cuts done.
        let carryover = { p: 0, k: 0 };
        if (lastCut) {
          const preCut = sumNutrients(
            seasonApps.filter((a) => a.date_applied < windowStart),
            products,
          );
          let pOff = 0, kOff = 0;
          [...fCuts].sort((a, b) => a.cut_date.localeCompare(b.cut_date)).forEach((c) => {
            const o = getOfftakeForCut(f.cut_profile, c.cut_number, c.yield_class, settings, c.cut_type);
            pOff += o.p2o5; kOff += o.k2o;
          });
          carryover = {
            p: Math.max(0, preCut.p - pOff),
            k: Math.max(0, preCut.k - kOff),
          };
        }
        const avail = {
          n: sinceWindow.n,
          p: sinceWindow.p + carryover.p,
          k: sinceWindow.k + carryover.k,
        };
        gap = {
          n: Math.max(0, nextCutTarget.n    - avail.n),
          p: Math.max(0, nextCutTarget.p2o5 - avail.p),
          k: Math.max(0, nextCutTarget.k2o  - avail.k),
        };
        gapTotal = gap.n + gap.p + gap.k;
      }

      return {
        field: f,
        grassSystem: system,
        groupName: f.group_id ? (groupNameById.get(f.group_id) ?? null) : null,
        cutsDoneThisSeason,
        lastCut,
        daysSinceLastCut,
        nextCutType,
        resolvedNextAction,
        seasonApplied,
        lastApp,
        nextCutTarget,
        gap,
        gapTotal,
        nCap: getNCap(f, settings, system),
      };
    });
  }, [fields, applications, cuts, products, groups, grassSystems, settings, seasonStart, todayIso]);

  // ---- Apply filters + sort ----------------------------------------

  const visibleStates: FieldState[] = useMemo(() => {
    return fieldStates
      .filter((s) => {
        // Group
        if (groupFilter !== 'all') {
          if (groupFilter === 'unassigned') {
            if (s.field.group_id) return false;
          } else if (s.field.group_id !== groupFilter) {
            return false;
          }
        }
        // Next cut type — 'all' lets everything through, including 'complete'
        if (nextFilter !== 'all' && s.nextCutType !== nextFilter) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortKey === 'name') return a.field.name.localeCompare(b.field.name);
        if (sortKey === 'area') return b.field.ha - a.field.ha;
        if (sortKey === 'next_cut_n') {
          // Fields with no next cut sink to the bottom
          const aN = a.nextCutTarget?.n ?? -1;
          const bN = b.nextCutTarget?.n ?? -1;
          return bN - aN;
        }
        if (sortKey === 'shortfall_total') {
          return b.gapTotal - a.gapTotal;
        }
        return 0;
      });
  }, [fieldStates, groupFilter, nextFilter, sortKey]);

  // ---- Group chip options ------------------------------------------

  const groupChipOpts = groups.length === 0 ? null : (() => {
    const anyUngrouped = fieldStates.some((s) => !s.field.group_id);
    return [
      { value: 'all', label: 'All groups' },
      ...groups.map((g) => ({ value: g.id, label: g.name })),
      ...(anyUngrouped ? [{ value: 'unassigned', label: 'Ungrouped' }] : []),
    ];
  })();

  // ---- Summary -----------------------------------------------------

  const summary = useMemo(() => {
    let totalArea = 0;
    let withShortfall = 0;
    visibleStates.forEach((s) => {
      totalArea += s.field.ha;
      if (s.gapTotal > 1) withShortfall++;
    });
    return { totalArea, withShortfall };
  }, [visibleStates]);

  // ---- Copy / Print / CSV ------------------------------------------

  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    const text = buildPlainText(visibleStates, settings, todayIso);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
        () => { /* noop */ },
      );
    }
  };
  const handlePrint = () => {
    if (typeof window !== 'undefined') window.print();
  };
  const handleCsv = () => {
    downloadCsv(csvFilename('snapshot'), buildCsv(visibleStates, settings));
  };

  // ---- Render ------------------------------------------------------

  if (fields.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <div className="card" style={{ padding: 16, textAlign: 'center', fontSize: 14, color: 'var(--muted)' }}>
          No fields yet. Add some from the home screen.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Group chip row */}
      {groupChipOpts && (
        <div style={{ marginBottom: 12 }}>
          <div className="label" style={{ marginBottom: 6 }}>Group</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {groupChipOpts.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`toggle-btn ${groupFilter === o.value ? 'active' : ''}`}
                onClick={() => writeUrl({ group: o.value })}
                style={{ fontSize: 13, padding: '6px 12px' }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Next cut chip row */}
      <div style={{ marginBottom: 12 }}>
        <div className="label" style={{ marginBottom: 6 }}>Next cut</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(['all', 'silage', 'bales', 'grazing', 'complete'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={`toggle-btn ${nextFilter === v ? 'active' : ''}`}
              onClick={() => writeUrl({ nextCut: v })}
              style={{ fontSize: 13, padding: '6px 12px' }}
            >
              {v === 'all' ? 'All'
                : v === 'silage'   ? 'Silage'
                : v === 'bales'    ? 'Bales'
                : v === 'grazing'  ? 'Grazing'
                : 'Cuts done'}
            </button>
          ))}
        </div>
      </div>

      {/* Sort */}
      <div style={{ marginBottom: 14 }}>
        <div className="label" style={{ marginBottom: 6 }}>Sort by</div>
        <select
          className="select"
          value={sortKey}
          onChange={(e) => writeUrl({ sort: e.target.value as SortKey })}
          style={{ fontSize: 13 }}
        >
          {(Object.entries(SORT_LABELS) as [SortKey, string][]).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Print-only header */}
      <div className="print-only" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>Field snapshot</h2>
        <div style={{ fontSize: 11, color: '#555' }}>{fmtFullDate(todayIso)}</div>
      </div>

      {/* Summary */}
      <div
        className="card"
        style={{ padding: 14, marginBottom: 12, background: 'var(--forest-soft, #eef0e8)' }}
      >
        <div className="label" style={{ marginBottom: 6 }}>Summary</div>
        <div style={{ fontSize: 13, color: 'var(--ink)' }}>
          <strong>{visibleStates.length}</strong> field{visibleStates.length === 1 ? '' : 's'} ·
          {' '}<strong>{fmt(summary.totalArea, 1)} ha</strong> total ·
          {' '}<strong>{summary.withShortfall}</strong> with shortfall to next cut
        </div>
      </div>

      {/* Per-field rows */}
      {visibleStates.length === 0 ? (
        <div className="card" style={{ padding: 14, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          No fields match the current filters.
        </div>
      ) : (
        visibleStates.map((s) => (
          <SnapshotRow key={s.field.id} state={s} settings={settings} />
        ))
      )}

      {/* Actions */}
      {visibleStates.length > 0 && (
        <div className="report-actions no-print" style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-ghost"
            onClick={handleCopy}
            style={{ flex: 1, minWidth: 110, padding: '10px 14px', fontSize: 13 }}
          >
            {copied ? '✓ Copied' : 'Copy as text'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={handleCsv}
            style={{ flex: 1, minWidth: 110, padding: '10px 14px', fontSize: 13 }}
          >
            Download CSV
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handlePrint}
            style={{ flex: 1, minWidth: 110, padding: '10px 14px', fontSize: 13 }}
          >
            Print
          </button>
        </div>
      )}

      {/* Print stylesheet — mirrors other reports */}
      <style>{`
        .print-only { display: none; }
        @media print {
          .print-only { display: block; }
          .no-print { display: none !important; }
          body { background: white !important; }
          body > div > div:not(.report-section),
          header, nav, footer { display: none !important; }
        }
      `}</style>
    </div>
  );
}

// ---- Row ---------------------------------------------------------

function SnapshotRow({
  state, settings,
}: {
  state: {
    field: Field;
    grassSystem: GrassSystem | undefined;
    groupName: string | null;
    cutsDoneThisSeason: number;
    lastCut: Cut | undefined;
    daysSinceLastCut: number | null;
    nextCutType: NextCutType;
    seasonApplied: { n: number; p: number; k: number };
    lastApp: Application | undefined;
    nextCutTarget: ReturnType<typeof getCutTargets>;
    gap: { n: number; p: number; k: number } | null;
    nCap: number;
  };
  settings: Settings;
}) {
  const f = state.field;
  const area = displayFieldArea(f, settings.unitSystem);
  const nUnit = settings.unitSystem === 'acres' ? 'kg/ac' : 'kg/ha';
  const disp = (kgHa: number) => Math.round(nutrientPerArea(kgHa, settings.unitSystem));

  const tgt = settings.soilTargets;

  return (
    <div className="card" style={{ padding: 12, marginBottom: 8 }}>
      {/* Header line: name + group + area */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link href={`/fields/${f.id}?from=/reports/snapshot`} style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', textDecoration: 'none' }}>{f.name} ›</Link>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {fmt(area.value, 1)} {area.unit}
            {state.groupName && <> · {state.groupName}</>}
            {state.grassSystem && <> · {state.grassSystem.short_label}</>}
            {' · '}{SOIL_TYPE_SHORT_LABELS[getSoilType(f)]}
          </div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
          color: state.nextCutType === 'complete' ? 'var(--muted, #8a8478)'
            : state.nextCutType === 'grazing' ? 'var(--slurry, #6a90b5)'
            : 'var(--forest, #5a7a3a)',
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}>
          {NEXT_CUT_LABELS[state.nextCutType]}
        </span>
      </div>

      {/* Two-column compact body */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 6 }}>
        {/* Left column: soil heat bars + cuts */}
        <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
          {f.sampled ? (
            <div style={{ marginBottom: 6 }}>
              <SoilHeatBar label="pH" value={f.ph} target={tgt.pH} max={7.5} />
              <SoilHeatBar label="P" value={f.p_idx} target={tgt.pIdx} max={4} />
              <SoilHeatBar label="K" value={f.k_idx} target={tgt.kIdx} max={4} />
              {isSampleStale(f) && (() => {
                const yr = sampleYear(f);
                return yr != null ? (
                  <div style={{ fontSize: 10, color: 'var(--red, #b85b3a)', marginTop: 2 }}>Sample {yr} — due a re-test</div>
                ) : null;
              })()}
            </div>
          ) : (
            <div style={{ marginBottom: 4, color: 'var(--muted)', fontStyle: 'italic' }}>No soil sample</div>
          )}
          <div>
            Cuts: <strong style={{ color: 'var(--ink)' }}>{state.cutsDoneThisSeason}/{f.cut_profile}</strong>
            {state.lastCut && state.daysSinceLastCut != null && (
              <> · last {fmtDateShort(state.lastCut.cut_date)} ({state.daysSinceLastCut}d)</>
            )}
          </div>
        </div>

        {/* Right column: season totals + next cut */}
        <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
          <div style={{ marginBottom: 4 }}>
            Season: <strong style={{ color: 'var(--ink)' }}>{fmt(disp(state.seasonApplied.n))}</strong>N
            {' · '}<strong style={{ color: 'var(--ink)' }}>{fmt(disp(state.seasonApplied.p))}</strong>P
            {' · '}<strong style={{ color: 'var(--ink)' }}>{fmt(disp(state.seasonApplied.k))}</strong>K {nUnit}
            {state.seasonApplied.n > state.nCap && (
              <span style={{ color: 'var(--red, #b85b3a)' }}> · over cap!</span>
            )}
          </div>
          {state.gap && (state.gap.n > 1 || state.gap.p > 1 || state.gap.k > 1) ? (
            <div>
              Gap to next cut:
              {state.gap.n > 1 && <> <strong style={{ color: 'var(--red, #b85b3a)' }}>{fmt(disp(state.gap.n))}</strong>N</>}
              {state.gap.p > 1 && <> <strong style={{ color: 'var(--red, #b85b3a)' }}>{fmt(disp(state.gap.p))}</strong>P</>}
              {state.gap.k > 1 && <> <strong style={{ color: 'var(--red, #b85b3a)' }}>{fmt(disp(state.gap.k))}</strong>K</>}
              {' '}{nUnit}
            </div>
          ) : state.gap ? (
            <div style={{ color: 'var(--forest-dark, #3d5b29)' }}>Next cut covered ✓</div>
          ) : (
            <div style={{ color: 'var(--muted)', fontStyle: 'italic' }}>All cuts taken</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Helpers / builders ------------------------------------------


function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  return Math.max(0, Math.floor((b - a) / (1000 * 60 * 60 * 24)));
}

function fmtFullDate(todayIso: string): string {
  const d = new Date(todayIso);
  const day = d.getDate();
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  return `${day} ${month} ${d.getFullYear()}`;
}

function buildPlainText(
  states: {
    field: Field;
    grassSystem: GrassSystem | undefined;
    groupName: string | null;
    cutsDoneThisSeason: number;
    lastCut: Cut | undefined;
    daysSinceLastCut: number | null;
    nextCutType: NextCutType;
    resolvedNextAction: ResolvedNextAction;
    seasonApplied: { n: number; p: number; k: number };
    nextCutTarget: ReturnType<typeof getCutTargets>;
    gap: { n: number; p: number; k: number } | null;
  }[],
  settings: Settings,
  todayIso: string,
): string {
  const lines: string[] = [];
  lines.push(`Field snapshot — ${fmtFullDate(todayIso)}`);
  lines.push('');
  states.forEach((s) => {
    const area = displayFieldArea(s.field, settings.unitSystem);
    const parts = [`${fmt(area.value, 1)} ${area.unit}`];
    if (s.groupName) parts.push(s.groupName);
    if (s.grassSystem) parts.push(s.grassSystem.short_label);
    lines.push(`${s.field.name} (${parts.join(' · ')})`);
    lines.push(`  Next: ${RESOLVED_NEXT_ACTION_LABELS[s.resolvedNextAction]} · cuts ${s.cutsDoneThisSeason}/${s.field.cut_profile}`);
    if (s.lastCut && s.daysSinceLastCut != null) {
      lines.push(`  Last cut: ${fmtDateShort(s.lastCut.cut_date)} (${s.daysSinceLastCut}d ago)`);
    }
    lines.push(`  Season: ${fmt(s.seasonApplied.n)} N, ${fmt(s.seasonApplied.p)} P, ${fmt(s.seasonApplied.k)} K kg/ha`);
    if (s.gap && (s.gap.n > 1 || s.gap.p > 1 || s.gap.k > 1)) {
      const gapParts: string[] = [];
      if (s.gap.n > 1) gapParts.push(`${fmt(s.gap.n)} N`);
      if (s.gap.p > 1) gapParts.push(`${fmt(s.gap.p)} P`);
      if (s.gap.k > 1) gapParts.push(`${fmt(s.gap.k)} K`);
      lines.push(`  Gap to next cut: ${gapParts.join(', ')} kg/ha`);
    } else if (s.gap) {
      lines.push(`  Next cut covered`);
    }
    lines.push('');
  });
  return lines.join('\n');
}

function buildCsv(
  states: {
    field: Field;
    grassSystem: GrassSystem | undefined;
    groupName: string | null;
    cutsDoneThisSeason: number;
    lastCut: Cut | undefined;
    daysSinceLastCut: number | null;
    nextCutType: NextCutType;
    resolvedNextAction: ResolvedNextAction;
    seasonApplied: { n: number; p: number; k: number };
    lastApp: Application | undefined;
    nextCutTarget: ReturnType<typeof getCutTargets>;
    gap: { n: number; p: number; k: number } | null;
    nCap: number;
  }[],
  settings: Settings,
): string {
  // Wide CSV — every column we have, units in headers.
  const lines: string[] = [];
  lines.push(csvRow([
    'Field',
    'Group',
    `Area (${settings.unitSystem === 'acres' ? 'ac' : 'ha'})`,
    'Soil type',
    'Grass system',
    'pH', 'P index', 'K index',
    'Sample year', 'Sample stale',
    'Cut profile', 'Cuts done', 'Cuts remaining',
    'Next cut type',
    'Next action',
    'Last cut date', 'Days since last cut',
    'Last application date',
    'Season N applied (kg/ha)',
    'Season P2O5 applied (kg/ha)',
    'Season K2O applied (kg/ha)',
    'Annual N cap (kg/ha)',
    'Over N cap',
    'Next cut N target (kg/ha)',
    'Next cut P2O5 target (kg/ha)',
    'Next cut K2O target (kg/ha)',
    'Gap N (kg/ha)', 'Gap P2O5 (kg/ha)', 'Gap K2O (kg/ha)',
    'Gap total (kg/ha)',
  ]));
  const round1 = (n: number) => Math.round(n * 10) / 10;
  states.forEach((s) => {
    const f = s.field;
    const yr = sampleYear(f);
    const stale = isSampleStale(f);
    const areaVal = settings.unitSystem === 'acres' ? f.acres : f.ha;
    lines.push(csvRow([
      f.name,
      s.groupName ?? '',
      round1(areaVal),
      SOIL_TYPE_SHORT_LABELS[getSoilType(f)],
      s.grassSystem?.short_label ?? '',
      f.ph ?? '',
      f.p_idx ?? '',
      f.k_idx ?? '',
      yr ?? '',
      stale ? 'yes' : '',
      f.cut_profile,
      s.cutsDoneThisSeason,
      Math.max(0, f.cut_profile - s.cutsDoneThisSeason),
      NEXT_CUT_LABELS[s.nextCutType],
      RESOLVED_NEXT_ACTION_LABELS[s.resolvedNextAction],
      s.lastCut?.cut_date ?? '',
      s.daysSinceLastCut ?? '',
      s.lastApp?.date_applied ?? '',
      round1(s.seasonApplied.n),
      round1(s.seasonApplied.p),
      round1(s.seasonApplied.k),
      s.nCap,
      s.seasonApplied.n > s.nCap ? 'yes' : '',
      s.nextCutTarget ? round1(s.nextCutTarget.n) : '',
      s.nextCutTarget ? round1(s.nextCutTarget.p2o5) : '',
      s.nextCutTarget ? round1(s.nextCutTarget.k2o) : '',
      s.gap ? round1(s.gap.n) : '',
      s.gap ? round1(s.gap.p) : '',
      s.gap ? round1(s.gap.k) : '',
      s.gap ? round1(s.gap.n + s.gap.p + s.gap.k) : '',
    ]));
  });
  return lines.join('\r\n');
}
