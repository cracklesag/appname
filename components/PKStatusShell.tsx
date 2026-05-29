'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { fmt } from '@/lib/rules';

export interface PKFieldRow {
  id: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  areaValue: number;
  areaUnit: string;
  sampled: boolean;
  pIdx: number | null;
  kIdx: number | null;
  pBand: number;
  kBandLabel: string;
  cutType: string;
  cutNumber: number;
  p2o5ToApply: number;
  k2oToApply: number;
  recP2o5: number;
  recK2o: number;
  appliedP: number;
  appliedK: number;
  atMaintenance: boolean;
  kSplit: { previousAutumn: number; spring: number; springCapped: boolean } | null;
  extraKAfterCut: number;
}

type Severity = 'do_now' | 'soon' | 'can_wait';

/** Combined P+K severity for a field: driven by the larger relative shortfall,
 *  amplified when the soil index is below target (building reserves matters more). */
function severityFor(row: PKFieldRow): { sev: Severity; score: number } {
  const totalToApply = row.p2o5ToApply + row.k2oToApply;
  // Index amplification: below-target P (band <2) or K (band 0/1) lifts urgency.
  const pBelow = row.pBand < 2;
  const kBelow = row.kBandLabel === '0' || row.kBandLabel === '1';
  const amp = (pBelow ? 1.3 : 1) * (kBelow ? 1.3 : 1);
  const score = totalToApply * amp;

  let sev: Severity;
  if (totalToApply <= 0) sev = 'can_wait';
  else if (score >= 100 || pBelow || kBelow) sev = 'do_now';
  else if (score >= 40) sev = 'soon';
  else sev = 'can_wait';
  return { sev, score };
}

const SEV_META: Record<Severity, { label: string; color: string; bg: string; order: number }> = {
  do_now:   { label: 'Do now',   color: '#8A3B27', bg: '#FBEAE6', order: 0 },
  soon:     { label: 'Soon',     color: '#7A5B12', bg: '#FBF3DC', order: 1 },
  can_wait: { label: 'Can wait', color: 'var(--forest-dark)', bg: 'var(--forest-soft)', order: 2 },
};

