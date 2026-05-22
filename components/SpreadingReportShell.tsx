'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  Application,
  Cut,
  Field,
  Product,
  Settings,
} from '@/lib/types';
import {
  fmtDateShort,
  getNextCutType,
  NEXT_CUT_LABELS,
} from '@/lib/rules';

type ReportMode = 'post_cut' | 'spring' | 'mid_season';

const MODE_LABELS: Record<ReportMode, string> = {
  post_cut: 'Post-cut top-up',
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
  fields,
  applications,
  cuts,
  products,
  settings,
  seasonStart,
  todayIso,
}: {
  initialMode: ReportMode;
  initialWindowDays: number;
  initialFieldsParam: string | null;
  fields: Field[];
  applications: Application[];
  cuts: Cut[];
  products: Product[];
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

  // Calibration params — all URL-backed so the report is shareable / reloadable.
  // `split` = 'single' (default) | 'split'
  // `total` = 2 | 3 (only meaningful when split)
  // `dressing` = 1 | 2 | 3 (which dressing this is — 1-indexed)
  // Plan rates: empty string or 0 means "not planning this input".
  const split = (params.get('split') === 'split') ? 'split' as const : 'single' as const;
  const totalDressings = clampInt(params.get('total'), 2, 3, 2);
  const dressingNumber = clampInt(params.get('dressing'), 1, totalDressings, 1);
  const planSlurryRaw = params.get('plan_slurry') ?? '';
  const planSolidRaw = params.get('plan_solid') ?? '';
  const planNRaw = params.get('plan_n') ?? '';
  const planSlurry = parseFloat(planSlurryRaw);
  const planSolid = parseFloat(planSolidRaw);
  const planN = parseFloat(planNRaw);
  // "checked" = the user has decided to include this input. Empty input
  // means unchecked; numeric (even zero) means checked.
  const slurryActive = planSlurryRaw !== '';
  const solidActive = planSolidRaw !== '';
  const granularActive = planNRaw !== '';

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
  }, [fieldStates, mode, windowDays]);

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
      split?: 'single' | 'split';
      totalDressings?: number;
      dressingNumber?: number;
      planSlurry?: string;   // empty string = remove from URL = unchecked
      planSolid?: string;
      planN?: string;
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
          {(['post_cut', 'spring', 'mid_season'] as ReportMode[]).map((m) => (
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

      {/* Field selection */}
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Dressing</span>
                {/* Dressing-number buttons */}
                {Array.from({ length: totalDressings }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`toggle-btn ${dressingNumber === n ? 'active' : ''}`}
                    onClick={() => writeUrl({ dressingNumber: n })}
                    style={{ fontSize: 12, padding: '4px 10px', minWidth: 32 }}
                  >
                    {n}
                  </button>
                ))}
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>of</span>
                {/* Total dressings */}
                {[2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`toggle-btn ${totalDressings === n ? 'active' : ''}`}
                    onClick={() => writeUrl({ totalDressings: n })}
                    style={{ fontSize: 12, padding: '4px 10px', minWidth: 32 }}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>
                This dressing gets {Math.round(thisDressingNShare)}% of N. P and K stay full on every dressing.
                {' '}First-dressing N % is set in Settings → Report defaults ({splitPct}%).
              </div>
            </div>
          )}
        </div>

        {/* Planning intents — three checkbox+rate rows */}
        <div style={{ marginTop: 6 }}>
          {/* Slurry */}
          <CalibrationRow
            checked={slurryActive}
            onToggle={(on) => writeUrl({ planSlurry: on ? String(planSlurry || '') : '' })}
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
            onToggle={(on) => writeUrl({ planSolid: on ? String(planSolid || '') : '' })}
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
            onToggle={(on) => writeUrl({ planN: on ? String(planN || '') : '' })}
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

      {/* Report rendering placeholder — wired in step 4. For now, show a
          tiny calibration summary so the user can sanity-check their inputs
          are captured before the full report exists. */}
      <div className="card" style={{ padding: 14 }}>
        <div className="label" style={{ marginBottom: 6 }}>Report (coming next)</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
          Per-field requirements, remaining shortfall, copy and print actions land in the next step.
        </div>
        <div style={{
          padding: 10,
          background: 'var(--paper-deep, #f4ede1)',
          fontSize: 12, color: 'var(--ink-soft)', borderRadius: 6,
          fontFamily: 'ui-monospace, monospace',
        }}>
          <div style={{ marginBottom: 4 }}>
            <strong>{selectedIds.size}</strong> field{selectedIds.size === 1 ? '' : 's'} selected
            {split === 'split' && ` · dressing ${dressingNumber} of ${totalDressings} (~${Math.round(thisDressingNShare)}% N)`}
          </div>
          {anyPlanActive ? (
            <>
              {slurryActive && <div>Slurry: {planSlurryRaw || '—'} {slurryUnitLabel}</div>}
              {solidActive && <div>Solid manure: {planSolidRaw || '—'} {solidUnitLabel}</div>}
              {granularActive && <div>Granular N: {planNRaw || '—'} {granularUnitLabel}</div>}
            </>
          ) : (
            <div style={{ fontStyle: 'italic' }}>No planned inputs — raw shortfall view.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Small components / helpers ------------------------------------

function EmptyState({ mode }: { mode: ReportMode }) {
  const suggestion =
    mode === 'post_cut' ? 'Nothing cut in the window. Try widening to 30 days, or switch to Spring or Mid-season mode.' :
    mode === 'spring'   ? 'Every field has already been cut this season. Try Post-cut top-up or Mid-season top-up instead.' :
                          'No fields between cuts. Try Post-cut top-up if you just cut, or Spring dressing if no cuts yet.';
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
