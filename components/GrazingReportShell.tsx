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
  Product,
  Settings,
} from '@/lib/types';
import {
  displayBagAmount,
  displayNutrient,
  nutrientLabel,
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
import { computeGrazingSchedule } from '@/lib/grazing';
import { setGroupToGrazing, setFieldToGrazing } from '@/lib/actions';
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
  const legacyDue = params.get('due') === '1';
  const bucketParam = params.get('bucket');
  const bucket: 'overdue' | 'due' | 'later' | null =
    bucketParam === 'overdue' || bucketParam === 'due' || bucketParam === 'later' ? bucketParam : legacyDue ? 'due' : null;
  const showLastApp = params.get('lastapp') !== '0';

  const cadenceKgN = settings.reportDefaults.grazingCadenceKgN;
  const cadenceWeeks = settings.reportDefaults.grazingCadenceWeeks;
  const shellNUnit = nutrientLabel(settings.bagFertUnit);
  const cadenceDisp = Math.round(displayNutrient(cadenceKgN, settings.bagFertUnit).value);

  const writeUrl = useCallback(
    (next: { group?: string; windowWeeks?: number; dueOnly?: boolean; showLastApp?: boolean; bucket?: 'overdue' | 'due' | 'later' | null }) => {
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
      if (next.bucket !== undefined) {
        sp.delete('due');
        if (next.bucket) sp.set('bucket', next.bucket);
        else sp.delete('bucket');
      }
      if (next.showLastApp !== undefined) {
        if (next.showLastApp) sp.delete('lastapp');
        else sp.set('lastapp', '0');
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

  const allGrazedStates: FieldState[] = useMemo(
    () => computeGrazingSchedule({ fields, applications, cuts, products, grassSystems, settings, seasonStart, todayIso }),
    [fields, applications, cuts, products, grassSystems, settings, seasonStart, todayIso],
  );

  // Which triage bucket a state belongs to (tiles + grouped list share this).
  const bucketOf = (s2: FieldState): 'overdue' | 'due' | 'later' =>
    s2.status.kind === 'overdue' ? 'overdue'
      : s2.status.kind === 'due_now' || (s2.status.kind === 'upcoming' && s2.status.days <= 7) ? 'due'
      : s2.status.kind === 'upcoming' ? 'later' : 'due';

  // Group + window only — the tiles count over this, regardless of bucket tap.
  const baseStates: FieldState[] = useMemo(() => {
    const windowDays = windowWeeks * 7;
    return allGrazedStates
      .filter((s) => {
        if (groupFilter !== 'all') {
          if (groupFilter === 'unassigned') {
            if (s.field.group_id) return false;
          } else if (s.field.group_id !== groupFilter) {
            return false;
          }
        }
        if (s.daysToNextDue > windowDays) return false;
        return true;
      })
      .sort((a, b) => a.daysToNextDue - b.daysToNextDue);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allGrazedStates, groupFilter, windowWeeks]);

  // Apply group + window + due-only filters.
  const visibleStates: FieldState[] = useMemo(
    () => (bucket ? baseStates.filter((s) => bucketOf(s) === bucket) : baseStates),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseStates, bucket],
  );

  // Summary counts.
  const summary = useMemo(() => {
    let overdue = 0, dueNow = 0, upcoming = 0, dueSoon = 0, later = 0;
    baseStates.forEach((s) => {
      const b = bucketOf(s);
      if (b === 'overdue') overdue++;
      else if (b === 'due') dueSoon++;
      else later++;
      if (s.status.kind === 'due_now') dueNow++;
      if (s.status.kind === 'upcoming') upcoming++;
    });
    return { overdue, dueNow, upcoming, dueSoon, later };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseStates]);

  // Group chip options (only show if user has groups).
  const groupChipOpts = groups.length === 0 ? null : (() => {
    const anyUngrouped = allGrazedStates.some((s) => !s.field.group_id);
    // Groups that actually have grazing fields are most relevant here, so
    // surface them first (stable sort keeps each bucket's original order).
    const grazingGroupIds = new Set(
      allGrazedStates.map((s) => s.field.group_id).filter(Boolean) as string[],
    );
    const sortedGroups = [...groups].sort(
      (a, b) => (grazingGroupIds.has(a.id) ? 0 : 1) - (grazingGroupIds.has(b.id) ? 0 : 1),
    );
    return [
      { value: 'all', label: 'All groups' },
      ...sortedGroups.map((g) => ({ value: g.id, label: g.name })),
      ...(anyUngrouped ? [{ value: 'unassigned', label: 'Ungrouped' }] : []),
    ];
  })();

  // Fields in the selected group that aren't on a grazing plan (so aren't
  // tracked for top-ups). Shown in a collapsible so every field in a group is
  // visible, with a one-tap way to add each to grazing.
  const otherGroupFields =
    groupFilter === 'all' || groupFilter === 'unassigned'
      ? []
      : (() => {
          const grazingIds = new Set(allGrazedStates.map((s) => s.field.id));
          return fields.filter(
            (f) => f.group_id === groupFilter && !f.needs_setup && !grazingIds.has(f.id),
          );
        })();

  // Copy + print.
  const [copied, setCopied] = useState(false);

  // Groups that contain fields NOT currently heading for grazing — these are
  // candidates for the bulk "set group to grazing" action. (A field on
  // maintenance grazing is deliberately left out of the rotation, so it
  // doesn't count as "missing".)
  const [grazeGroupId, setGrazeGroupId] = useState<string>('');
  const [showOthers, setShowOthers] = useState(false);
  const [showGrazeSetup, setShowGrazeSetup] = useState(false);
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
  const grazeHelper = nonGrazingByGroup.length === 0 ? null : !showGrazeSetup ? (
    <button
      type="button"
      onClick={() => setShowGrazeSetup(true)}
      className="no-print"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: '2px 2px', marginBottom: 14, fontSize: 12, fontWeight: 600, color: 'var(--muted)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}
    >
      A block not on grazing? Set a whole block &rarr;
    </button>
  ) : (
    <form action={setGroupToGrazing} className="card no-print" style={{ padding: 13, marginBottom: 14, background: 'var(--card)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Set a block to grazing</div>
        <button type="button" onClick={() => setShowGrazeSetup(false)} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 0 }}>&times;</button>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 10 }}>
        A field only appears here when its cut plan is set to grazing. Set a whole block in one go:
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

      {/* Triage tiles — tap to filter, tap again for all */}
      <div className="no-print" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
        {([
          { key: 'overdue' as const, n: summary.overdue, label: 'Overdue', bg: '#f6e3dd', fg: '#9c4a2f', edge: 'var(--red, #b85b3a)', edgeSoft: 'rgba(184, 91, 58, 0.45)' },
          { key: 'due' as const, n: summary.dueSoon, label: 'Due soon', bg: '#fdf0dd', fg: '#9a6320', edge: '#c9882f', edgeSoft: 'rgba(201, 136, 47, 0.45)' },
          { key: 'later' as const, n: summary.later, label: 'Upcoming', bg: 'var(--forest-soft, #e1e6d9)', fg: 'var(--forest-dark, #2b4129)', edge: 'var(--forest, #3b5a3a)', edgeSoft: 'rgba(59, 90, 58, 0.4)' },
        ]).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => writeUrl({ bucket: bucket === t.key ? null : t.key })}
            style={{
              background: t.bg, border: `2px solid ${bucket === t.key ? t.edge : t.edgeSoft}`,
              boxShadow: bucket === t.key ? `inset 0 0 0 1px ${t.edge}` : 'none',
              borderRadius: 10, padding: '10px 6px', textAlign: 'center', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, color: t.fg, lineHeight: 1.1 }}>{t.n}</div>
            <div style={{ fontSize: 11.5, color: t.fg, marginTop: 2 }}>{t.label}</div>
          </button>
        ))}
      </div>

      {/* One-row filters: group · window · last-app */}
      <div className="no-print no-scrollbar" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 12, WebkitOverflowScrolling: 'touch', alignItems: 'center' }}>
        {groupChipOpts && groupChipOpts.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`toggle-btn ${groupFilter === o.value ? 'active' : ''}`}
            onClick={() => writeUrl({ group: o.value })}
            style={{ fontSize: 12.5, padding: '6px 11px', flexShrink: 0, whiteSpace: 'nowrap', borderRadius: 99, border: groupFilter === o.value ? '1px solid var(--forest-dark, #2b4129)' : '1px solid var(--line)', background: groupFilter === o.value ? 'var(--forest-dark, #2b4129)' : 'var(--card)', color: groupFilter === o.value ? 'var(--brand-cream, #efe7d6)' : undefined }}
          >
            {o.label}
          </button>
        ))}
        <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', flexShrink: 0, margin: '4px 2px' }} />
        {WINDOW_PRESETS_WEEKS.map((n) => (
          <button
            key={n}
            type="button"
            className={`toggle-btn ${windowWeeks === n ? 'active' : ''}`}
            onClick={() => writeUrl({ windowWeeks: n })}
            style={{ fontSize: 12.5, padding: '6px 11px', flexShrink: 0, whiteSpace: 'nowrap', borderRadius: 99, border: windowWeeks === n ? '1px solid var(--forest-dark, #2b4129)' : '1px solid var(--line)', background: windowWeeks === n ? 'var(--forest-dark, #2b4129)' : 'var(--card)', color: windowWeeks === n ? 'var(--brand-cream, #efe7d6)' : undefined }}
          >
            {n}w
          </button>
        ))}
        <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', flexShrink: 0, margin: '4px 2px' }} />
        <button
          type="button"
          className={`toggle-btn ${showLastApp ? 'active' : ''}`}
          onClick={() => writeUrl({ showLastApp: !showLastApp })}
          style={{ fontSize: 12.5, padding: '6px 11px', flexShrink: 0, whiteSpace: 'nowrap', borderRadius: 99, border: showLastApp ? '1px solid var(--forest-dark, #2b4129)' : '1px solid var(--line)', background: showLastApp ? 'var(--forest-dark, #2b4129)' : 'var(--card)', color: showLastApp ? 'var(--brand-cream, #efe7d6)' : undefined }}
        >
          Last app
        </button>
      </div>

      {/* Print-only header */}
      <div className="print-only" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>Grazing top-up schedule</h2>
        <div style={{ fontSize: 11, color: '#555' }}>
          {cadenceDisp} {shellNUnit} every {cadenceWeeks} week{cadenceWeeks === 1 ? '' : 's'} · {fmtFullDate(todayIso)}
        </div>
      </div>

      {/* Per-field cards */}
      {visibleStates.length === 0 ? (
        <div className="card" style={{ padding: 14, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          {bucket ? 'Nothing in this bucket — tap the tile again to see everything.' : 'No grazing fields match the current filters.'}
        </div>
      ) : (
        ([
          { key: 'overdue' as const, title: 'Overdue', fg: '#9c4a2f' },
          { key: 'due' as const, title: 'Due soon', fg: '#9a6320' },
          { key: 'later' as const, title: 'Later', fg: 'var(--muted)' },
        ]).map((g) => {
          const items = visibleStates.filter((st) => bucketOf(st) === g.key);
          if (items.length === 0) return null;
          return (
            <div key={g.key}>
              <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: g.fg, margin: '12px 2px 8px' }}>
                {g.title} ({items.length})
              </div>
              {items.map((st) => (
                <GrazingFieldCard
                  key={st.field.id}
                  state={st}
                  settings={settings}
                  cadenceKgN={cadenceKgN}
                  showLastApp={showLastApp}
                  groupName={st.field.group_id ? (groups.find((gr) => gr.id === st.field.group_id)?.name ?? null) : null}
                />
              ))}
            </div>
          );
        })
      )}

      {/* Other fields in this group, not on a grazing plan */}
      {otherGroupFields.length > 0 && (
        <div className="card no-print" style={{ padding: 13, marginTop: 12 }}>
          <button
            type="button"
            onClick={() => setShowOthers((v) => !v)}
            style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--ink)', padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ color: 'var(--muted)' }}>{showOthers ? '\u25be' : '\u25b8'}</span>
            {otherGroupFields.length} more field{otherGroupFields.length === 1 ? '' : 's'} in this group, not on grazing
          </button>
          {showOthers && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 8 }}>
                These are in this group but their cut plan isn&apos;t grazing, so they aren&apos;t tracked for top-ups. Add any to grazing:
              </div>
              {otherGroupFields.map((f) => (
                <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line-soft)' }}>
                  <span style={{ fontSize: 14, color: 'var(--ink)' }}>{f.name}</span>
                  <form action={setFieldToGrazing}>
                    <input type="hidden" name="field_id" value={f.id} />
                    <button type="submit" style={{ flexShrink: 0, background: 'var(--forest)', color: 'var(--paper)', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                      Set to grazing
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </div>
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
  state, settings, cadenceKgN, groupName, showLastApp,
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
  showLastApp: boolean;
}) {
  const { field: f, lastNApp, nextDueIso, daysToNextDue, seasonNApplied, nCap, status } = state;
  const area = displayFieldArea(f, settings.unitSystem);

  // Status pill: red strictly for overdue; amber for due; neutral for later.
  const statusInfo =
    status.kind === 'overdue'  ? { bg: '#f6e3dd', fg: '#9c4a2f', label: `Overdue ${status.days}d` } :
    status.kind === 'due_now'  ? { bg: '#fdf0dd', fg: '#9a6320', label: 'Due now' } :
    status.kind === 'upcoming' && status.days <= 7 ? { bg: '#fdf0dd', fg: '#9a6320', label: `In ${status.days}d` } :
    status.kind === 'upcoming' ? { bg: 'var(--paper-deep, #ede5d4)', fg: 'var(--ink-soft, #6a6055)', label: `In ${status.days}d` } :
                                  { bg: 'var(--paper-deep, #ede5d4)', fg: 'var(--muted, #8a8378)', label: 'Not started' };
  const isOverdueCard = status.kind === 'overdue';
  const needsAction = status.kind === 'overdue' || status.kind === 'due_now';

  const nUnit = nutrientLabel(settings.bagFertUnit);
  const cv = (kgHa: number) => Math.round(displayNutrient(kgHa, settings.bagFertUnit).value);
  const recommendedNView = { value: cv(cadenceKgN), unit: nUnit };
  const totalNKg = cadenceKgN * f.ha;

  const nCapHeadroom = nCap - seasonNApplied;
  const nearCap = nCapHeadroom < 50;
  const overCap = seasonNApplied > nCap;

  return (
    <div className="card report-field-card" style={{ padding: 14, marginBottom: 10, ...(isOverdueCard ? { borderLeft: '3px solid var(--red, #b85b3a)' } : {}) }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{f.name}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {fmt(area.value, 1)} {area.unit}
            {groupName && <> · {groupName}</>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <span style={{
            fontSize: 11.5, fontWeight: 700, color: statusInfo.fg, background: statusInfo.bg,
            padding: '3px 10px', borderRadius: 99, whiteSpace: 'nowrap',
          }}>
            {statusInfo.label}
          </span>
          {needsAction && (
            <Link
              href={`/fields/${f.id}/log?from=/reports/grazing`}
              className="btn-primary"
              style={{ fontSize: 12, padding: '6px 14px', textDecoration: 'none', display: 'inline-block' }}
            >
              Log N
            </Link>
          )}
        </div>
      </div>

      {/* Last N application */}
      {showLastApp && (
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
      )}

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
