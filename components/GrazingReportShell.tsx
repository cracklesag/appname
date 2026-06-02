'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
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
  displayBagAmount,
  nutrientPerArea,
  displayFieldArea,
  fmt,
  fmtDateShort,
  getNCap,
  getNextCutType,
  getSoilType,
  isHeadingForRotationalGrazing,
  isMaintenanceGrazing,
  resolveFieldNextAction,
  resolveGrassSystem,
  SOIL_TYPE_SHORT_LABELS,
  sumNutrients,
} from '@/lib/rules';
import { meteredApps, fieldAreaHa } from '@/lib/partials';
import { setGroupToGrazing } from '@/lib/actions';
import { csvFilename, csvRow, downloadCsv } from '@/lib/csv';

// =====================================================================
// Grazing top-up report
// =====================================================================
//
// Shape: list of fields currently being grazed, sorted by when the next
// N top-up is due. Uses the cadence settings (kg N/ha every N weeks).
//
// "Currently grazed" = next planned cut is grazing. The "all cuts done,
// last cut was grazing" case is intentionally excluded for chunk B; the
// app handles a season's worth of cuts and most grazing fields will have
// "grazing" as a planned cut anyway. Easy to extend if needed.

const WINDOW_PRESETS_WEEKS = [2, 4, 8] as const;

type DueStatus =
  | { kind: 'overdue'; days: number }
  | { kind: 'due_now' }
  | { kind: 'upcoming'; days: number }
  | { kind: 'no_history' };  // no N applied yet → cadence anchor is season start

