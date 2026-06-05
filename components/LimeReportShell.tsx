'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, Layers, AlertTriangle } from 'lucide-react';

export interface LimeRow {
  id: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  areaValue: number;
  areaUnit: 'ac' | 'ha';
  ha: number;
  sampled: boolean;
  sampleDate: string | null;
  limeSinceSample: boolean;
  limeSinceDate: string | null;
  ph: number | null;
  mgIdx: number | null;
  targetPh: number;
  needsLime: boolean;
  totalRate: number;          // t/ac or t/ha (per user unit)
  dressingRates: number[];    // split dressings, same unit
  totalProductT: number;      // tonnes over the whole field
  limeType: 'magnesian' | 'calcium';
  note: string | null;
}

type SortKey = 'urgency' | 'name' | 'ph';

const RED = 'var(--red, #b85b3a)';
const AMBER = 'var(--amber, #c98a2b)';
const GREEN = 'var(--forest, #5a7a3a)';
const MUTED = 'var(--muted)';

/** Short, readable date (e.g. "14 Mar 2025") from an ISO/date string. */
function fmtDate(d: string | null): string {
  if (!d) return '';
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Severity for sorting/colour: how far below target. */
function severity(r: LimeRow): { sev: number; color: string; label: string } {
  if (r.ph == null) return { sev: 1, color: MUTED, label: 'No sample' };
  if (!r.needsLime) return { sev: 0, color: GREEN, label: r.ph >= 7 ? 'High pH' : 'At target' };
  const gap = r.targetPh - r.ph;
  if (gap >= 0.6) return { sev: 3, color: RED, label: 'Low' };
  return { sev: 2, color: AMBER, label: 'Slightly low' };
}

/** pH heat bar: scale 4.5–7.5, target tick, colour by severity. */
function PhBar({ ph, target }: { ph: number | null; target: number }) {
  const MIN = 4.5, MAX = 7.5;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - MIN) / (MAX - MIN)) * 100))}%`;
  let fill = MUTED;
  if (ph != null) {
    if (ph >= target) fill = GREEN;
    else if (ph >= target - 0.5) fill = AMBER;
    else fill = RED;
  }
  return (
    <div style={{ position: 'relative', height: 9, background: 'var(--line-soft, #e8e4da)', borderRadius: 5, overflow: 'hidden' }}>
      {ph != null && <div style={{ position: 'absolute', inset: 0, width: pos(ph), background: fill, borderRadius: 5 }} />}
      <div style={{ position: 'absolute', top: -2, bottom: -2, left: pos(target), width: 2, background: 'var(--ink, #2c2c2a)' }} />
    </div>
  );
}

function TypePill({ type }: { type: 'magnesian' | 'calcium' }) {
  const mag = type === 'magnesian';
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
      background: mag ? '#E7EEF6' : '#EFEBE0',
      color: mag ? '#2C5A86' : '#6B5D34',
    }}>
      {mag ? 'Magnesian lime' : 'Calcium lime'}
    </span>
  );
}

export function LimeReportShell({
  rows, groups, initialGroup, rateUnit, targetPhDefault, fromHref,
}: {
  rows: LimeRow[];
  groups: { id: string; name: string }[];
  initialGroup: string;
  rateUnit: string;
  targetPhDefault: number;
  fromHref: string;
}) {
  const [groupFilter, setGroupFilter] = useState(initialGroup);
  const [sortKey, setSortKey] = useState<SortKey>('urgency');
  const [exportMode, setExportMode] = useState(false);

  const visible = useMemo(() => {
    let list = rows;
    if (groupFilter !== 'all') {
      list = groupFilter === 'ungrouped'
        ? rows.filter((r) => !r.groupId)
        : rows.filter((r) => r.groupId === groupFilter);
    }
    const withSev = list.map((r) => ({ row: r, ...severity(r) }));
    return withSev.sort((a, b) => {
      if (sortKey === 'name') return a.row.name.localeCompare(b.row.name);
      if (sortKey === 'ph') {
        const ap = a.row.ph ?? 99, bp = b.row.ph ?? 99;
        return ap - bp;
      }
      // urgency: most severe first, then biggest gap
      if (b.sev !== a.sev) return b.sev - a.sev;
      const ag = a.row.ph != null ? a.row.targetPh - a.row.ph : -99;
      const bg = b.row.ph != null ? b.row.targetPh - b.row.ph : -99;
      return bg - ag;
    });
  }, [rows, groupFilter, sortKey]);

  // Overview totals across the visible set.
  const overview = useMemo(() => {
    const need = visible.filter((v) => v.row.needsLime);
    const mag = need.filter((v) => v.row.limeType === 'magnesian');
    const cal = need.filter((v) => v.row.limeType === 'calcium');
    const sumT = (arr: typeof need) => Math.round(arr.reduce((s, v) => s + v.row.totalProductT, 0) * 10) / 10;
    return {
      needCount: need.length,
      total: visible.length,
      magT: sumT(mag),
      calT: sumT(cal),
      allT: sumT(need),
      splits: need.filter((v) => v.row.dressingRates.length > 1).length,
    };
  }, [visible]);

  const anyUngrouped = rows.some((r) => !r.groupId);
  const chips = [
    { v: 'all', label: 'All' },
    ...groups.map((g) => ({ v: g.id, label: g.name })),
    ...(anyUngrouped ? [{ v: 'ungrouped', label: 'Ungrouped' }] : []),
  ];

  return (
    <div>
      {/* Branded hero */}
      <div style={{ background: 'linear-gradient(135deg, #3d5b29 0%, #2c4220 100%)', color: 'var(--brand-cream, #efe7d6)', padding: '18px 16px 20px' }}>
        <Link href={fromHref} className="hero-back" style={{ color: 'rgba(239,231,214,0.85)' }}>
          <ArrowLeft size={15} /> Back
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 3px' }}>Lime status</h1>
        <p style={{ fontSize: 12.5, color: 'rgba(239,231,214,0.8)', margin: 0, lineHeight: 1.5 }}>
          Grassland liming — fields below target pH, with magnesian or calcium lime by soil magnesium.
        </p>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {/* Overview summary */}
        <div className="card" style={{ padding: 14, marginBottom: 14, background: 'var(--card)' }}>
          {overview.needCount === 0 ? (
            <div style={{ fontSize: 13, color: GREEN, fontWeight: 600 }}>
              All sampled fields are at or above target pH — no lime needed.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 700, marginBottom: 8 }}>
                {overview.needCount} of {overview.total} field{overview.total === 1 ? '' : 's'} need lime
                {overview.splits > 0 && <span style={{ fontWeight: 400, color: MUTED }}> · {overview.splits} need a split dressing</span>}
              </div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                {overview.magT > 0 && (
                  <div>
                    <div className="nutrient-num" style={{ fontSize: 20, fontWeight: 800, color: '#2C5A86' }}>{overview.magT} t</div>
                    <div style={{ fontSize: 11, color: MUTED }}>magnesian lime</div>
                  </div>
                )}
                {overview.calT > 0 && (
                  <div>
                    <div className="nutrient-num" style={{ fontSize: 20, fontWeight: 800, color: '#6B5D34' }}>{overview.calT} t</div>
                    <div style={{ fontSize: 11, color: MUTED }}>calcium lime</div>
                  </div>
                )}
                <div>
                  <div className="nutrient-num" style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)' }}>{overview.allT} t</div>
                  <div style={{ fontSize: 11, color: MUTED }}>total to order</div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="select"
            style={{ fontSize: 12, padding: '6px 8px', flex: 1, maxWidth: 160 }}
          >
            <option value="urgency">Sort: most urgent</option>
            <option value="ph">Sort: lowest pH</option>
            <option value="name">Sort: name</option>
          </select>
          <button
            type="button"
            onClick={() => setExportMode((v) => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
              background: exportMode ? 'var(--forest)' : 'var(--card)',
              color: exportMode ? 'var(--paper)' : 'var(--ink-soft)',
              border: exportMode ? 'none' : '1px solid var(--line)', borderRadius: 8,
              padding: '7px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {exportMode ? <Layers size={14} /> : <Printer size={14} />}
            {exportMode ? 'Detail view' : 'Export list'}
          </button>
        </div>

        {/* Group filter */}
        {groups.length > 0 && (
          <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 4, marginBottom: 14 }}>
            {chips.map((c) => {
              const active = groupFilter === c.v;
              return (
                <button
                  key={c.v}
                  type="button"
                  onClick={() => setGroupFilter(c.v)}
                  style={{
                    flexShrink: 0, background: active ? 'var(--forest)' : 'var(--card)',
                    color: active ? 'var(--paper)' : 'var(--ink-soft)',
                    border: active ? 'none' : '1px solid var(--line)', borderRadius: 20,
                    padding: '6px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        )}

        {exportMode ? (
          <ExportTable visible={visible} rateUnit={rateUnit} />
        ) : (
          visible.map(({ row, color, label }) => (
            <div key={row.id} className="card" style={{ padding: 13, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{row.name}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>
                    {row.areaValue.toFixed(1)} {row.areaUnit}
                    {row.groupName && <> · {row.groupName}</>}
                  </div>
                </div>
                <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color, background: 'var(--card)', border: `1px solid ${color}`, padding: '3px 9px', borderRadius: 6 }}>
                  {label}
                </span>
              </div>

              {/* pH bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, width: 22, flexShrink: 0 }}>pH</span>
                <div style={{ flex: 1 }}><PhBar ph={row.ph} target={row.targetPh} /></div>
                <span className="nutrient-num" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', width: 30, textAlign: 'right' }}>
                  {row.ph != null ? row.ph.toFixed(1) : '—'}
                </span>
              </div>
              <div style={{ fontSize: 10, color: MUTED, marginBottom: row.needsLime ? 9 : 0, paddingLeft: 30 }}>
                target {row.targetPh.toFixed(1)}
                {row.mgIdx != null && <> · Mg index {row.mgIdx.toFixed(1)}</>}
                {' · '}
                {row.sampleDate ? `sampled ${fmtDate(row.sampleDate)}` : (row.sampled ? 'sample date not recorded' : 'not sampled')}
              </div>

              {row.limeSinceSample && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 6,
                  background: '#FBF1D9', border: '1px solid #E8D08A', borderRadius: 8,
                  padding: '7px 9px', marginBottom: row.needsLime ? 9 : 0, marginTop: 2,
                }}>
                  <AlertTriangle size={13} style={{ color: '#9A7B16', flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 11, color: '#6B5616', lineHeight: 1.45 }}>
                    Lime spread {fmtDate(row.limeSinceDate)} — after this sample. The pH above predates it, so this field may now be closer to target than shown. Re-sample before liming again.
                  </span>
                </div>
              )}

              {row.needsLime ? (
                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 9, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div>
                    <TypePill type={row.limeType} />
                    {row.dressingRates.length > 1 && (
                      <div style={{ fontSize: 11, color: MUTED, marginTop: 5 }}>
                        Split: {row.dressingRates.map((d, i) => `${d} ${rateUnit}${i === 0 ? ' now' : ' yr ' + (i + 1)}`).join(' + ')}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="nutrient-num" style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)' }}>{row.totalRate}</div>
                    <div style={{ fontSize: 11, color: MUTED }}>{rateUnit} · {row.totalProductT} t total</div>
                  </div>
                </div>
              ) : (
                row.note && <div style={{ fontSize: 11, color: MUTED, fontStyle: 'italic' }}>{row.note}</div>
              )}
            </div>
          ))
        )}

        <p style={{ fontSize: 11, color: MUTED, lineHeight: 1.5, marginTop: 14 }}>
          Grassland liming for a 15 cm soil depth, ground limestone (NV 50–55). Rate =
          (target − measured pH) × soil liming factor. Grassland is capped at 7.5 t/ha per dressing,
          so larger requirements split across years. Magnesian (dolomitic) lime is recommended where
          soil magnesium is Index 0–1; calcium lime otherwise. Fields above pH 7 aren&apos;t limed
          (trace-element lock-up). An estimate — sense-check against a current soil report and adjust
          for stony ground.
        </p>
      </div>
    </div>
  );
}

/** Field-by-field export/print table — quantities + split dressings. */
function ExportTable({
  visible, rateUnit,
}: {
  visible: { row: LimeRow }[];
  rateUnit: string;
}) {
  const need = visible.filter((v) => v.row.needsLime);
  if (need.length === 0) {
    return <div style={{ fontSize: 13, color: MUTED, textAlign: 'center', padding: 20 }}>No fields need lime in this selection.</div>;
  }
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--paper, #f7f3ea)', color: MUTED, fontSize: 10, textTransform: 'uppercase' }}>
            <td style={{ textAlign: 'left', padding: '8px 10px' }}>Field</td>
            <td style={{ textAlign: 'left', padding: '8px 6px' }}>Lime</td>
            <td style={{ textAlign: 'right', padding: '8px 6px' }}>{rateUnit}</td>
            <td style={{ textAlign: 'right', padding: '8px 10px' }}>Total t</td>
          </tr>
        </thead>
        <tbody>
          {need.map(({ row }) => (
            <tr key={row.id} style={{ borderTop: '1px solid var(--line)' }}>
              <td style={{ padding: '8px 10px' }}>
                <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{row.name}</div>
                <div style={{ fontSize: 10, color: MUTED }}>
                  {row.areaValue.toFixed(1)} {row.areaUnit}
                  {row.dressingRates.length > 1 && (
                    <> · split: {row.dressingRates.map((d, i) => `${d}${i === 0 ? ' now' : ' yr' + (i + 1)}`).join(' + ')}</>
                  )}
                </div>
              </td>
              <td style={{ padding: '8px 6px', fontSize: 11, color: row.limeType === 'magnesian' ? '#2C5A86' : '#6B5D34', fontWeight: 600 }}>
                {row.limeType === 'magnesian' ? 'Mag' : 'Cal'}
              </td>
              <td style={{ padding: '8px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}>{row.totalRate}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--ink)' }}>{row.totalProductT}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
