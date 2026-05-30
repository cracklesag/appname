'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { fmt, calcNutrients, planFieldFertiliser } from '@/lib/rules';
import { SupplyBar } from '@/components/NutrientBar';
import { SoilHeatBar } from '@/components/SoilHeatBar';
import { Product, RateUnit } from '@/lib/types';

export interface FertPlanRow {
  id: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  areaValue: number;
  areaUnit: string;
  ha: number;
  sampled: boolean;
  ph: number | null;
  pIdx: number | null;
  kIdx: number | null;
  pBand: number;
  kBandLabel: string;
  cutType: string;
  cutNumber: number;
  p2o5ToApply: number;
  k2oToApply: number;
  nToApply: number;
  nNeed: number;
  pNeed: number;
  kNeed: number;
  appliedN: number;
  appliedP: number;
  appliedK: number;
}

// Soil targets for the heat bars — RB209 index 2 / pH 6.0 for grassland.
const SOIL_TARGET = { ph: 6.0, pIdx: 2, kIdx: 2 };

export function FertPlanShell({
  rows, groups, initialGroup, unitSystem, products, slurryUnit,
}: {
  rows: FertPlanRow[];
  groups: { id: string; name: string }[];
  initialGroup: string;
  unitSystem: string;
  products: Product[];
  slurryUnit: 'gal/ac' | 'm3/ha';
}) {
  const [groupFilter, setGroupFilter] = useState(initialGroup);

  // Organic sources the user can plan to apply first (slurry / solid / digestate).
  const organics = useMemo(
    () => products.filter((p) => p.type === 'slurry' || p.type === 'solid_manure'),
    [products],
  );
  const granular = useMemo(
    () => products.filter((p) => p.type === 'bag_fert'),
    [products],
  );

  // Planning state: a default organic + default rate applied to all fields,
  // with per-field overrides. Empty = no organic planned.
  const [defaultOrganicId, setDefaultOrganicId] = useState<number | ''>(
    organics.length > 0 ? organics[0].id : '',
  );
  const [defaultRate, setDefaultRate] = useState<string>('');
  // Per-field overrides: fieldId -> { productId, rate } (rate as string).
  const [overrides, setOverrides] = useState<Record<string, { productId: number | ''; rate: string }>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const organicRateUnit: RateUnit = useMemo(() => {
    // Slurry uses the farm's slurry unit; solid manure uses t/ha or t/ac.
    const def = organics.find((o) => o.id === defaultOrganicId);
    if (def?.type === 'solid_manure') return unitSystem === 'acres' ? 't/ac' : 't/ha';
    return slurryUnit;
  }, [organics, defaultOrganicId, slurryUnit, unitSystem]);

  const visible = useMemo(() => {
    let list = rows;
    if (groupFilter !== 'all') {
      list = groupFilter === 'ungrouped'
        ? rows.filter((r) => !r.groupId)
        : rows.filter((r) => r.groupId === groupFilter);
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, groupFilter]);

  // For each field, resolve the planned organic (override or default), compute
  // its N/P/K contribution, subtract from the RB209 shortfall, then plan the
  // granular fertiliser for what's left.
  const computed = useMemo(() => {
    return visible.map((row) => {
      const ov = overrides[row.id];
      const organicId = ov ? ov.productId : defaultOrganicId;
      const rateStr = ov ? ov.rate : defaultRate;
      const rate = parseFloat(rateStr);
      const organic = organics.find((o) => o.id === organicId);

      // Unit depends on the resolved organic's type.
      const unit: RateUnit = organic?.type === 'solid_manure'
        ? (unitSystem === 'acres' ? 't/ac' : 't/ha')
        : slurryUnit;

      let slurryN = 0, slurryP = 0, slurryK = 0;
      if (organic && rate > 0) {
        const n = calcNutrients(organic, rate, unit, new Date().toISOString().slice(0, 10), 'splash_plate');
        slurryN = Math.round(n.nPerHa);
        slurryP = Math.round(n.p2o5PerHa);
        slurryK = Math.round(n.k2oPerHa);
      }

      // Reduce the shortfall by what the slurry delivers (not below zero).
      const pAfter = Math.max(0, row.p2o5ToApply - slurryP);
      const kAfter = Math.max(0, row.k2oToApply - slurryK);
      const nAfter = Math.max(0, row.nToApply - slurryN);

      const plan = planFieldFertiliser(pAfter, kAfter, granular, nAfter);

      // Supply = already applied this season + planned slurry + planned granular.
      let granN = 0, granP = 0, granK = 0;
      const planProducts = plan
        ? plan.products.map((pp) => {
            granN += pp.deliversN; granP += pp.deliversP2O5; granK += pp.deliversK2O;
            return {
              productId: pp.productId,
              productName: pp.productName,
              rateKgPerHa: pp.rateKgPerHa,
              totalKg: Math.round(pp.rateKgPerHa * row.ha),
            };
          })
        : [];

      return {
        row,
        organicId,
        rateStr,
        organicName: organic?.name ?? null,
        organicUnit: unit,
        slurryN, slurryP, slurryK,
        slurryTotal: organic && rate > 0 ? Math.round(rate * row.ha) : 0,
        pAfter, kAfter, nAfter,
        planProducts,
        planNote: plan?.note ?? '',
        supplyN: row.appliedN + slurryN + Math.round(granN),
        supplyP: row.appliedP + slurryP + Math.round(granP),
        supplyK: row.appliedK + slurryK + Math.round(granK),
        nothingGranular: planProducts.length === 0,
      };
    });
  }, [visible, overrides, defaultOrganicId, defaultRate, organics, granular, slurryUnit, unitSystem]);

  // Order totals: granular products + planned organic volume.
  const productTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of computed) {
      for (const p of c.planProducts) {
        totals.set(p.productName, (totals.get(p.productName) ?? 0) + p.totalKg);
      }
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [computed]);

  const organicTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of computed) {
      if (c.organicName && c.slurryTotal > 0) {
        totals.set(`${c.organicName}|${c.organicUnit}`, (totals.get(`${c.organicName}|${c.organicUnit}`) ?? 0) + c.slurryTotal);
      }
    }
    return [...totals.entries()];
  }, [computed]);

  const anyUngrouped = rows.some((r) => !r.groupId);
  const chips = [
    { v: 'all', label: 'All' },
    ...groups.map((g) => ({ v: g.id, label: g.name })),
    ...(anyUngrouped ? [{ v: 'ungrouped', label: 'Ungrouped' }] : []),
  ];

  const setOverride = (id: string, patch: Partial<{ productId: number | ''; rate: string }>) => {
    setOverrides((prev) => {
      const cur = prev[id] ?? { productId: defaultOrganicId, rate: defaultRate };
      return { ...prev, [id]: { ...cur, ...patch } };
    });
  };
  const clearOverride = (id: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  return (
    <div style={{ padding: '14px 16px' }}>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginTop: 0, marginBottom: 14 }}>
        Plan the slurry or digestate you intend to spread, and the granular fertiliser
        updates to cover only what&apos;s left of each field&apos;s RB209 shortfall.
      </p>

      {/* Intended organic planning panel */}
      {organics.length > 0 && (
        <div className="card" style={{ padding: 13, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 9 }}>
            Intended slurry / digestate — all fields
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              className="select"
              value={defaultOrganicId}
              onChange={(e) => setDefaultOrganicId(e.target.value === '' ? '' : Number(e.target.value))}
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value="">None</option>
              {organics.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <input
              type="number"
              inputMode="decimal"
              className="input"
              placeholder="rate"
              value={defaultRate}
              onChange={(e) => setDefaultRate(e.target.value)}
              style={{ width: 84, textAlign: 'right' }}
            />
            <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{organicRateUnit}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 7, lineHeight: 1.4 }}>
            Applied to every field below. Tap a field to set a different rate just for it.
          </div>
        </div>
      )}

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

      {/* Order totals */}
      {(productTotals.length > 0 || organicTotals.length > 0) && (
        <div className="card" style={{ padding: 13, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
            Total to apply
          </div>
          {organicTotals.map(([key, vol]) => {
            const [name, unit] = key.split('|');
            return (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
                <span style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>{name}</span>
                <span className="nutrient-num" style={{ fontSize: 15, color: 'var(--ink)' }}>
                  {fmt(Math.round(vol))} <span style={{ fontSize: 11, color: 'var(--muted)' }}>{unit.replace('/ac', '').replace('/ha', '')}</span>
                </span>
              </div>
            );
          })}
          {productTotals.map(([name, kg]) => (
            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
              <span style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>{name}</span>
              <span className="nutrient-num" style={{ fontSize: 15, color: 'var(--ink)' }}>
                {fmt(Math.round(kg))} <span style={{ fontSize: 11, color: 'var(--muted)' }}>kg</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}> · {(kg / 1000).toFixed(2)} t</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {computed.length === 0 && (
        <div className="card" style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          No fields to show.
        </div>
      )}

      {computed.map((c) => {
        const row = c.row;
        const isOpen = !!expanded[row.id];
        const hasOverride = !!overrides[row.id];
        const cutLabel = row.cutType === 'grazing' ? 'grazing'
          : row.cutType === 'bales' ? `cut ${row.cutNumber} (bales)`
          : `cut ${row.cutNumber}`;
        const atTarget = c.nothingGranular && c.slurryTotal === 0
          && row.p2o5ToApply === 0 && row.k2oToApply === 0 && row.nToApply === 0;

        return (
          <div key={row.id} className="card" style={{ padding: 13, marginBottom: 8 }}>
            <div
              onClick={() => setExpanded((p) => ({ ...p, [row.id]: !p[row.id] }))}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{row.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                  {fmt(row.areaValue, 1)} {row.areaUnit}
                  {row.groupName && <> · {row.groupName}</>}
                  {' · '}{cutLabel}
                </div>
              </div>
              {atTarget && (
                <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: 'var(--forest-dark)', background: 'var(--forest-soft)', padding: '4px 9px', borderRadius: 6 }}>
                  ✓ at target
                </span>
              )}
            </div>

            {/* Soil heat bars */}
            {row.sampled ? (
              <div style={{ marginTop: 9 }}>
                <SoilHeatBar label="pH" value={row.ph} target={SOIL_TARGET.ph} max={7.5} />
                <SoilHeatBar label="P" value={row.pIdx} target={SOIL_TARGET.pIdx} max={4} />
                <SoilHeatBar label="K" value={row.kIdx} target={SOIL_TARGET.kIdx} max={4} />
              </div>
            ) : (
              <div style={{ fontSize: 11, color: '#7A5B12', marginTop: 7 }}>
                No soil sample — plan assumes target index.
              </div>
            )}

            {/* Planned slurry contribution */}
            {c.slurryTotal > 0 && (
              <div style={{ fontSize: 11, color: 'var(--forest-dark)', marginTop: 8, background: 'var(--forest-soft)', borderRadius: 6, padding: '6px 9px' }}>
                {c.organicName}: delivers ~{c.slurryN}N · {c.slurryP}P · {c.slurryK}K kg/ha
              </div>
            )}

            {/* Granular plan */}
            {c.planProducts.length > 0 ? (
              <div style={{ marginTop: 9 }}>
                {c.planProducts.map((p, i) => (
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
              </div>
            ) : !atTarget ? (
              <div style={{ fontSize: 12, color: 'var(--forest-dark)', marginTop: 9, fontWeight: 600 }}>
                {c.slurryTotal > 0 ? 'Slurry covers it — no granular needed.' : 'No granular needed.'}
              </div>
            ) : null}

            {/* Need-vs-supply bars */}
            {!atTarget && (
              <div style={{ marginTop: 9 }}>
                <SupplyBar label="N"  need={row.nNeed} supply={c.supplyN} />
                <SupplyBar label="P₂O₅" need={row.pNeed} supply={c.supplyP} />
                <SupplyBar label="K₂O" need={row.kNeed} supply={c.supplyK} />
              </div>
            )}

            {/* Per-field override (expand) */}
            {isOpen && organics.length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                  Slurry for this field {hasOverride ? '(overriding the default)' : '(using the default)'}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    className="select"
                    value={c.organicId}
                    onChange={(e) => setOverride(row.id, { productId: e.target.value === '' ? '' : Number(e.target.value) })}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <option value="">None</option>
                    {organics.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <input
                    type="number"
                    inputMode="decimal"
                    className="input"
                    placeholder="rate"
                    value={c.rateStr}
                    onChange={(e) => setOverride(row.id, { rate: e.target.value })}
                    style={{ width: 84, textAlign: 'right' }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{c.organicUnit}</span>
                </div>
                {hasOverride && (
                  <button
                    type="button"
                    onClick={() => clearOverride(row.id)}
                    style={{ marginTop: 8, fontSize: 12, color: 'var(--forest)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}
                  >
                    Reset to default
                  </button>
                )}
              </div>
            )}

            <Link
              href={`/fields/${row.id}?from=/reports/fert-plan`}
              style={{ display: 'inline-block', marginTop: 9, fontSize: 11, color: 'var(--forest)', fontWeight: 700, textDecoration: 'none' }}
            >
              Open field ›
            </Link>
          </div>
        );
      })}

      <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginTop: 14 }}>
        Granular plans meet RB209 Section 3 (June 2023) P &amp; K recommendations at each field&apos;s
        soil index, after deducting what&apos;s already been applied this season and any slurry you
        plan above. Slurry nutrient values use your product settings and assume splash-plate
        application. Always sense-check rates and consult a FACTS adviser where needed.
      </p>
    </div>
  );
}
