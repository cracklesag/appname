'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { FilterChips } from '@/components/FilterChips';
import {
  Application,
  Cut,
  Field,
  GrassSystem,
  Group,
  Product,
  Settings,
} from '@/lib/types';
import {
  calcNutrients,
  displayBagAmount,
  displayFieldArea,
  fmt,
  fmtDateShort,
  getCutTargets,
  getNCap,
  getNextCutType,
  getOfftakeForCut,
  getSplitTarget,
  isSampleStale,
  NEXT_CUT_LABELS,
  resolveGrassSystem,
  sampleAgeYears,
  sampleYear,
  shouldFlagColdClay,
  shouldFlagCloverSuppression,
  shouldFlagSulphurRisk,
  SOIL_TYPE_SHORT_LABELS,
  getSoilType,
  soilMetricColor,
  sumNutrients,
} from '@/lib/rules';
import { csvFilename, csvRow, downloadCsv } from '@/lib/csv';

type ReportMode = 'post_cut' | 'spring' | 'mid_season';

const MODE_LABELS: Record<ReportMode, string> = {
  post_cut: 'After-cut application',
  spring: 'Spring dressing',
  mid_season: 'Mid-season top-up',
};

const MODE_BLURBS: Record<ReportMode, string> = {
  post_cut: 'Fields cut recently. Plan the next round of inputs to set up the next cut.',
  spring: 'No cuts yet this season. Plan the first dressing — prep for first silage or kick-off grazing.',
  mid_season: 'Cut at least once this season. Top up between cuts with smaller N doses.',
};

const WINDOW_PRESETS: number[] = [7, 14, 30];

const NEXT_CUT_TONE: Record<string, string> = {
  silage: 'var(--forest, #5a7a3a)',
  bales: 'var(--forest, #5a7a3a)',
  grazing: 'var(--slurry, #6a90b5)',
  complete: 'var(--muted, #8a8478)',
};

// ---- Calibration defaults ------------------------------------------
//
// Calibration translates "I'm planning X gal/ac slurry" into "delivers Y kg
// N/ha". For slurry and solid manure that needs a reference product so we
// can multiply rate × NPK content. We use the historic Mill Farm defaults:
//   Dairy slurry 6% DM (id 4) for slurry intent
//   Cattle FYM (id 20)        for solid manure intent
// Users can still override per-application via the existing log flow; the
// calibration is just an estimate for the report's "what will I have
// covered" line, not a commitment.
const CALIBRATION_SLURRY_PRODUCT_ID = 4;
const CALIBRATION_SOLID_PRODUCT_ID = 20;