export function GrazingReportShell({
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

  // URL-backed state.
  const groupFilter = params.get('group') ?? 'all';
  const windowWeeks = clampWindowWeeks(parseInt(params.get('window') ?? '4', 10));
  const dueOnly = params.get('due') === '1';

  const cadenceKgN = settings.reportDefaults.grazingCadenceKgN;
  const cadenceWeeks = settings.reportDefaults.grazingCadenceWeeks;
  const shellNUnit = settings.unitSystem === 'acres' ? 'kg N/ac' : 'kg N/ha';
  const cadenceDisp = Math.round(nutrientPerArea(cadenceKgN, settings.unitSystem));

  const writeUrl = useCallback(
    (next: { group?: string; windowWeeks?: number; dueOnly?: boolean }) => {
      const sp = new URLSearchParams(params.toString());
      if (next.group !== undefined) {
        if (next.group === 'all') sp.delete('group');
        else sp.set('group', next.group);
      }
      if (next.windowWeeks !== undefined) {
        if (next.windowWeeks === 4) sp.delete('window');
        else sp.set('window', String(next.windowWeeks));
      }
      if (next.dueOnly !== undefined) {
        if (next.dueOnly) sp.set('due', '1');
        else sp.delete('due');
      }
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // ---- Per-field state -------------------------------------------------
  //
  // Compute everything needed to render and filter the cards. Mirrors the
  // shape of the spreading report's eligibleStates so the two feel familiar.
  type FieldState = {
    field: Field;
    /** Resolved grass system, or undefined when not assigned. */
    grassSystem: GrassSystem | undefined;
    /** Most recent N-bearing application this season, or undefined if none. */
    lastNApp?: { date: string; nPerHa: number };
    /** Next-due date = lastNApp.date + cadenceWeeks. If no app, today. */
    nextDueIso: string;
    /** Days from today to next due. Negative = overdue. */
    daysToNextDue: number;
    /** Total season N applied (any source) — for the cap warning. */
    seasonNApplied: number;
    /** N cap for this field. */
    nCap: number;
    status: DueStatus;
  };

  const allGrazedStates: FieldState[] = useMemo(() => {
    return fields
      .map((f) => {
        const fCuts = cuts.filter((c) => c.field_id === f.id && c.cut_date >= seasonStart);
        const cutsDoneThisSeason = fCuts.length;
        const nextCutType = getNextCutType(f, cutsDoneThisSeason);
        // Eligibility — field is on rotational grazing per its most-recent
        // cut's next_action (or planned_cuts[0] for fields with no cuts yet
        // via the resolver's fallback). The legacy "nextCutType === grazing"
        // check is still satisfied by the fallback path, so existing data
        // without explicit next_action keeps showing up the same way.
        const resolved = resolveFieldNextAction(f, fCuts);
        if (!isHeadingForRotationalGrazing(resolved)) return null;

        // Filter to N-bearing season applications. Slurry/manure N is the
        // crop-available fraction (calcNutrients already applies the factor),
        // bag fert N is full content. Sum N per ha per application.
        const fApps = meteredApps(applications
          .filter((a) => a.field_id === f.id && a.date_applied >= seasonStart), () => fieldAreaHa(f));
        // Pick the most recent N-bearing application — i.e. one where the
        // product delivers any N at all. Avoids treating a lime application
        // as a "top-up".
        const productById = new Map(products.map((p) => [p.id, p]));
        const nBearing = fApps
          .filter((a) => {
            const p = productById.get(a.product_id);
            return !!p && (p.type !== 'lime');
          })
          .sort((a, b) => b.date_applied.localeCompare(a.date_applied));
        let lastNApp: FieldState['lastNApp'] = undefined;
        if (nBearing.length > 0) {
          // Compute N delivered per ha from this single application using
          // sumNutrients (treats it as a list of one).
          const top = nBearing[0];
          const ntot = sumNutrients([top], products).n;
          if (ntot > 0) lastNApp = { date: top.date_applied, nPerHa: ntot };
        }

        // Next due date — last application + cadence weeks. If no history,
        // anchor to today (i.e. "should apply now").
        const nextDueIso = lastNApp
          ? isoAddDays(lastNApp.date, cadenceWeeks * 7)
          : todayIso;
        const daysToNextDue = daysBetween(todayIso, nextDueIso);

        const seasonNApplied = sumNutrients(
          fApps,
          products,
        ).n;
        const system = resolveGrassSystem(f, grassSystems);
        const nCap = getNCap(f, settings, system);

        const status: DueStatus = !lastNApp
          ? { kind: 'no_history' }
          : daysToNextDue < -1
            ? { kind: 'overdue', days: Math.abs(daysToNextDue) }
            : daysToNextDue <= 1
              ? { kind: 'due_now' }
              : { kind: 'upcoming', days: daysToNextDue };

        return {
          field: f,
          grassSystem: system,
          lastNApp,
          nextDueIso,
          daysToNextDue,
          seasonNApplied,
          nCap,
          status,
        } as FieldState;
      })
      .filter((s): s is FieldState => s != null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, cuts, applications, products, seasonStart, todayIso, cadenceWeeks, settings, grassSystems]);

  // Apply group + window + due-only filters.
  const visibleStates: FieldState[] = useMemo(() => {
    const windowDays = windowWeeks * 7;
    return allGrazedStates
      .filter((s) => {
        // Group filter
        if (groupFilter !== 'all') {
          if (groupFilter === 'unassigned') {
            if (s.field.group_id) return false;
          } else if (s.field.group_id !== groupFilter) {
            return false;
          }
        }
        // Window: only show fields due within the next windowDays days.
        // Overdue is always shown — the user wants to know.
        if (s.daysToNextDue > windowDays) return false;
        // Due-only: hide upcoming, show due_now / overdue / no_history.
        if (dueOnly && s.status.kind === 'upcoming') return false;
        return true;
      })
      .sort((a, b) => a.daysToNextDue - b.daysToNextDue);
  }, [allGrazedStates, groupFilter, windowWeeks, dueOnly]);

  // Summary counts.
  const summary = useMemo(() => {
    let overdue = 0, dueNow = 0, upcoming = 0;
    visibleStates.forEach((s) => {
      if (s.status.kind === 'overdue') overdue++;
      else if (s.status.kind === 'due_now') dueNow++;
      else if (s.status.kind === 'upcoming') upcoming++;
    });
    return { overdue, dueNow, upcoming };
  }, [visibleStates]);

  // Group chip options (only show if user has groups).
  const groupChipOpts = groups.length === 0 ? null : (() => {
    const anyUngrouped = allGrazedStates.some((s) => !s.field.group_id);
    return [
      { value: 'all', label: 'All groups' },
      ...groups.map((g) => ({ value: g.id, label: g.name })),
      ...(anyUngrouped ? [{ value: 'unassigned', label: 'Ungrouped' }] : []),
    ];
  })();

  // Copy + print.
  const [copied, setCopied] = useState(false);

  // Groups that contain fields NOT currently heading for grazing — these are
  // candidates for the bulk "set group to grazing" action. (A field on
  // maintenance grazing is deliberately left out of the rotation, so it
  // doesn't count as "missing".)
  const [grazeGroupId, setGrazeGroupId] = useState<string>('');
  const nonGrazingByGroup = useMemo(() => {
    const out: { id: string; name: string; count: number; sample: string[] }[] = [];
    for (const g of groups) {
      const inGroup = fields.filter((f) => f.group_id === g.id && !f.needs_setup);
      const notGrazing = inGroup.filter((f) => {
        const fCuts = cuts.filter((c) => c.field_id === f.id && c.cut_date >= seasonStart);
        const resolved = resolveFieldNextAction(f, fCuts);
        return !isHeadingForRotationalGrazing(resolved) && !isMaintenanceGrazing(resolved);
      });
      if (notGrazing.length > 0) {
        out.push({
          id: g.id, name: g.name, count: notGrazing.length,
          sample: notGrazing.slice(0, 3).map((f) => f.name),
        });
      }
    }
    return out;
  }, [groups, fields, cuts, seasonStart]);

  const handleCopy = () => {
    const text = buildPlainText(visibleStates, {
      cadenceKgN, cadenceWeeks, todayIso, settings,
    });
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
    const csv = buildCsv(visibleStates, settings, groups, cadenceKgN, cadenceWeeks);
    downloadCsv(csvFilename('grazing'), csv);
  };

  // ---- Render ----------------------------------------------------------

  // Bulk "set a whole group to grazing" helper — shown when a group has fields
  // that aren't set to grazing. Posts to the server action via a form.
  const grazeHelper = nonGrazingByGroup.length === 0 ? null : (
    <form action={setGroupToGrazing} className="card no-print" style={{ padding: 13, marginBottom: 14, background: 'var(--card)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
        Grazing block not showing?
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 10 }}>
        A field only appears here when its cut plan is set to grazing — grouping it isn&apos;t enough.
        Set a whole group to grazing in one go:
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          name="group_id"
          value={grazeGroupId}
          onChange={(e) => setGrazeGroupId(e.target.value)}
          className="select"
          style={{ flex: 1, minWidth: 150 }}
          required
        >
          <option value="">Choose a group…</option>
          {nonGrazingByGroup.map((g) => (
            <option key={g.id} value={g.id}>{g.name} ({g.count} not grazing)</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={grazeGroupId === ''}
          style={{
            flexShrink: 0, background: grazeGroupId === '' ? 'var(--line)' : 'var(--forest)',
            color: grazeGroupId === '' ? 'var(--muted)' : 'var(--paper)',
            border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 700,
            cursor: grazeGroupId === '' ? 'default' : 'pointer',
          }}
        >
          Set to grazing
        </button>
      </div>
      {grazeGroupId !== '' && (() => {
        const g = nonGrazingByGroup.find((x) => x.id === grazeGroupId);
        if (!g) return null;
        const extra = g.count - g.sample.length;
        return (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            Will set {g.sample.join(', ')}{extra > 0 ? ` and ${extra} more` : ''} to a grazing plan.
          </div>
        );
      })()}
    </form>
  );

  if (allGrazedStates.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        {grazeHelper}
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>
            No fields with grazing planned this season.
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            The grazing report lists fields where the next planned cut is grazing.
            Update a field&apos;s cut plan to include grazing if you want it here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      {grazeHelper}
      {/* Cadence settings hint */}
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
        Cadence: <strong>{cadenceDisp} {shellNUnit} every {cadenceWeeks} week{cadenceWeeks === 1 ? '' : 's'}</strong>
        {' · '}<a href="/settings" style={{ color: 'var(--forest-dark, #3d5b29)' }}>change in settings</a>
      </div>

      {/* Group chip */}
      {groupChipOpts && (
        <div style={{ marginBottom: 12 }}>
          <div className="label" style={{ marginBottom: 6 }}>Group</div>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
            {groupChipOpts.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`toggle-btn ${groupFilter === o.value ? 'active' : ''}`}
                onClick={() => writeUrl({ group: o.value })}
                style={{ fontSize: 13, padding: '6px 12px', flexShrink: 0, whiteSpace: 'nowrap' }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Window picker + due-only */}
      <div style={{ marginBottom: 12 }}>
        <div className="label" style={{ marginBottom: 6 }}>Window</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {WINDOW_PRESETS_WEEKS.map((n) => (
            <button
              key={n}
              type="button"
              className={`toggle-btn ${windowWeeks === n ? 'active' : ''}`}
              onClick={() => writeUrl({ windowWeeks: n })}
              style={{ fontSize: 13, padding: '6px 12px' }}
            >
              Next {n}w
            </button>
          ))}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={dueOnly}
              onChange={(e) => writeUrl({ dueOnly: e.target.checked })}
              style={{ width: 16, height: 16 }}
            />
            <span style={{ color: 'var(--ink)' }}>Due / overdue only</span>
          </label>
        </div>
      </div>

      {/* Print-only header */}
      <div className="print-only" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>Grazing top-up schedule</h2>
        <div style={{ fontSize: 11, color: '#555' }}>
          {cadenceDisp} {shellNUnit} every {cadenceWeeks} week{cadenceWeeks === 1 ? '' : 's'} · {fmtFullDate(todayIso)}
        </div>
      </div>

      {/* Summary card */}
      <div
        className="card report-summary"
        style={{ padding: 14, marginBottom: 12, background: 'var(--forest-soft, #eef0e8)' }}
      >
        <div className="label" style={{ marginBottom: 6 }}>Summary</div>
        <div style={{ fontSize: 13, color: 'var(--ink)' }}>
          <strong>{visibleStates.length}</strong> field{visibleStates.length === 1 ? '' : 's'} in view ·
          {' '}<strong>{summary.overdue}</strong> overdue ·
          {' '}<strong>{summary.dueNow}</strong> due now ·
          {' '}<strong>{summary.upcoming}</strong> upcoming
        </div>
      </div>

      {/* Per-field cards */}
      {visibleStates.length === 0 ? (
        <div className="card" style={{ padding: 14, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          {dueOnly
            ? 'Nothing due or overdue in this window.'
            : 'No grazing fields match the current filters.'}
        </div>
      ) : (
        visibleStates.map((s) => (
          <GrazingFieldCard
            key={s.field.id}
            state={s}
            settings={settings}
            cadenceKgN={cadenceKgN}
            groupName={s.field.group_id ? (groups.find((g) => g.id === s.field.group_id)?.name ?? null) : null}
          />
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

      {/* Print stylesheet — mirrors the spreading report's. */}
      <style>{`
        .print-only { display: none; }
        @media print {
          .print-only { display: block; }
          .no-print { display: none !important; }
          body { background: white !important; }
          body > div > div:not(.report-section),
          header, nav, footer { display: none !important; }
          .report-summary { background: #f7f5ee !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}

// ---- Card ------------------------------------------------------------

function GrazingFieldCard({
  state, settings, cadenceKgN, groupName,
}: {
  state: {
    field: Field;
    lastNApp?: { date: string; nPerHa: number };
    nextDueIso: string;
    daysToNextDue: number;
    seasonNApplied: number;
    nCap: number;
    status: DueStatus;
  };
  settings: Settings;
  cadenceKgN: number;
  groupName: string | null;
}) {
  const { field: f, lastNApp, nextDueIso, daysToNextDue, seasonNApplied, nCap, status } = state;
  const area = displayFieldArea(f, settings.unitSystem);

  // Status pill colour + text.
  const statusInfo =
    status.kind === 'overdue'  ? { tone: 'var(--red, #b85b3a)', label: `Overdue by ${status.days}d` } :
    status.kind === 'due_now'  ? { tone: 'var(--red, #b85b3a)', label: 'Due now' } :
    status.kind === 'upcoming' ? { tone: 'var(--forest-dark, #3d5b29)', label: `In ${status.days}d` } :
                                  { tone: 'var(--ink-soft, #6a6055)', label: 'Awaiting first dose' };

  const nUnit = settings.unitSystem === 'acres' ? 'kg/ac' : 'kg/ha';
  const cv = (kgHa: number) => Math.round(nutrientPerArea(kgHa, settings.unitSystem));
  const recommendedNView = { value: cv(cadenceKgN), unit: nUnit };
  const totalNKg = cadenceKgN * f.ha;

  const nCapHeadroom = nCap - seasonNApplied;
  const nearCap = nCapHeadroom < 50;
  const overCap = seasonNApplied > nCap;

  return (
    <div className="card report-field-card" style={{ padding: 14, marginBottom: 10 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{f.name}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {fmt(area.value, 1)} {area.unit}
            {groupName && <> · {groupName}</>}
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

      {/* Last N application */}
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
        {lastNApp ? (
          <>
            Last N: <strong style={{ color: 'var(--ink)' }}>{fmtDateShort(lastNApp.date)}</strong>
            {' '}({fmt(cv(lastNApp.nPerHa))} {nUnit} N)
            {' · '}Next due: <strong style={{ color: 'var(--ink)' }}>{fmtDateShort(nextDueIso)}</strong>
          </>
        ) : (
          <>No N applied yet this season. Recommend applying now.</>
        )}
      </div>

      {/* Recommended dose */}
      <div style={{
        marginTop: 8, padding: '10px 12px',
        background: 'var(--paper-deep, #f4ede1)',
        borderRadius: 6,
        fontSize: 13,
      }}>
        <div style={{ fontWeight: 700, color: 'var(--ink)' }}>
          Apply {fmt(recommendedNView.value)} {recommendedNView.unit} N
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
          {fmt(totalNKg)} kg N total across {fmt(area.value, 1)} {area.unit}
        </div>
      </div>

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
            ? `⚠ Over annual N cap — ${fmt(cv(seasonNApplied))} ${nUnit} applied vs ${cv(nCap)} cap.`
            : `Approaching annual N cap — ${fmt(cv(seasonNApplied))} ${nUnit} of ${cv(nCap)} (${fmt(cv(nCapHeadroom))} headroom).`}
        </div>
      )}
    </div>
  );
}

// ---- Helpers ---------------------------------------------------------

function clampWindowWeeks(n: number): number {
  if (!Number.isFinite(n)) return 4;
  return Math.max(1, Math.min(26, n));
}

function isoAddDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function fmtFullDate(todayIso: string): string {
  const d = new Date(todayIso);
  const day = d.getDate();
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

function buildPlainText(
  states: {
    field: Field;
    lastNApp?: { date: string; nPerHa: number };
    nextDueIso: string;
    daysToNextDue: number;
    status: DueStatus;
  }[],
  ctx: {
    cadenceKgN: number;
    cadenceWeeks: number;
    todayIso: string;
    settings: Settings;
  },
): string {
  const lines: string[] = [];
  lines.push(`Grazing top-up schedule — ${fmtFullDate(ctx.todayIso)}`);
  lines.push(`Cadence: ${ctx.cadenceKgN} kg N/ha every ${ctx.cadenceWeeks} week${ctx.cadenceWeeks === 1 ? '' : 's'}`);
  lines.push('');
  states.forEach((s) => {
    const area = displayFieldArea(s.field, ctx.settings.unitSystem);
    const recommended = displayBagAmount(ctx.cadenceKgN, ctx.settings.bagFertUnit);
    const totalNKg = ctx.cadenceKgN * s.field.ha;
    const statusLabel =
      s.status.kind === 'overdue'  ? `Overdue by ${s.status.days}d` :
      s.status.kind === 'due_now'  ? 'Due now' :
      s.status.kind === 'upcoming' ? `In ${s.status.days}d` :
                                      'Awaiting first dose';
    lines.push(`${s.field.name} (${fmt(area.value, 1)} ${area.unit}) — ${statusLabel}`);
    if (s.lastNApp) {
      lines.push(`  Last N: ${fmtDateShort(s.lastNApp.date)} (${fmt(s.lastNApp.nPerHa)} kg N/ha)`);
      lines.push(`  Next due: ${fmtDateShort(s.nextDueIso)}`);
    } else {
      lines.push(`  No N applied yet this season`);
    }
    lines.push(`  → Apply ${fmt(recommended.value)} ${recommended.unit} N (${fmt(totalNKg)} kg total)`);
    lines.push('');
  });
  return lines.join('\n');
}

/**
 * Build CSV body for the grazing top-up schedule — one row per visible field.
 *
 * Includes everything a contractor or agronomist would want from a grazing
 * round: when each field was last topped up, when the next dose is due,
 * status (overdue / due now / etc.), and the recommended kg total per field.
 */
function buildCsv(
  states: {
    field: Field;
    grassSystem: GrassSystem | undefined;
    lastNApp?: { date: string; nPerHa: number };
    nextDueIso: string;
    daysToNextDue: number;
    seasonNApplied: number;
    nCap: number;
    status: DueStatus;
  }[],
  settings: Settings,
  groups: Group[],
  cadenceKgN: number,
  cadenceWeeks: number,
): string {
  const groupNameById = new Map(groups.map((g) => [g.id, g.name]));
  const lines: string[] = [];
  lines.push(csvRow([
    'Field',
    'Group',
    `Area (${settings.unitSystem === 'acres' ? 'ac' : 'ha'})`,
    'Soil type',
    'Grass system',
    'Status',
    'Last N date',
    'Last N (kg/ha)',
    'Next due',
    'Days to next due',
    'Recommended N (kg/ha)',
    'Recommended N total (kg)',
    'Season N applied (kg/ha)',
    'Annual N cap (kg/ha)',
    'Cadence (kg N/ha)',
    'Cadence (weeks)',
  ]));
  const round1 = (n: number) => Math.round(n * 10) / 10;

  states.forEach((s) => {
    const f = s.field;
    const areaVal = settings.unitSystem === 'acres' ? f.acres : f.ha;
    const groupName = f.group_id ? (groupNameById.get(f.group_id) ?? '') : '';
    const statusLabel =
      s.status.kind === 'overdue'  ? `Overdue by ${s.status.days}d` :
      s.status.kind === 'due_now'  ? 'Due now' :
      s.status.kind === 'upcoming' ? `In ${s.status.days}d` :
                                      'Awaiting first dose';
    const totalNKg = cadenceKgN * f.ha;
    lines.push(csvRow([
      f.name,
      groupName,
      round1(areaVal),
      SOIL_TYPE_SHORT_LABELS[getSoilType(f)],
      s.grassSystem?.short_label ?? '',
      statusLabel,
      s.lastNApp?.date ?? '',
      s.lastNApp ? round1(s.lastNApp.nPerHa) : '',
      s.nextDueIso,
      s.daysToNextDue,
      cadenceKgN,
      round1(totalNKg),
      round1(s.seasonNApplied),
      s.nCap,
      cadenceKgN,
      cadenceWeeks,
    ]));
  });

  return lines.join('\r\n');
}
