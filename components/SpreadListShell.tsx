'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, Map as MapIcon } from 'lucide-react';
import { FertPlanRow, PlanState, planField } from '@/lib/fertplan';
import { nutrientPerArea } from '@/lib/rules';
import { Product } from '@/lib/types';

const SLURRY = '#1D9E75';
const FOREST = 'var(--forest, #5a7a3a)';
const MUTED = 'var(--muted)';

const DEFAULT_STATE: PlanState = {
  defaultOrganicId: '',
  defaultRate: '',
  overrides: {},
  excludedProductIds: [],
  excludedFieldIds: [],
  slurryOffFieldIds: [],
};

export function SpreadListShell({
  rows, products, unitSystem, slurryUnit, mode, fromHref, groupName, group,
  minSpreadP2O5KgPerHa, minSpreadK2OKgPerHa,
}: {
  rows: FertPlanRow[];
  products: Product[];
  unitSystem: 'acres' | 'hectares';
  slurryUnit: 'gal/ac' | 'm3/ha';
  mode: 'granular' | 'slurry';
  fromHref: string;
  groupName: string | null;
  group: string | null;
  minSpreadP2O5KgPerHa: number;
  minSpreadK2OKgPerHa: number;
}) {
  const [state, setState] = useState<PlanState>(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);

  // Pull the plan toggles/overrides saved by the fert plan (persisted).
  useEffect(() => {
    try {
      const raw = localStorage.getItem('swardly_plan_state');
      if (raw) setState({ ...DEFAULT_STATE, ...JSON.parse(raw) });
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  const organics = useMemo(
    () => products.filter((p) => p.type === 'slurry' || p.type === 'solid_manure'),
    [products],
  );
  const granular = useMemo(() => products.filter((p) => p.type === 'bag_fert'), [products]);

  const sys = unitSystem === 'acres' ? 'acres' : 'hectares';
  const nUnit = sys === 'acres' ? 'kg/ac' : 'kg/ha';
  const disp = (kgHa: number) => Math.round(nutrientPerArea(kgHa, sys));

  // Plan every field that's still on the list.
  const planned = useMemo(() => {
    return rows
      .filter((r) => !state.excludedFieldIds.includes(r.id))
      .map((r) => planField(r, state, organics, granular, {
        slurryUnit, unitSystem, minSpreadP2O5KgPerHa, minSpreadK2OKgPerHa,
      }))
      .sort((a, b) => a.row.name.localeCompare(b.row.name));
  }, [rows, state, organics, granular, slurryUnit, unitSystem, minSpreadP2O5KgPerHa, minSpreadK2OKgPerHa]);

  // Granular: per-field products + product order totals.
  const granularFields = useMemo(
    () => planned.filter((p) => p.planProducts.length > 0),
    [planned],
  );
  const productTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of granularFields) {
      for (const pp of p.planProducts) {
        totals.set(pp.productName, (totals.get(pp.productName) ?? 0) + pp.totalKg);
      }
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [granularFields]);

  // Slurry: per-field volume + rate.
  const slurryFields = useMemo(
    () => planned.filter((p) => p.slurryTotal > 0 && p.organicName),
    [planned],
  );
  const slurryByProduct = useMemo(() => {
    const totals = new Map<string, { vol: number; unit: string }>();
    for (const p of slurryFields) {
      const key = `${p.organicName}|${p.organicUnit}`;
      const cur = totals.get(key) ?? { vol: 0, unit: p.organicUnit };
      cur.vol += p.slurryTotal;
      totals.set(key, cur);
    }
    return [...totals.entries()];
  }, [slurryFields]);

  const isSlurry = mode === 'slurry';
  const accent = isSlurry ? SLURRY : FOREST;
  const title = isSlurry ? 'Slurry spread list' : 'Granular spread list';
  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div style={{ paddingBottom: 60 }}>
      {/* Hero */}
      <div style={{ background: accent, padding: '16px 16px 18px', color: '#fff' }} className="no-print">
        <Link href={fromHref} className="hero-back" style={{ color: 'rgba(255,255,255,0.9)' }}>
          <ArrowLeft size={15} /> Back to plan
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 3px' }}>{title}</h1>
        <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.85)', margin: 0 }}>
          {groupName ? `${groupName} · ` : ''}{isSlurry ? 'Intended slurry / digestate by field' : 'Granular fertiliser by field'} · {dateStr}
        </p>
      </div>

      <div style={{ padding: '14px 16px' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
          <Link
            href={`/reports/spread-map?mode=${mode}${group ? `&group=${encodeURIComponent(group)}` : ''}&from=${encodeURIComponent(`/reports/spread-list?mode=${mode}${group ? `&group=${encodeURIComponent(group)}` : ''}&from=${encodeURIComponent(fromHref)}`)}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 13px', fontSize: 13, fontWeight: 700, color: 'var(--ink-soft)', textDecoration: 'none' }}
          >
            <MapIcon size={15} /> Map sheet
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 13px', fontSize: 13, fontWeight: 700, color: 'var(--ink-soft)', cursor: 'pointer' }}
          >
            <Printer size={15} /> Print / save PDF
          </button>
        </div>

        {!loaded ? (
          <div style={{ fontSize: 13, color: MUTED, textAlign: 'center', padding: 20 }}>Loading…</div>
        ) : isSlurry ? (
          slurryFields.length === 0 ? (
            <EmptyState text="No slurry planned. Set an intended slurry rate on the fertiliser plan, then compile this list." />
          ) : (
            <>
              {/* Slurry totals by product */}
              <div className="card" style={{ padding: 13, marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>Total slurry to spread</div>
                {slurryByProduct.map(([key, v]) => {
                  const [name, unit] = key.split('|');
                  return (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
                      <span style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>{name}</span>
                      <span className="nutrient-num" style={{ fontSize: 15, color: 'var(--ink)' }}>
                        {fmtNum(Math.round(v.vol))} <span style={{ fontSize: 11, color: MUTED }}>{v.unit.replace('/ac', '').replace('/ha', '')}</span>
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--paper, #f7f3ea)', color: MUTED, fontSize: 10, textTransform: 'uppercase' }}>
                      <td style={{ textAlign: 'left', padding: '8px 10px' }}>Field</td>
                      <td style={{ textAlign: 'left', padding: '8px 6px' }}>Product</td>
                      <td style={{ textAlign: 'right', padding: '8px 6px' }}>Rate</td>
                      <td style={{ textAlign: 'right', padding: '8px 10px' }}>Total</td>
                    </tr>
                  </thead>
                  <tbody>
                    {slurryFields.map((p) => (
                      <tr key={p.row.id} style={{ borderTop: '1px solid var(--line)' }}>
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{p.row.name}</div>
                          <div style={{ fontSize: 10, color: MUTED }}>{p.row.areaValue.toFixed(1)} {p.row.areaUnit}</div>
                        </td>
                        <td style={{ padding: '8px 6px', color: 'var(--ink)' }}>{p.organicName}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {p.rateStr} <span style={{ color: MUTED, fontSize: 10 }}>{p.organicUnit}</span>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--ink)' }}>
                          {fmtNum(p.slurryTotal)} {p.organicUnit.replace('/ac', '').replace('/ha', '')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        ) : (
          granularFields.length === 0 ? (
            <EmptyState text="No granular fertiliser to spread for the selected fields and products." />
          ) : (
            <>
              {/* Product order totals */}
              <div className="card" style={{ padding: 13, marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>Total to order</div>
                {productTotals.map(([name, kg]) => (
                  <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
                    <span style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>{name}</span>
                    <span className="nutrient-num" style={{ fontSize: 15, color: 'var(--ink)' }}>
                      {fmtNum(Math.round(kg))} <span style={{ fontSize: 11, color: MUTED }}>kg · {(kg / 1000).toFixed(2)} t</span>
                    </span>
                  </div>
                ))}
              </div>

              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--paper, #f7f3ea)', color: MUTED, fontSize: 10, textTransform: 'uppercase' }}>
                      <td style={{ textAlign: 'left', padding: '8px 10px' }}>Field</td>
                      <td style={{ textAlign: 'left', padding: '8px 6px' }}>Product</td>
                      <td style={{ textAlign: 'right', padding: '8px 6px' }}>{nUnit}</td>
                      <td style={{ textAlign: 'right', padding: '8px 10px' }}>Total kg</td>
                    </tr>
                  </thead>
                  <tbody>
                    {granularFields.map((p) => (
                      p.planProducts.map((pp, i) => (
                        <tr key={p.row.id + pp.productId} style={{ borderTop: i === 0 ? '1px solid var(--line)' : '1px solid var(--line-soft, #eee)' }}>
                          <td style={{ padding: '8px 10px' }}>
                            {i === 0 && (
                              <>
                                <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{p.row.name}</div>
                                <div style={{ fontSize: 10, color: MUTED }}>{p.row.areaValue.toFixed(1)} {p.row.areaUnit}</div>
                              </>
                            )}
                          </td>
                          <td style={{ padding: '8px 6px', color: 'var(--ink)' }}>{pp.productName}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{disp(pp.rateKgPerHa)}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--ink)' }}>{fmtNum(pp.totalKg)}</td>
                        </tr>
                      ))
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}

        <p style={{ fontSize: 11, color: MUTED, lineHeight: 1.5, marginTop: 14 }} className="no-print">
          Compiled from your fertiliser plan with the fields and products you left switched on.
          Switched-off products and fields taken off the list don&apos;t appear here. Go back to the plan to adjust.
        </p>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff; }
        }
      `}</style>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ fontSize: 13, color: MUTED, textAlign: 'center', padding: '28px 20px' }}>{text}</div>;
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-GB');
}
