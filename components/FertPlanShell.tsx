'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { fmt } from '@/lib/rules';

export interface FertPlanRow {
  id: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  areaValue: number;
  areaUnit: string;
  ha: number;
  sampled: boolean;
  pBand: number;
  kBandLabel: string;
  cutType: string;
  cutNumber: number;
  p2o5ToApply: number;
  k2oToApply: number;
  plan: {
    products: { productId: number; productName: string; rateKgPerHa: number; totalKg: number }[];
    note: string;
    p2o5Balance: number;
    k2oBalance: number;
  } | null;
}

export function FertPlanShell({
  rows, groups, initialGroup, unitSystem,
}: {
  rows: FertPlanRow[];
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
    // Fields that need something first, then sorted by name.
    return [...list].sort((a, b) => {
      const an = a.plan && a.plan.products.length > 0 ? 0 : 1;
      const bn = b.plan && b.plan.products.length > 0 ? 0 : 1;
      if (an !== bn) return an - bn;
      return a.name.localeCompare(b.name);
    });
  }, [rows, groupFilter]);

  // Product order totals across the visible set — how much of each to buy.
  const productTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of visible) {
      if (!r.plan) continue;
      for (const p of r.plan.products) {
        totals.set(p.productName, (totals.get(p.productName) ?? 0) + p.totalKg);
      }
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [visible]);

  const needCount = visible.filter((r) => r.plan && r.plan.products.length > 0).length;
  const anyUngrouped = rows.some((r) => !r.groupId);
  const chips = [
    { v: 'all', label: 'All' },
    ...groups.map((g) => ({ v: g.id, label: g.name })),
    ...(anyUngrouped ? [{ v: 'ungrouped', label: 'Ungrouped' }] : []),
  ];

  return (
    <div style={{ padding: '14px 16px' }}>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginTop: 0, marginBottom: 14 }}>
        Suggested granular fertiliser and rate to meet each field&apos;s RB209 P &amp; K shortfall.
        Rates are a starting point — adjust to your own products and judgement.
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

      {/* Product order totals */}
      {productTotals.length > 0 && (
        <div className="card" style={{ padding: 13, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
            Total product to order
          </div>
          {productTotals.map(([name, kg]) => (
            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
              <span style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>{name}</span>
              <span className="nutrient-num" style={{ fontSize: 15, color: 'var(--ink)' }}>
                {fmt(Math.round(kg))} <span style={{ fontSize: 11, color: 'var(--muted)' }}>kg</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}> · {(kg / 1000).toFixed(2)} t</span>
              </span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
            across {needCount} field{needCount === 1 ? '' : 's'} needing fertiliser
          </div>
        </div>
      )}

      {visible.length === 0 && (
        <div className="card" style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          No fields to show.
        </div>
      )}

      {visible.map((row) => {
        const nothingNeeded = !row.plan || row.plan.products.length === 0;
        const cutLabel = row.cutType === 'grazing' ? 'grazing'
          : row.cutType === 'bales' ? `cut ${row.cutNumber} (bales)`
          : `cut ${row.cutNumber}`;
        return (
          <Link
            key={row.id}
            href={`/fields/${row.id}?from=/reports/fert-plan`}
            className="card"
            style={{ display: 'block', padding: 13, marginBottom: 8, textDecoration: 'none', color: 'inherit' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: nothingNeeded ? 0 : 9 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{row.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                  {fmt(row.areaValue, 1)} {row.areaUnit}
                  {row.groupName && <> · {row.groupName}</>}
                  {' · '}{cutLabel}
                  {' · '}P idx {row.pBand} · K {row.kBandLabel}
                </div>
              </div>
              {nothingNeeded && (
                <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: 'var(--forest-dark)', background: 'var(--forest-soft)', padding: '4px 9px', borderRadius: 6 }}>
                  ✓ at target
                </span>
              )}
            </div>

            {!nothingNeeded && row.plan && (
              <>
                {!row.sampled && (
                  <div style={{ fontSize: 11, color: '#7A5B12', marginBottom: 7 }}>
                    No soil sample — plan assumes target index.
                  </div>
                )}
                {row.plan.products.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: 'var(--paper-deep, #f3efe4)', borderRadius: 8, padding: '9px 11px',
                      marginBottom: 6,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{p.productName}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmt(p.totalKg)} kg over field</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="nutrient-num" style={{ fontSize: 18, color: 'var(--ink)' }}>{p.rateKgPerHa}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>kg/ha</div>
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginTop: 2 }}>
                  Need P {row.p2o5ToApply} · K {row.k2oToApply} kg/ha.
                  {(row.plan.p2o5Balance !== 0 || row.plan.k2oBalance !== 0) && (
                    <>
                      {' '}This plan{row.plan.p2o5Balance !== 0 && ` ${row.plan.p2o5Balance > 0 ? 'over' : 'under'} P by ${Math.abs(row.plan.p2o5Balance)}`}
                      {row.plan.p2o5Balance !== 0 && row.plan.k2oBalance !== 0 && ','}
                      {row.plan.k2oBalance !== 0 && ` ${row.plan.k2oBalance > 0 ? 'over' : 'under'} K by ${Math.abs(row.plan.k2oBalance)}`} kg/ha.
                    </>
                  )}
                </div>
              </>
            )}
          </Link>
        );
      })}

      <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginTop: 14 }}>
        Plans use your granular fertiliser products to meet RB209 Section 3 (June 2023) P &amp; K
        recommendations at each field&apos;s soil index, after deducting what&apos;s already been
        applied this season. Where a compound&apos;s ratio doesn&apos;t fit, straight P and K products
        are suggested. Always sense-check rates and consult a FACTS adviser where needed.
      </p>
    </div>
  );
}