export function PKStatusShell({
  rows, groups, initialGroup, unitSystem,
}: {
  rows: PKFieldRow[];
  groups: { id: string; name: string }[];
  initialGroup: string;
  unitSystem: string;
}) {
  const [groupFilter, setGroupFilter] = useState(initialGroup);

  const visible = useMemo(() => {
    let list = rows;
    if (groupFilter !== 'all') {
      list = groupFilter === 'ungrouped'
        ? rows.filter((r) => !r.groupId)
        : rows.filter((r) => r.groupId === groupFilter);
    }
    return list
      .map((r) => ({ row: r, ...severityFor(r) }))
      .sort((a, b) => {
        const so = SEV_META[a.sev].order - SEV_META[b.sev].order;
        if (so !== 0) return so;
        return b.score - a.score;
      });
  }, [rows, groupFilter]);

  // Totals across the visible set, scaled by field area (kg of actual product nutrient).
  const totals = useMemo(() => {
    let pKg = 0, kKg = 0;
    for (const { row } of visible) {
      const ha = unitSystem === 'acres' ? row.areaValue / 2.4711 : row.areaValue;
      pKg += row.p2o5ToApply * ha;
      kKg += row.k2oToApply * ha;
    }
    return { pKg: Math.round(pKg), kKg: Math.round(kKg) };
  }, [visible, unitSystem]);

  const anyUngrouped = rows.some((r) => !r.groupId);
  const chips = [
    { v: 'all', label: 'All' },
    ...groups.map((g) => ({ v: g.id, label: g.name })),
    ...(anyUngrouped ? [{ v: 'ungrouped', label: 'Ungrouped' }] : []),
  ];

  return (
    <div style={{ padding: '14px 16px' }}>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginTop: 0, marginBottom: 14 }}>
        RB209 phosphate &amp; potash still to apply this season, after deducting what&apos;s already gone on.
        Sorted by urgency — fields below their target index come first.
      </p>

      {/* Group filter */}
      {groups.length > 0 && (
        <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 4, marginBottom: 12 }}>
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

      {/* Totals strip */}
      <div className="card" style={{ padding: 12, marginBottom: 14, display: 'flex', gap: 18 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>P₂O₅ to apply</div>
          <div className="nutrient-num" style={{ fontSize: 20, color: 'var(--ink)' }}>{fmt(totals.pKg)} <span style={{ fontSize: 12, color: 'var(--muted)' }}>kg</span></div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>K₂O to apply</div>
          <div className="nutrient-num" style={{ fontSize: 20, color: 'var(--ink)' }}>{fmt(totals.kKg)} <span style={{ fontSize: 12, color: 'var(--muted)' }}>kg</span></div>
        </div>
        <div style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
          across {visible.length} field{visible.length === 1 ? '' : 's'}
        </div>
      </div>

      {visible.length === 0 && (
        <div className="card" style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          No fields to show.
        </div>
      )}

      {visible.map(({ row, sev }) => {
        const meta = SEV_META[sev];
        const cutLabel = row.cutType === 'grazing' ? 'grazing'
          : row.cutType === 'bales' ? `cut ${row.cutNumber} (bales)`
          : `cut ${row.cutNumber}`;
        return (
          <Link
            key={row.id}
            href={`/fields/${row.id}?from=/reports/pk`}
            className="card"
            style={{ display: 'block', padding: 13, marginBottom: 8, textDecoration: 'none', color: 'inherit' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{row.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                  {fmt(row.areaValue, 1)} {row.areaUnit}
                  {row.groupName && <> · {row.groupName}</>}
                  {' · '}{cutLabel}
                </div>
              </div>
              <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: meta.color, background: meta.bg, padding: '4px 9px', borderRadius: 6 }}>
                {meta.label}
              </span>
            </div>

            {!row.sampled && (
              <div style={{ fontSize: 11, color: 'var(--amber, #7A5B12)', marginBottom: 6 }}>
                No soil sample — recommendation assumes target index.
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              {/* P */}
              <div style={{ flex: 1, background: 'var(--paper-deep, #f3efe4)', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>P₂O₅ · index {row.pBand}</div>
                <div className="nutrient-num" style={{ fontSize: 18, color: row.p2o5ToApply > 0 ? 'var(--ink)' : 'var(--muted)' }}>
                  {row.p2o5ToApply > 0 ? `${row.p2o5ToApply}` : '✓'} <span style={{ fontSize: 11, color: 'var(--muted)' }}>{row.p2o5ToApply > 0 ? 'kg/ha' : 'met'}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                  need {row.recP2o5} · applied {row.appliedP}
                </div>
              </div>
              {/* K */}
              <div style={{ flex: 1, background: 'var(--paper-deep, #f3efe4)', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>K₂O · index {row.kBandLabel}</div>
                <div className="nutrient-num" style={{ fontSize: 18, color: row.k2oToApply > 0 ? 'var(--ink)' : 'var(--muted)' }}>
                  {row.k2oToApply > 0 ? `${row.k2oToApply}` : '✓'} <span style={{ fontSize: 11, color: 'var(--muted)' }}>{row.k2oToApply > 0 ? 'kg/ha' : 'met'}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                  need {row.recK2o} · applied {row.appliedK}
                </div>
              </div>
            </div>

            {/* First-cut K split + catch-up hints */}
            {(row.kSplit || row.extraKAfterCut > 0) && (
              <div style={{ marginTop: 7, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                {row.kSplit && (
                  <div>
                    K timing: {row.kSplit.previousAutumn} kg/ha previous autumn, {row.kSplit.spring} kg/ha spring
                    {row.kSplit.springCapped && ' (spring capped at 80 — balance to autumn)'}
                  </div>
                )}
                {row.extraKAfterCut > 0 && (
                  <div>+{row.extraKAfterCut} kg/ha K₂O catch-up after cutting (soil K at/below 2+)</div>
                )}
              </div>
            )}
          </Link>
        );
      })}

      <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginTop: 14 }}>
        Figures are RB209 Section 3 (June 2023) recommendations at each field&apos;s soil index, less what&apos;s
        already been applied this season. Nutrients in slurry/manure already logged are counted. Always
        cross-check against your own plan and a FACTS adviser where needed.
      </p>
    </div>
  );
}