export function SpreadingReportShell({
  initialMode,
  initialWindowDays,
  initialFieldsParam,
  initialGroupParam,
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
  initialMode: ReportMode;
  initialWindowDays: number;
  initialFieldsParam: string | null;
  initialGroupParam: string | null;
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

  const mode = (params.get('mode') as ReportMode | null) ?? initialMode;
  const windowDays = clampWindow(parseInt(params.get('window') ?? String(initialWindowDays), 10));
  const fieldsParam = params.get('fields') ?? initialFieldsParam ?? null;
  const groupFilter = params.get('group') ?? initialGroupParam ?? 'all';
  // Cut-type filter narrows the eligible fields to those whose NEXT planned
  // cut matches the chip the user clicked. 'all' = no filter. Always visible
  // in all modes for consistency, even if certain combinations show empty.
  const cutTypeFilter = (params.get('cutType') ?? 'all') as 'all' | 'silage' | 'bales' | 'grazing';

  // Calibration params — all URL-backed so the report is shareable / reloadable.
  // `split` = 'single' (default) | 'split'
  // `total` = 2 | 3 (only meaningful when split)
  // `dressing` = 1 | 2 | 3 (which dressing this is — 1-indexed)
  //
  // "Active" flag and "rate value" are stored as separate URL params so that
  // the user can tick the checkbox before typing a rate without the URL
  // writer treating the empty rate as "unchecked". The earlier single-param
  // approach mis-fired when toggling: ticking with no value wrote an empty
  // string, which the URL writer deleted, bouncing the checkbox back off.
  //   slurry_on=1 / solid_on=1 / n_on=1  — opt-in flags
  //   plan_slurry / plan_solid / plan_n  — rate values (may be empty)
  const split = (params.get('split') === 'split') ? 'split' as const : 'single' as const;
  const totalDressings = clampInt(params.get('total'), 2, 3, 2);
  const dressingNumber = clampInt(params.get('dressing'), 1, totalDressings, 1);
  const planSlurryRaw = params.get('plan_slurry') ?? '';
  const planSolidRaw = params.get('plan_solid') ?? '';
  const planNRaw = params.get('plan_n') ?? '';
  const planSlurry = parseFloat(planSlurryRaw);
  const planSolid = parseFloat(planSolidRaw);
  const planN = parseFloat(planNRaw);
  // Active flag in URL — explicit `*_on=1` is the canonical source. For
  // back-compat with old shared URLs that only had `plan_*=value`, treat
  // the presence of any numeric value as implicit-active.
  const slurryActive = params.get('slurry_on') === '1' || (planSlurryRaw !== '' && !isNaN(planSlurry));
  const solidActive = params.get('solid_on') === '1' || (planSolidRaw !== '' && !isNaN(planSolid));
  const granularActive = params.get('n_on') === '1' || (planNRaw !== '' && !isNaN(planN));

  // ---- Derive each field's per-season state once -------------------
  //
  // We compute everything that mode-eligibility depends on here so each
  // field appears or disappears from the picker depending on the mode.
  type FieldState = {
    field: Field;
    cutsDoneThisSeason: number;
    lastCut: Cut | undefined;
    daysSinceLastCut: number | null;
    nextCutType: ReturnType<typeof getNextCutType>;
  };

  const fieldStates: FieldState[] = useMemo(() => {
    const cutoffPre = isoDaysAgo(todayIso, windowDays);
    return fields.map((f) => {
      const fCuts = cuts
        .filter((c) => c.field_id === f.id && c.cut_date >= seasonStart)
        .sort((a, b) => b.cut_date.localeCompare(a.cut_date));
      const lastCut = fCuts[0];
      const daysSinceLastCut = lastCut
        ? daysBetween(lastCut.cut_date, todayIso)
        : null;
      return {
        field: f,
        cutsDoneThisSeason: fCuts.length,
        lastCut,
        daysSinceLastCut,
        nextCutType: getNextCutType(f, fCuts.length),
      };
    });
    // applications and products not used here yet; will be used in 3b
    // for calibration + report rendering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, cuts, seasonStart, todayIso, windowDays]);

  // Filter to fields eligible for the chosen mode.
  const eligibleStates: FieldState[] = useMemo(() => {
    return fieldStates.filter((s) => {
      if (s.nextCutType === 'complete') return false;
      // Group filter — applied alongside mode eligibility so the chip
      // narrows the picker list without changing which mode it's in.
      if (groupFilter !== 'all') {
        if (groupFilter === 'unassigned') {
          if (s.field.group_id) return false;
        } else if (s.field.group_id !== groupFilter) {
          return false;
        }
      }
      // Cut-type filter — narrows by the field's NEXT planned cut. Fields
      // whose next cut is silage/bales/grazing show up under the matching
      // chip. 'all' = no filter. Independent of mode (works the same in
      // spring / after-cut / mid-season).
      if (cutTypeFilter !== 'all') {
        // s.nextCutType is the resolved next planned cut for this field
        // ('silage' | 'bales' | 'grazing' | 'complete'). 'complete' fields
        // are already filtered out above, so we can compare directly.
        if (s.nextCutType !== cutTypeFilter) return false;
      }
      if (mode === 'spring') {
        // Zero cuts taken this season — captures both silage prep and
        // grazing kick-off. Spring report works regardless of next-cut type.
        return s.cutsDoneThisSeason === 0;
      }
      if (mode === 'post_cut') {
        // At least one cut, within the window, AND further cuts to come.
        if (s.cutsDoneThisSeason === 0) return false;
        if (s.daysSinceLastCut == null || s.daysSinceLastCut > windowDays) return false;
        if (s.cutsDoneThisSeason >= s.field.cut_profile) return false;
        return true;
      }
      // mid_season — cut at least once this season AND the last cut was
      // longer ago than the post-cut window (i.e. into the "between cuts"
      // territory, not the "just cut" territory).
      if (s.cutsDoneThisSeason === 0) return false;
      if (s.cutsDoneThisSeason >= s.field.cut_profile) return false;
      if (s.daysSinceLastCut != null && s.daysSinceLastCut <= windowDays) return false;
      return true;
    });
  }, [fieldStates, mode, windowDays, groupFilter, cutTypeFilter]);

  // Selected field IDs — read from the URL param. "all" or absent =
  // every eligible field. Specific list overrides that.
  const selectedIds: Set<string> = useMemo(() => {
    if (!fieldsParam || fieldsParam === 'all') {
      return new Set(eligibleStates.map((s) => s.field.id));
    }
    return new Set(fieldsParam.split(',').filter(Boolean));
  }, [fieldsParam, eligibleStates]);

  // ---- URL writers ------------------------------------------------

  const writeUrl = useCallback(
    (next: {
      mode?: ReportMode;
      windowDays?: number;
      selected?: 'all' | string[];
      group?: string;  // 'all' | group id | 'unassigned'
      cutType?: string;  // 'all' | 'silage' | 'bales' | 'grazing'
      split?: 'single' | 'split';
      totalDressings?: number;
      dressingNumber?: number;
      planSlurry?: string;   // empty string = remove from URL = unchecked
      planSolid?: string;
      planN?: string;
      slurryOn?: boolean;
      solidOn?: boolean;
      granularOn?: boolean;
    }) => {
      const sp = new URLSearchParams(params.toString());
      if (next.mode !== undefined) {
        // Reset window to default and clear field selection when mode changes,
        // since eligibility shifts and old selections may be off-list.
        sp.set('mode', next.mode);
        sp.delete('fields');
        // Re-apply window default per mode if not explicitly set.
        sp.set('window', String(defaultWindowFor(next.mode)));
      }
      if (next.windowDays !== undefined) {
        sp.set('window', String(next.windowDays));
        // Window change can change eligibility → drop manual selection.
        sp.delete('fields');
      }
      if (next.selected !== undefined) {
        if (next.selected === 'all') {
          sp.delete('fields');
        } else {
          sp.set('fields', next.selected.join(','));
        }
      }
      if (next.group !== undefined) {
        // Group narrows eligibility → drop manual field selection so it
        // doesn't bleed in fields outside the new group.
        if (next.group === 'all') sp.delete('group');
        else sp.set('group', next.group);
        sp.delete('fields');
      }
      if (next.cutType !== undefined) {
        // Cut-type filter narrows eligibility → drop manual field selection
        // so the picker tally stays honest.
        if (next.cutType === 'all') sp.delete('cutType');
        else sp.set('cutType', next.cutType);
        sp.delete('fields');
      }
      if (next.split !== undefined) {
        if (next.split === 'single') {
          sp.delete('split');
          sp.delete('total');
          sp.delete('dressing');
        } else {
          sp.set('split', 'split');
          // Ensure total/dressing exist when switching to split mode.
          if (!sp.get('total')) sp.set('total', '2');
          if (!sp.get('dressing')) sp.set('dressing', '1');
        }
      }
      if (next.totalDressings !== undefined) {
        sp.set('total', String(next.totalDressings));
        // If current dressingNumber is out of range for new total, clamp it.
        const cur = parseInt(sp.get('dressing') ?? '1', 10);
        if (cur > next.totalDressings) sp.set('dressing', String(next.totalDressings));
      }
      if (next.dressingNumber !== undefined) {
        sp.set('dressing', String(next.dressingNumber));
      }
      // Plan rate updates: empty string clears, non-empty sets.
      for (const [key, val] of [
        ['plan_slurry', next.planSlurry],
        ['plan_solid', next.planSolid],
        ['plan_n', next.planN],
      ] as const) {
        if (val === undefined) continue;
        if (val === '') sp.delete(key);
        else sp.set(key, val);
      }
      // Active-flag updates: true sets '1', false removes the key. These
      // are separate from the rate values so the checkbox state survives
      // even when no rate has been typed yet.
      for (const [key, val] of [
        ['slurry_on', next.slurryOn],
        ['solid_on', next.solidOn],
        ['n_on', next.granularOn],
      ] as const) {
        if (val === undefined) continue;
        if (val) sp.set(key, '1');
        else sp.delete(key);
      }
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const toggleField = (id: string) => {
    const eligibleIds = eligibleStates.map((s) => s.field.id);
    // Materialise the current "all" selection into an explicit list before
    // toggling, so that "all minus one" works.
    let current = fieldsParam && fieldsParam !== 'all'
      ? fieldsParam.split(',').filter(Boolean)
      : eligibleIds.slice();
    if (current.includes(id)) {
      current = current.filter((x) => x !== id);
    } else {
      current = [...current, id];
    }
    // Preserve eligible-list order so the URL stays stable.
    const next = eligibleIds.filter((x) => current.includes(x));
    // If equal to "all eligible", collapse back to "all" for tidiness.
    const isAll = next.length === eligibleIds.length;
    writeUrl({ selected: isAll ? 'all' : next });
  };

  const selectAll = () => writeUrl({ selected: 'all' });
  const clearAll = () => writeUrl({ selected: [] });

  // ---- Calibration unit labels (driven by user settings) -----------
  const slurryUnitLabel = settings.slurryUnit; // 'gal/ac' or 'm3/ha'
  const solidUnitLabel = settings.unitSystem === 'acres' ? 't/ac' : 't/ha';
  const granularUnitLabel = 'kg N/ha';

  // For the split panel: only show the panel when split is on. The first %
  // is read from settings (front-loaded). If the user is on dressing 2 of 2
  // and front % is 60, this dressing gets 40% of N — but P/K full (per the
  // getSplitTarget contract we set in step 1).
  const splitPct = settings.reportDefaults.splitFrontLoadPct ?? 60;
  // Per-dressing N share, for the explainer text.
  const thisDressingNShare = split === 'single'
    ? 100
    : (dressingNumber === 1 ? splitPct : (100 - splitPct) / (totalDressings - 1));

  const anyPlanActive = slurryActive || solidActive || granularActive;

  // ---- Render ------------------------------------------------------

  return (
    <div style={{ padding: 16 }}>
      {/* Mode tabs */}
      <div style={{ marginBottom: 14 }}>
        <div className="label" style={{ marginBottom: 6 }}>Report mode</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['spring', 'post_cut', 'mid_season'] as ReportMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`toggle-btn ${mode === m ? 'active' : ''}`}
              onClick={() => writeUrl({ mode: m })}
              style={{ fontSize: 13, padding: '6px 12px' }}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
          {MODE_BLURBS[mode]}
        </div>
      </div>

      {/* Window selector — only relevant for post_cut and mid_season */}
      {mode !== 'spring' && (
        <div style={{ marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>
            {mode === 'post_cut' ? 'Cut within last' : 'Last cut older than'}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {WINDOW_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                className={`toggle-btn ${windowDays === n ? 'active' : ''}`}
                onClick={() => writeUrl({ windowDays: n })}
                style={{ fontSize: 13, padding: '6px 12px' }}
              >
                {n} days
              </button>
            ))}
            <input
              type="number"
              min="1"
              max="120"
              className="input"
              value={windowDays}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) writeUrl({ windowDays: clampWindow(n) });
              }}
              style={{ width: 72, fontSize: 13, padding: '6px 8px' }}
            />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>days</span>
          </div>
        </div>
      )}

      {/* Group filter — chip row above the field selection. Only shows when
          groups exist. Same options shape as the home dashboard. */}
      {groups.length > 0 && (() => {
        const anyUngrouped = fields.some((f) => !f.group_id);
        const opts: { value: string; label: string }[] = [
          { value: 'all', label: 'All groups' },
          ...groups.map((g) => ({ value: g.id, label: g.name })),
          ...(anyUngrouped ? [{ value: 'unassigned', label: 'Ungrouped' }] : []),
        ];
        return (
          <div style={{ marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 6 }}>Group</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {opts.map((o) => (
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
        );
      })()}

      {/* Cut-type filter — chip row narrowing by the field's NEXT planned
          cut (silage / bales / grazing). Always visible regardless of mode
          so the user can quickly look at all silage-bound fields, etc.
          'All' is the default. Resets the field-picker checkbox state on
          change so the count stays honest. */}
      {(() => {
        const opts: { value: 'all' | 'silage' | 'bales' | 'grazing'; label: string }[] = [
          { value: 'all', label: 'All cut types' },
          { value: 'silage', label: 'Silage' },
          { value: 'bales', label: 'Bales' },
          { value: 'grazing', label: 'Grazing' },
        ];
        return (
          <div style={{ marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 6 }}>Next cut type</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {opts.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`toggle-btn ${cutTypeFilter === o.value ? 'active' : ''}`}
                  onClick={() => writeUrl({ cutType: o.value })}
                  style={{ fontSize: 13, padding: '6px 12px' }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Field selection */}
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        {/* Group filter — chip row, only when groups exist */}
        {groups.length > 0 && (() => {
          const anyUngroupedField = fields.some((f) => !f.group_id);
          const opts = [
            { value: 'all', label: 'All groups' },
            ...groups.map((g) => ({ value: g.id, label: g.name })),
            ...(anyUngroupedField ? [{ value: 'unassigned', label: 'Ungrouped' }] : []),
          ];
          return (
            <div style={{ marginBottom: 10 }}>
              <FilterChips
                paramName="group"
                ariaLabel="Filter by group"
                options={opts}
              />
            </div>
          );
        })()}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <div className="label" style={{ margin: 0 }}>Fields</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {eligibleStates.length === 0
                ? 'No fields eligible for this mode.'
                : `${selectedIds.size} of ${eligibleStates.length} selected`}
            </div>
          </div>
          {eligibleStates.length > 0 && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={selectAll}
                style={{ padding: '6px 10px', fontSize: 12 }}
              >
                Select all
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={clearAll}
                style={{ padding: '6px 10px', fontSize: 12 }}
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {eligibleStates.length === 0 ? (
          <EmptyState mode={mode} />
        ) : (
          <div>
            {eligibleStates.map((s) => {
              const selected = selectedIds.has(s.field.id);
              const ncType = s.nextCutType;
              const tone = NEXT_CUT_TONE[ncType] ?? 'var(--muted)';
              return (
                <label
                  key={s.field.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 6px',
                    borderBottom: '1px solid var(--line-soft)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleField(s.field.id)}
                    style={{ width: 18, height: 18, flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                      {s.field.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {fieldSubtitle(s, settings)}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: tone,
                      flexShrink: 0,
                    }}
                  >
                    Next: {NEXT_CUT_LABELS[ncType]}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Calibration step — what's the user planning to apply? */}
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="label" style={{ marginBottom: 6 }}>What you're planning to apply</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          Tick each input you're planning. The report shows what's still needed after that goes on.
          Leave them all unticked for the raw shortfall.
        </div>

        {/* Split vs single */}
        <div style={{ marginBottom: 12 }}>
          <div className="label" style={{ fontSize: 11, marginBottom: 6 }}>Dressing plan</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`toggle-btn ${split === 'single' ? 'active' : ''}`}
              onClick={() => writeUrl({ split: 'single' })}
              style={{ fontSize: 13, padding: '6px 12px' }}
            >
              Single dressing
            </button>
            <button
              type="button"
              className={`toggle-btn ${split === 'split' ? 'active' : ''}`}
              onClick={() => writeUrl({ split: 'split' })}
              style={{ fontSize: 13, padding: '6px 12px' }}
            >
              Split dressing
            </button>
          </div>

          {split === 'split' && (
            <div style={{ marginTop: 10, paddingLeft: 4 }}>
              <select
                className="select"
                value={`${dressingNumber}/${totalDressings}`}
                onChange={(e) => {
                  // value is "<dressing>/<total>" e.g. "1/2"
                  const [d, t] = e.target.value.split('/').map((x) => parseInt(x, 10));
                  if (!Number.isFinite(d) || !Number.isFinite(t)) return;
                  // Update both at once so dressingNumber clamp doesn't fire
                  // mid-update.
                  writeUrl({ totalDressings: t, dressingNumber: d });
                }}
                style={{ fontSize: 13, padding: '6px 8px', maxWidth: 320 }}
              >
                {/* Build the five split options. Front-load % drives the share
                    for dressing 1; subsequent dressings share the remainder. */}
                {([
                  [1, 2], [2, 2],
                  [1, 3], [2, 3], [3, 3],
                ] as const).map(([d, t]) => {
                  const share = d === 1
                    ? splitPct
                    : (100 - splitPct) / (t - 1);
                  return (
                    <option key={`${d}/${t}`} value={`${d}/${t}`}>
                      Dressing {d} of {t} — {Math.round(share)}% of N
                    </option>
                  );
                })}
              </select>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', marginTop: 6 }}>
                P and K stay full on every dressing. First-dressing N % is set in Settings → Report defaults ({splitPct}%).
              </div>
            </div>
          )}
        </div>

        {/* Planning intents — three checkbox+rate rows */}
        <div style={{ marginTop: 6 }}>
          {/* Slurry */}
          <CalibrationRow
            checked={slurryActive}
            onToggle={(on) => writeUrl({ slurryOn: on })}
            label="Slurry"
            sublabel="Dairy slurry 6% DM defaults used for the N/P/K estimate."
            value={planSlurryRaw}
            placeholder={settings.slurryUnit === 'gal/ac' ? 'e.g. 2500' : 'e.g. 28'}
            unit={slurryUnitLabel}
            onChange={(v) => writeUrl({ planSlurry: v })}
          />

          {/* Solid manure */}
          <CalibrationRow
            checked={solidActive}
            onToggle={(on) => writeUrl({ solidOn: on })}
            label="Solid manure"
            sublabel="Cattle FYM defaults used for the N/P/K estimate."
            value={planSolidRaw}
            placeholder={settings.unitSystem === 'acres' ? 'e.g. 10' : 'e.g. 25'}
            unit={solidUnitLabel}
            onChange={(v) => writeUrl({ planSolid: v })}
          />

          {/* Granular fert (N only) */}
          <CalibrationRow
            checked={granularActive}
            onToggle={(on) => writeUrl({ granularOn: on })}
            label="Granular fert (N only)"
            sublabel="Quick estimate — enter the N you're planning; P and K not modelled from this source."
            value={planNRaw}
            placeholder="e.g. 40"
            unit={granularUnitLabel}
            onChange={(v) => writeUrl({ planN: v })}
          />
        </div>

        {!anyPlanActive && (
          <div style={{
            marginTop: 10, padding: 10,
            background: 'var(--paper-deep, #f4ede1)',
            fontSize: 12, color: 'var(--ink-soft)', borderRadius: 6,
          }}>
            Nothing ticked — the report will show the raw shortfall for each field.
          </div>
        )}
      </div>

      {/* ---- Report ---------------------------------------------- */}
      <ReportSection
        mode={mode}
        split={split}
        totalDressings={totalDressings}
        dressingNumber={dressingNumber}
        splitPct={splitPct}
        eligibleStates={eligibleStates}
        selectedIds={selectedIds}
        applications={applications}
        cuts={cuts}
        products={products}
        groups={groups}
        grassSystems={grassSystems}
        settings={settings}
        seasonStart={seasonStart}
        planSlurry={slurryActive ? planSlurry : 0}
        planSolid={solidActive ? planSolid : 0}
        planN={granularActive ? planN : 0}
        slurryUnit={settings.slurryUnit}
        solidUnit={solidUnitLabel}
        slurryProduct={products.find((p) => p.id === CALIBRATION_SLURRY_PRODUCT_ID)}
        solidProduct={products.find((p) => p.id === CALIBRATION_SOLID_PRODUCT_ID)}
        todayIso={todayIso}
      />
    </div>
  );
}

// ---- Small components / helpers ------------------------------------

function EmptyState({ mode }: { mode: ReportMode }) {
  const suggestion =
    mode === 'post_cut' ? 'Nothing cut in the window. Try widening to 30 days, or switch to Spring or Mid-season mode.' :
    mode === 'spring'   ? 'Every field has already been cut this season. Try After-cut application or Mid-season top-up instead.' :
                          'No fields between cuts. Try After-cut application if you just cut, or Spring dressing if no cuts yet.';
  return (
    <div style={{ padding: 14, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
      {suggestion}
    </div>
  );
}

function fieldSubtitle(
  s: { field: Field; lastCut?: Cut; daysSinceLastCut: number | null; cutsDoneThisSeason: number },
  settings: Settings,
): string {
  const acres = s.field.acres;
  const ha = s.field.ha;
  const areaBit = settings.unitSystem === 'acres'
    ? `${acres.toFixed(1)} ac`
    : `${ha.toFixed(1)} ha`;
  if (s.lastCut && s.daysSinceLastCut != null) {
    return `${areaBit} · last cut ${fmtDateShort(s.lastCut.cut_date)} (${s.daysSinceLastCut}d ago)`;
  }
  return `${areaBit} · no cuts taken this season`;
}

function defaultWindowFor(mode: ReportMode): number {
  if (mode === 'spring') return 14; // not used, but keep consistent
  if (mode === 'post_cut') return 14;
  return 30; // mid_season — wider window so anything past 2 weeks qualifies
}

function clampWindow(n: number): number {
  if (!Number.isFinite(n)) return 14;
  return Math.max(1, Math.min(120, n));
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * One line of the calibration form — a checkbox to opt-in, then (when on)
 * a rate input with its unit. Hides the input when unchecked to keep the
 * card compact.
 */
function CalibrationRow({
  checked,
  onToggle,
  label,
  sublabel,
  value,
  placeholder,
  unit,
  onChange,
}: {
  checked: boolean;
  onToggle: (on: boolean) => void;
  label: string;
  sublabel?: string;
  value: string;
  placeholder: string;
  unit: string;
  onChange: (value: string) => void;
}) {
  return (
    <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--line-soft)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{label}</div>
          {sublabel && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sublabel}</div>
          )}
        </div>
      </label>
      {checked && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, paddingLeft: 28 }}>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            className="input"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ flex: 1, maxWidth: 140 }}
          />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{unit}</span>
        </div>
      )}
    </div>
  );
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  return Math.max(0, Math.floor((b - a) / (1000 * 60 * 60 * 24)));
}

function isoDaysAgo(todayIso: string, days: number): string {
  const d = new Date(todayIso);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// =====================================================================
// REPORT SECTION
// =====================================================================
//
// Per-field cards plus a sticky summary at the top. The maths mirrors the
// home dashboard's "available for next cut" model — applied since last cut,
// plus P/K carryover from earlier in the season — and then layers the
// calibration's planned inputs on top to give a "remaining" number.

type FieldStateLite = {
  field: Field;
  cutsDoneThisSeason: number;
  lastCut: Cut | undefined;
  daysSinceLastCut: number | null;
  nextCutType: ReturnType<typeof getNextCutType>;
};

type Triple = { n: number; p: number; k: number };

type ReportRow = {
  state: FieldStateLite;
  /** The field's resolved grass system, or undefined if no FK. Used by the
   *  card for the system subtitle line and advisory flags (clover, etc.). */
  grassSystem: GrassSystem | undefined;
  /** Target N/P/K for this dressing (after split adjustment if applicable). */
  target: Triple;
  /** Already-applied + P/K carryover. */
  applied: Triple;
  /** Planned from the calibration step. */
  planned: Triple;
  /** target − applied − planned, clamped at 0. */
  remaining: Triple;
  /** Year-to-date N applied (any source, any timing) — for the cap check. */
  seasonNApplied: number;
  /** Cap relative to field. */
  nCap: number;
  /** Status flag for the card header. */
  status: 'covered' | 'short_n' | 'short_p' | 'short_k' | 'short_multi';
};

function ReportSection(props: {
  mode: ReportMode;
  split: 'single' | 'split';
  totalDressings: number;
  dressingNumber: number;
  splitPct: number;
  eligibleStates: FieldStateLite[];
  selectedIds: Set<string>;
  applications: Application[];
  cuts: Cut[];
  products: Product[];
  groups: Group[];
  grassSystems: GrassSystem[];
  settings: Settings;
  seasonStart: string;
  planSlurry: number;
  planSolid: number;
  planN: number;
  slurryUnit: 'gal/ac' | 'm3/ha';
  solidUnit: 't/ac' | 't/ha';
  slurryProduct: Product | undefined;
  solidProduct: Product | undefined;
  todayIso: string;
}) {
  const {
    mode, split, totalDressings, dressingNumber, splitPct,
    eligibleStates, selectedIds, applications, cuts, products, groups, grassSystems, settings,
    seasonStart,
    planSlurry, planSolid, planN, slurryUnit, solidUnit,
    slurryProduct, solidProduct, todayIso,
  } = props;

  // Compute the per-field rows once.
  const rows: ReportRow[] = useMemo(() => {
    const selectedStates = eligibleStates.filter((s) => selectedIds.has(s.field.id));
    return selectedStates.map((s) => {
      const f = s.field;
      // Resolve the field's grass system once per row; passed into target +
      // cap calculations so multipliers (clover-rich, herbal, IRG etc.) fire.
      const system = resolveGrassSystem(f, grassSystems);

      // ---- Target ----
      // For spring mode: target = first planned cut.
      // Otherwise: target = the next planned cut after the most recent one.
      const cutNumber = mode === 'spring'
        ? 1
        : Math.min(s.cutsDoneThisSeason + 1, f.cut_profile);
      const baseTarget = getCutTargets(f, cutNumber, settings, system);
      const fullTarget: Triple = baseTarget
        ? { n: baseTarget.n, p: baseTarget.p2o5, k: baseTarget.k2o }
        : { n: 0, p: 0, k: 0 };

      // Apply split if requested.
      const splitTarget = split === 'split'
        ? getSplitTarget(
            { n: fullTarget.n, p2o5: fullTarget.p, k2o: fullTarget.k },
            dressingNumber, totalDressings, splitPct,
          )
        : { n: fullTarget.n, p2o5: fullTarget.p, k2o: fullTarget.k };
      const target: Triple = { n: splitTarget.n, p: splitTarget.p2o5, k: splitTarget.k2o };

      // ---- Already applied + P/K carryover ----
      // Match the field detail page's logic: spring mode treats season
      // start as the window; post-cut/mid-season modes use the last cut
      // date and compute P/K carryover from pre-cut applications.
      const fApps = applications.filter((a) => a.field_id === f.id);
      const seasonApps = fApps.filter((a) => a.date_applied >= seasonStart);
      const windowStart = (mode === 'spring' || !s.lastCut)
        ? seasonStart
        : s.lastCut.cut_date;
      const sinceWindowApps = seasonApps.filter((a) => a.date_applied >= windowStart);
      const sinceTotals = sumNutrients(sinceWindowApps, products);

      let carryover = { p: 0, k: 0 };
      if (s.lastCut && mode !== 'spring') {
        const preCutApps = seasonApps.filter((a) => a.date_applied < windowStart);
        const preCutTotals = sumNutrients(preCutApps, products);
        let pOff = 0, kOff = 0;
        const fCuts = cuts
          .filter((c) => c.field_id === f.id && c.cut_date >= seasonStart)
          .sort((a, b) => a.cut_date.localeCompare(b.cut_date));
        fCuts.forEach((c) => {
          const o = getOfftakeForCut(f.cut_profile, c.cut_number, c.yield_class, settings, c.cut_type);
          pOff += o.p2o5; kOff += o.k2o;
        });
        carryover = {
          p: Math.max(0, preCutTotals.p - pOff),
          k: Math.max(0, preCutTotals.k - kOff),
        };
      }
      const applied: Triple = {
        n: sinceTotals.n,
        p: sinceTotals.p + carryover.p,
        k: sinceTotals.k + carryover.k,
      };

      // ---- Planned from the calibration ----
      // Translate slurry / solid rates × the reference products into N/P/K.
      // Use today's date so the seasonal N availability is realistic.
      let planned: Triple = { n: 0, p: 0, k: 0 };
      if (planSlurry > 0 && slurryProduct) {
        const n = calcNutrients(
          slurryProduct, planSlurry,
          slurryUnit,
          todayIso,
          'splash_plate',     // assume default method
        );
        planned.n += n.nPerHa;
        planned.p += n.p2o5PerHa;
        planned.k += n.k2oPerHa;
      }
      if (planSolid > 0 && solidProduct) {
        const n = calcNutrients(
          solidProduct, planSolid,
          solidUnit,
          todayIso,
          'surface',
        );
        planned.n += n.nPerHa;
        planned.p += n.p2o5PerHa;
        planned.k += n.k2oPerHa;
      }
      if (planN > 0) {
        planned.n += planN;
        // No P/K contribution from the "N only" granular intent.
      }

      // ---- Remaining ----
      const remaining: Triple = {
        n: Math.max(0, target.n - applied.n - planned.n),
        p: Math.max(0, target.p - applied.p - planned.p),
        k: Math.max(0, target.k - applied.k - planned.k),
      };

      // ---- Season N applied + cap ----
      const seasonNApplied = sumNutrients(seasonApps, products).n;
      const nCap = getNCap(f, settings, system);

      // ---- Status flag ----
      const shorts: string[] = [];
      if (remaining.n > 1) shorts.push('n');
      if (remaining.p > 1) shorts.push('p');
      if (remaining.k > 1) shorts.push('k');
      let status: ReportRow['status'] = 'covered';
      if (shorts.length === 1) status = `short_${shorts[0]}` as ReportRow['status'];
      else if (shorts.length > 1) status = 'short_multi';

      return { state: s, grassSystem: system, target, applied, planned, remaining, seasonNApplied, nCap, status };
    });
  }, [
    eligibleStates, selectedIds, mode, applications, products, cuts, settings,
    seasonStart, split, totalDressings, dressingNumber, splitPct,
    planSlurry, planSolid, planN, slurryUnit, solidUnit,
    slurryProduct, solidProduct, todayIso, grassSystems,
  ]);

  // Summary counts.
  const counts = useMemo(() => {
    let covered = 0, shortN = 0, shortP = 0, shortK = 0;
    rows.forEach((r) => {
      if (r.status === 'covered') covered++;
      if (r.remaining.n > 1) shortN++;
      if (r.remaining.p > 1) shortP++;
      if (r.remaining.k > 1) shortK++;
    });
    return { covered, shortN, shortP, shortK };
  }, [rows]);

  // Copy-as-text + print actions.
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    const text = buildPlainText(rows, {
      mode, split, totalDressings, dressingNumber,
      planSlurry, planSolid, planN,
      slurryUnit, solidUnit,
      todayIso, settings,
    });
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
        () => { /* ignore */ },
      );
    }
  };
  const handlePrint = () => {
    if (typeof window !== 'undefined') window.print();
  };
  const handleCsv = () => {
    const csv = buildCsv(rows, settings, groups);
    downloadCsv(csvFilename('spreading'), csv);
  };

  if (rows.length === 0) {
    return (
      <div className="card" style={{ padding: 14 }}>
        <div className="label" style={{ marginBottom: 6 }}>Report</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          {selectedIds.size === 0
            ? 'Tick at least one field above to generate the report.'
            : 'No selected fields are eligible for this mode.'}
        </div>
      </div>
    );
  }

  return (
    <div className="report-section">
      {/* Print-only header */}
      <div className="print-only" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>Spreading recommendation</h2>
        <div style={{ fontSize: 11, color: '#555' }}>
          {MODE_LABELS[mode]} · {fmtToday(todayIso)}
        </div>
      </div>

      {/* Summary card */}
      <div
        className="card report-summary"
        style={{ padding: 14, marginBottom: 12, background: 'var(--forest-soft, #eef0e8)' }}
      >
        <div className="label" style={{ marginBottom: 6 }}>Summary</div>
        <div style={{ fontSize: 13, color: 'var(--ink)' }}>
          <strong>{rows.length}</strong> field{rows.length === 1 ? '' : 's'} ·
          {' '}<strong>{counts.covered}</strong> covered ·
          {' '}<strong>{counts.shortN}</strong> short of N ·
          {' '}<strong>{counts.shortP}</strong> short of P ·
          {' '}<strong>{counts.shortK}</strong> short of K
        </div>
        {(planSlurry > 0 || planSolid > 0 || planN > 0) && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            Plan:
            {planSlurry > 0 && ` ${fmt(planSlurry)} ${slurryUnit} slurry`}
            {planSolid > 0 && `${planSlurry > 0 ? ',' : ''} ${fmt(planSolid, 1)} ${solidUnit} solid`}
            {planN > 0 && `${planSlurry > 0 || planSolid > 0 ? ',' : ''} ${fmt(planN)} kg N/ha granular`}
            {split === 'split' && ` · dressing ${dressingNumber} of ${totalDressings}`}
          </div>
        )}
      </div>

      {/* Per-field cards */}
      <div>
        {rows.map((row) => (
          <ReportFieldCard key={row.state.field.id} row={row} settings={settings} mode={mode} />
        ))}
      </div>

      {/* Footnotes — visible in both browser and print. Explains the
          crop-available N convention and the weather sensitivity that
          RB209's bulk numbers smooth over. */}
      <ReportFootnotes />

      {/* Actions — hidden on print */}
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

      {/* Print-only CSS — hides everything except the report when printing,
          and tidies up the print layout. Inlined here so the page is
          self-contained. */}
      <style>{`
        .print-only { display: none; }
        @media print {
          .print-only { display: block; }
          .no-print { display: none !important; }
          body { background: white !important; }
          /* Hide everything outside the report when printing */
          body > div > div:not(.report-section),
          header, nav, footer { display: none !important; }
          .report-summary { background: #f7f5ee !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .report-field-card { page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}

function ReportFieldCard({
  row, settings, mode,
}: {
  row: ReportRow;
  settings: Settings;
  mode: ReportMode;
}) {
  const f = row.state.field;
  const { target, applied, planned, remaining, status, seasonNApplied, nCap } = row;

  // Status pill colour + text.
  const statusInfo: { tone: string; label: string } =
    status === 'covered'     ? { tone: 'var(--forest-dark, #3d5b29)', label: 'Covered' } :
    status === 'short_n'     ? { tone: 'var(--red, #b85b3a)', label: 'Short of N' } :
    status === 'short_p'     ? { tone: 'var(--red, #b85b3a)', label: 'Short of P' } :
    status === 'short_k'     ? { tone: 'var(--red, #b85b3a)', label: 'Short of K' } :
                                { tone: 'var(--red, #b85b3a)', label: 'Multiple shortfalls' };

  const area = displayFieldArea(f, settings.unitSystem);

  // Soil index colour helpers (matches home dashboard treatment).
  const tgt = settings.soilTargets;
  const phColor = soilMetricColor(f.ph, tgt.pH);
  const pColor  = soilMetricColor(f.p_idx, tgt.pIdx);
  const kColor  = soilMetricColor(f.k_idx, tgt.kIdx);

  // N cap warning — flag if season-to-date N is within 20 kg/ha of cap.
  const nCapHeadroom = nCap - seasonNApplied;
  const nearCap = nCapHeadroom < 50;
  const overCap = seasonNApplied > nCap;

  return (
    <div
      className="card report-field-card"
      style={{ padding: 14, marginBottom: 10 }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{f.name}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {fmt(area.value, 1)} {area.unit}
            {row.grassSystem && <> · {row.grassSystem.short_label}</>}
            {row.state.lastCut && row.state.daysSinceLastCut != null && (
              <> · last cut {fmtDateShort(row.state.lastCut.cut_date)} ({row.state.daysSinceLastCut}d ago)</>
            )}
            {!row.state.lastCut && mode === 'spring' && <> · no cuts taken yet</>}
            {' · next: '}{NEXT_CUT_LABELS[row.state.nextCutType]}
          </div>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
          color: statusInfo.tone, flexShrink: 0,
          padding: '4px 8px',
          border: `1px solid ${statusInfo.tone}`,
          borderRadius: 4,
          whiteSpace: 'nowrap',
        }}>
          {statusInfo.label}
        </span>
      </div>

      {/* Soil indices + sample year */}
      {f.sampled && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 10, fontSize: 12, flexWrap: 'wrap' }}>
          <span><span style={{ color: 'var(--muted)' }}>pH </span><span style={{ color: phColor, fontWeight: 700 }}>{f.ph ?? '—'}</span></span>
          <span><span style={{ color: 'var(--muted)' }}>P </span><span style={{ color: pColor, fontWeight: 700 }}>{f.p_idx ?? '—'}</span></span>
          <span><span style={{ color: 'var(--muted)' }}>K </span><span style={{ color: kColor, fontWeight: 700 }}>{f.k_idx ?? '—'}</span></span>
          {(() => {
            const yr = sampleYear(f);
            const age = sampleAgeYears(f);
            const stale = isSampleStale(f);
            if (yr == null) return null;
            return (
              <span style={{ color: stale ? 'var(--red, #b85b3a)' : 'var(--muted)' }}>
                Sampled {yr}{age != null && age > 0 ? ` (${age}y old${stale ? ' — stale' : ''})` : ''}
              </span>
            );
          })()}
        </div>
      )}

      {/* Nutrient breakdown — 3 rows */}
      <table
        style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}
        aria-label={`Nutrient targets and shortfalls for ${f.name}`}
      >
        <thead>
          <tr style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.04em' }}>
            <th style={{ textAlign: 'left',  padding: '4px 0', width: 36 }}> </th>
            <th style={{ textAlign: 'right', padding: '4px 4px' }}>Target</th>
            <th style={{ textAlign: 'right', padding: '4px 4px' }}>Applied</th>
            <th style={{ textAlign: 'right', padding: '4px 4px' }}>Planned</th>
            <th style={{ textAlign: 'right', padding: '4px 4px' }}>Remain</th>
          </tr>
        </thead>
        <tbody>
          <NutrientRow label="N *"  values={[target.n, applied.n, planned.n, remaining.n]} short={remaining.n > 1} settings={settings} />
          <NutrientRow label="P₂O₅" values={[target.p, applied.p, planned.p, remaining.p]} short={remaining.p > 1} settings={settings} />
          <NutrientRow label="K₂O"  values={[target.k, applied.k, planned.k, remaining.k]} short={remaining.k > 1} settings={settings} />
        </tbody>
      </table>

      {/* Total kg for the field — useful for ordering bags */}
      {(remaining.n > 1 || remaining.p > 1 || remaining.k > 1) && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line-soft)', fontSize: 11, color: 'var(--muted)' }}>
          To finish this dressing:
          {remaining.n > 1 && ` ${fmt(remaining.n * f.ha)} kg N total`}
          {remaining.p > 1 && `${remaining.n > 1 ? ',' : ''} ${fmt(remaining.p * f.ha)} kg P₂O₅`}
          {remaining.k > 1 && `${(remaining.n > 1 || remaining.p > 1) ? ',' : ''} ${fmt(remaining.k * f.ha)} kg K₂O`}
          {' '}across {fmt(area.value, 1)} {area.unit}
        </div>
      )}

      {/* N cap warning */}
      {(nearCap || overCap) && (
        <div style={{
          marginTop: 8,
          padding: '6px 8px',
          fontSize: 11,
          borderRadius: 4,
          background: overCap ? '#f5dcd2' : '#f7efde',
          color: overCap ? 'var(--red, #b85b3a)' : 'var(--ink-soft)',
        }}>
          {overCap
            ? `⚠ Over annual N cap — ${fmt(seasonNApplied)} kg/ha applied vs ${nCap} cap.`
            : `Approaching annual N cap — ${fmt(seasonNApplied)} kg/ha of ${nCap} (${fmt(nCapHeadroom)} headroom).`}
        </div>
      )}

      {/* Sulphur risk flag — light_sand soils most at risk of S deficiency,
          especially in spring/early-season. RB209 recommends S response
          testing or routine application on light soils. */}
      {shouldFlagSulphurRisk(f) && (mode === 'spring' || mode === 'post_cut') && (
        <div style={{
          marginTop: 8,
          padding: '6px 8px',
          fontSize: 11,
          borderRadius: 4,
          background: '#f7efde',
          color: 'var(--ink-soft)',
        }}>
          ⓘ Light soil — S response likely. Consider a sulphur-containing fertiliser if not already planned.
        </div>
      )}

      {/* Cold-clay N timing nudge — heavy clay warms slowly so early-spring
          N response is reduced. Only meaningful for spring mode. */}
      {shouldFlagColdClay(f) && mode === 'spring' && (
        <div style={{
          marginTop: 8,
          padding: '6px 8px',
          fontSize: 11,
          borderRadius: 4,
          background: '#f7efde',
          color: 'var(--ink-soft)',
        }}>
          ⓘ Heavy clay — N response is slower in cold soils. Consider delaying first dressing 2–3 weeks vs lighter soils.
        </div>
      )}

      {/* Clover / legume suppression — early-spring N suppresses clover nodule
          activity and shifts the sward away from legume content. For legume-
          rich systems (clover-rich, herbal ley) the advice is to skip or
          minimise the first dressing. P/K still go on as normal. */}
      {shouldFlagCloverSuppression(f, row.grassSystem, mode) && (
        <div style={{
          marginTop: 8,
          padding: '6px 8px',
          fontSize: 11,
          borderRadius: 4,
          background: '#f7efde',
          color: 'var(--ink-soft)',
        }}>
          ⓘ {row.grassSystem?.short_label ?? 'Legume-rich'} — avoid early-spring N to maintain legume content. Apply P/K normally.
        </div>
      )}
    </div>
  );
}

function NutrientRow({
  label, values, short, settings,
}: {
  label: string;
  values: [number, number, number, number]; // target, applied, planned, remaining
  short: boolean;
  settings: Settings;
}) {
  const [tgt, app, plan, rem] = values;
  const numCell = (n: number, opts?: { dim?: boolean; emphasise?: boolean }) => (
    <td style={{
      textAlign: 'right', padding: '4px 4px',
      color: opts?.dim ? 'var(--muted)' : 'var(--ink)',
      fontWeight: opts?.emphasise ? 700 : 400,
      fontVariantNumeric: 'tabular-nums',
    }}>
      {(() => {
        const v = displayBagAmount(n, settings.bagFertUnit);
        return fmt(v.value);
      })()}
    </td>
  );

  return (
    <tr>
      <td style={{
        padding: '4px 0', fontWeight: 700, fontSize: 12,
        color: short ? 'var(--red, #b85b3a)' : 'var(--ink)',
      }}>
        {label}
      </td>
      {numCell(tgt)}
      {numCell(app, { dim: true })}
      {numCell(plan, { dim: true })}
      {numCell(rem, { emphasise: short })}
    </tr>
  );
}

/**
 * Footnotes shown at the bottom of the report. Visible in both browser and
 * print output. Two parts:
 *
 *   1. Crop-available N explainer (RB209 convention) — explains what the
 *      asterisk on the N row means. Slurry and solid manure N is already
 *      reduced to the crop-available fraction; P and K are total content
 *      because the soil index accounts for long-term banking.
 *
 *   2. Weather sensitivity — collapsed by default in the browser to keep the
 *      report compact, but always shown on print. The numbers come from
 *      ADAS/MANNER-NPK research underlying RB209: dry warm spells push
 *      volatilisation higher, ~10 mm rain in the first 24-48h curtails it.
 */
function ReportFootnotes() {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="report-footnotes"
      style={{
        marginTop: 14,
        padding: 12,
        background: 'var(--paper-deep, #f4ede1)',
        borderRadius: 6,
        fontSize: 11,
        color: 'var(--ink-soft)',
        lineHeight: 1.5,
      }}
    >
      <div>
        <strong>* N is crop-available (RB209)</strong> — slurry and manure N
        values shown here are the fraction expected to reach the next crop,
        after typical volatilisation and timing losses. P and K are shown
        as total content; long-term banking is captured by the soil index.
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="no-print"
        style={{
          marginTop: 8, padding: 0, border: 'none', background: 'transparent',
          color: 'var(--forest-dark, #3d5b29)', fontSize: 11, fontWeight: 700,
          cursor: 'pointer', textDecoration: 'underline',
        }}
      >
        {expanded ? 'Hide weather sensitivity ↑' : 'About weather sensitivity ↓'}
      </button>
      {/* Always visible on print regardless of expanded state. The print-only
          rule is set on the wrapper below. */}
      <div
        className={expanded ? '' : 'print-only'}
        style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid var(--line-soft, #d8cdb0)',
          display: expanded ? 'block' : undefined,
        }}
      >
        <strong>Weather sensitivity</strong> — RB209's spring availability
        figures assume typical UK conditions. Real-world variation:
        <ul style={{ margin: '6px 0 0 18px', paddingLeft: 0 }}>
          <li>
            <strong>Dry, warm, sunny week after spreading</strong>:
            ammonium-N volatilises faster. Crop-available N can be roughly
            5–10 kg N/ha lower than the table value (per 50 m³/ha slurry).
          </li>
          <li>
            <strong>~10 mm rain within 24–48 hours</strong>: slurry infiltrates
            before ammonia gases off. Crop-available N can be 10–15 kg N/ha
            higher than the table value (per 50 m³/ha slurry).
          </li>
          <li>
            Trail shoe, dribble bar and shallow injection all reduce
            weather sensitivity vs splash plate — the slurry is in contact
            with less air.
          </li>
        </ul>
        <div style={{ marginTop: 6, fontStyle: 'italic' }}>
          The app uses RB209 bulk numbers and doesn&apos;t model weather
          per application. For better precision on a specific application,
          AHDB&apos;s MANNER-NPK tool takes rainfall and temperature as
          inputs.
        </div>
      </div>
    </div>
  );
}
/**
 * Build a copy/paste-friendly plain-text report for sending to a contractor
 * or pasting into a message. Keeps it terse — one line per field plus headers.
 */
function buildPlainText(
  rows: ReportRow[],
  ctx: {
    mode: ReportMode;
    split: 'single' | 'split';
    totalDressings: number;
    dressingNumber: number;
    planSlurry: number;
    planSolid: number;
    planN: number;
    slurryUnit: 'gal/ac' | 'm3/ha';
    solidUnit: 't/ac' | 't/ha';
    todayIso: string;
    settings: Settings;
  },
): string {
  const lines: string[] = [];
  lines.push(`Spreading recommendation — ${fmtToday(ctx.todayIso)}`);
  lines.push(`Mode: ${MODE_LABELS[ctx.mode]}${ctx.split === 'split' ? ` · dressing ${ctx.dressingNumber} of ${ctx.totalDressings}` : ''}`);
  const planParts: string[] = [];
  if (ctx.planSlurry > 0) planParts.push(`${fmt(ctx.planSlurry)} ${ctx.slurryUnit} slurry`);
  if (ctx.planSolid > 0)  planParts.push(`${fmt(ctx.planSolid, 1)} ${ctx.solidUnit} solid manure`);
  if (ctx.planN > 0)      planParts.push(`${fmt(ctx.planN)} kg N/ha granular`);
  if (planParts.length) lines.push(`Plan: ${planParts.join(' + ')}`);
  else lines.push('Plan: raw shortfall (nothing planned)');
  lines.push('');

  rows.forEach((r) => {
    const f = r.state.field;
    const area = displayFieldArea(f, ctx.settings.unitSystem);
    lines.push(`${f.name} (${fmt(area.value, 1)} ${area.unit})`);
    if (r.state.lastCut && r.state.daysSinceLastCut != null) {
      lines.push(`  Last cut ${fmtDateShort(r.state.lastCut.cut_date)} (${r.state.daysSinceLastCut}d ago)`);
    }
    const fmtTriple = (t: Triple) => {
      const n = displayBagAmount(t.n, ctx.settings.bagFertUnit).value;
      const p = displayBagAmount(t.p, ctx.settings.bagFertUnit).value;
      const k = displayBagAmount(t.k, ctx.settings.bagFertUnit).value;
      return `${fmt(n)} N · ${fmt(p)} P₂O₅ · ${fmt(k)} K₂O`;
    };
    lines.push(`  Target:    ${fmtTriple(r.target)}`);
    lines.push(`  Applied:   ${fmtTriple(r.applied)}`);
    if (r.planned.n > 0 || r.planned.p > 0 || r.planned.k > 0) {
      lines.push(`  Planned:   ${fmtTriple(r.planned)}`);
    }
    lines.push(`  Remaining: ${fmtTriple(r.remaining)}`);
    if (r.remaining.n > 1 || r.remaining.p > 1 || r.remaining.k > 1) {
      const totalParts: string[] = [];
      if (r.remaining.n > 1) totalParts.push(`${fmt(r.remaining.n * f.ha)} kg N`);
      if (r.remaining.p > 1) totalParts.push(`${fmt(r.remaining.p * f.ha)} kg P₂O₅`);
      if (r.remaining.k > 1) totalParts.push(`${fmt(r.remaining.k * f.ha)} kg K₂O`);
      lines.push(`  → Order: ${totalParts.join(' + ')}`);
    }
    lines.push('');
  });

  lines.push('---');
  lines.push('* N is the crop-available fraction (RB209) — slurry/manure N already');
  lines.push('  reduced for volatilisation and timing losses. P and K are total content;');
  lines.push('  the soil index captures long-term banking.');
  lines.push('Dry warm conditions after spreading reduce available N (~5-10 kg/ha per');
  lines.push('  50 m³/ha slurry). Rain within 24-48h increases it (~10-15 kg/ha).');

  return lines.join('\n');
}

/**
 * Build CSV body for the spreading report — one row per field. Columns are
 * machine-readable (units in the header line) so the file opens cleanly in
 * Excel or Google Sheets without further fiddling.
 *
 * All N values are crop-available (same convention as the report cards);
 * P and K are total content per the RB209 model.
 */
function buildCsv(rows: ReportRow[], settings: Settings, groups: Group[]): string {
  // Build a lookup map so we can resolve group names per row.
  const groupNameById = new Map(groups.map((g) => [g.id, g.name]));

  // Header row — units in the column names so receivers don't have to guess.
  const lines: string[] = [];
  lines.push(csvRow([
    'Field',
    'Group',
    `Area (${settings.unitSystem === 'acres' ? 'ac' : 'ha'})`,
    'Soil type',
    'Grass system',
    'Last cut date',
    'Next cut',
    'Status',
    'Target N (kg/ha)',
    'Applied N (kg/ha)',
    'Planned N (kg/ha)',
    'Remaining N (kg/ha)',
    'Target P2O5 (kg/ha)',
    'Applied P2O5 (kg/ha)',
    'Planned P2O5 (kg/ha)',
    'Remaining P2O5 (kg/ha)',
    'Target K2O (kg/ha)',
    'Applied K2O (kg/ha)',
    'Planned K2O (kg/ha)',
    'Remaining K2O (kg/ha)',
    'Remaining N total (kg)',
    'Remaining P2O5 total (kg)',
    'Remaining K2O total (kg)',
    'Season N applied (kg/ha)',
    'Annual N cap (kg/ha)',
  ]));

  const round1 = (n: number) => Math.round(n * 10) / 10;

  rows.forEach((r) => {
    const f = r.state.field;
    const areaVal = settings.unitSystem === 'acres' ? f.acres : f.ha;
    const groupName = f.group_id ? (groupNameById.get(f.group_id) ?? '') : '';
    const statusLabel =
      r.status === 'covered'     ? 'Covered' :
      r.status === 'short_n'     ? 'Short of N' :
      r.status === 'short_p'     ? 'Short of P' :
      r.status === 'short_k'     ? 'Short of K' :
                                   'Multiple shortfalls';
    lines.push(csvRow([
      f.name,
      groupName,
      round1(areaVal),
      SOIL_TYPE_SHORT_LABELS[getSoilType(f)],
      r.grassSystem?.short_label ?? '',
      r.state.lastCut?.cut_date ?? '',
      NEXT_CUT_LABELS[r.state.nextCutType],
      statusLabel,
      round1(r.target.n),
      round1(r.applied.n),
      round1(r.planned.n),
      round1(r.remaining.n),
      round1(r.target.p),
      round1(r.applied.p),
      round1(r.planned.p),
      round1(r.remaining.p),
      round1(r.target.k),
      round1(r.applied.k),
      round1(r.planned.k),
      round1(r.remaining.k),
      round1(r.remaining.n * f.ha),
      round1(r.remaining.p * f.ha),
      round1(r.remaining.k * f.ha),
      round1(r.seasonNApplied),
      r.nCap,
    ]));
  });

  return lines.join('\r\n');
}

function fmtToday(todayIso: string): string {
  const d = new Date(todayIso);
  const day = d.getDate();
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}
