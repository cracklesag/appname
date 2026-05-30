'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { fmt, nutrientPerArea } from '@/lib/rules';
import { FertPlanRow, PlanState, planField } from '@/lib/fertplan';
import { SupplyBar } from '@/components/NutrientBar';
import { SoilHeatBar } from '@/components/SoilHeatBar';
import { Product, RateUnit } from '@/lib/types';

export type { FertPlanRow };

// Colours for the three supply sources (match the agreed mockup).
const SRC = { carry: '#888780', slurry: '#1D9E75', granular: '#378ADD', over: '#E24B4A' };

/**
 * Stacked source bar (Style A): one nutrient, filled left-to-right with
 * carryover -> slurry -> granular, scaled so the RB209 need sits at a fixed
 * point and a marker line shows it. Anything past need shows red (over).
 * showFigures reveals the per-source kg breakdown beneath.
 */
function SourceBar({
  label, bands, unit, disp, showFigures,
}: {
  label: string;
  bands: { carry: number; slurry: number; granular: number; need: number };
  unit: string;
  disp: (kgHa: number) => number;
  showFigures: boolean;
}) {
  const supply = bands.carry + bands.slurry + bands.granular;
  const need = bands.need;
  const scaleMax = need > 0 ? need / 0.75 : Math.max(supply, 1);
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100))}%`;
  const needPct = need > 0 ? `${(need / scaleMax) * 100}%` : null;
  const over = Math.max(0, supply - need);

  return (
    <div style={{ marginBottom: showFigures ? 12 : 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{label}</span>
        <span style={{ fontSize: 11, color: over > 0.5 ? SRC.over : 'var(--muted)' }}>
          {disp(supply)}{need > 0 ? ` / ${disp(need)}` : ''} {unit}
        </span>
      </div>
      <div style={{ position: 'relative', height: 14, background: 'var(--line-soft, #e8e4da)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          {bands.carry > 0 && <div style={{ width: pct(bands.carry), background: SRC.carry }} />}
          {bands.slurry > 0 && <div style={{ width: pct(bands.slurry), background: SRC.slurry }} />}
          {bands.granular > 0 && <div style={{ width: pct(bands.granular), background: SRC.granular }} />}
        </div>
        {needPct && (
          <div style={{ position: 'absolute', top: -2, bottom: -2, left: needPct, width: 2, background: 'var(--ink, #2c2c2a)' }} />
        )}
      </div>
      {showFigures && (
        <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap', fontSize: 10 }}>
          {bands.carry > 0 && <span style={{ background: '#F1EFE8', color: '#444441', padding: '1px 7px', borderRadius: 10 }}>carryover {disp(bands.carry)}</span>}
          {bands.slurry > 0 && <span style={{ background: '#E1F5EE', color: '#085041', padding: '1px 7px', borderRadius: 10 }}>slurry {disp(bands.slurry)}</span>}
          {bands.granular > 0 && <span style={{ background: '#E6F1FB', color: '#0C447C', padding: '1px 7px', borderRadius: 10 }}>granular {disp(bands.granular)}</span>}
          {over > 0.5 && <span style={{ background: '#FCEBEB', color: '#A32D2D', padding: '1px 7px', borderRadius: 10 }}>over {disp(over)}</span>}
        </div>
      )}
    </div>
  );
}

// Soil targets for the heat bars — RB209 index 2 / pH 6.0 for grassland.
const SOIL_TARGET = { ph: 6.0, pIdx: 2, kIdx: 2 };

export function FertPlanShell({
  rows, groups, initialGroup, unitSystem, products, slurryUnit,
}: {
  rows: FertPlanRow[];
  groups: { id: string; name: string }[];
  initialGroup: string;
  unitSystem: 'acres' | 'hectares';
  products: Product[];
  slurryUnit: 'gal/ac' | 'm3/ha';
}) {
  const [groupFilter, setGroupFilter] = useState(initialGroup);

  // Display unit for nutrient & rate figures (the planner works internally in
  // kg/ha; we convert only for display so acres users see per-acre numbers).
  const sys = unitSystem === 'acres' ? 'acres' : 'hectares';
  const nUnit = sys === 'acres' ? 'kg/ac' : 'kg/ha';
  const disp = (kgHa: number) => Math.round(nutrientPerArea(kgHa, sys));

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

  // Session-only toggles (reset on leaving the plan):
  // bag products switched off (never recommended), fields dropped from the
  // spread lists, and fields where intended slurry is switched off.
  const [excludedProductIds, setExcludedProductIds] = useState<number[]>([]);
  const [excludedFieldIds, setExcludedFieldIds] = useState<string[]>([]);
  const [slurryOffFieldIds, setSlurryOffFieldIds] = useState<string[]>([]);
  const [showProductMenu, setShowProductMenu] = useState(false);

  const router = useRouter();

  const toggleIn = <T,>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const planState: PlanState = useMemo(() => ({
    defaultOrganicId, defaultRate, overrides,
    excludedProductIds, excludedFieldIds, slurryOffFieldIds,
  }), [defaultOrganicId, defaultRate, overrides, excludedProductIds, excludedFieldIds, slurryOffFieldIds]);

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

  // Per-field plan via the shared planner (honours product on/off + slurry off).
  const computed = useMemo(
    () => visible.map((row) => planField(row, planState, organics, granular, { slurryUnit, unitSystem })),
    [visible, planState, organics, granular, slurryUnit, unitSystem],
  );

  /** Save the current toggles/overrides and open a spread list. */
  const openSpreadList = (mode: 'granular' | 'slurry') => {
    try {
      sessionStorage.setItem('swardly_plan_state', JSON.stringify(planState));
    } catch { /* ignore */ }
    router.push(`/reports/spread-list?mode=${mode}&from=/reports/fert-plan`);
  };

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

      {/* Fertiliser sources in use — toggle which bag products the plan may use */}
      {granular.length > 0 && (
        <div className="card" style={{ padding: 13, marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => setShowProductMenu((v) => !v)}
            style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Fertiliser sources in use
            </span>
            <span style={{ fontSize: 11, color: 'var(--forest-dark)', fontWeight: 700 }}>
              {granular.length - excludedProductIds.length}/{granular.length} on · {showProductMenu ? 'hide' : 'edit'}
            </span>
          </button>
          {showProductMenu && (
            <>
              <div style={{ fontSize: 11, color: 'var(--muted)', margin: '8px 0 10px', lineHeight: 1.45 }}>
                Switch off anything you&apos;re not spreading this round. The plan won&apos;t recommend it —
                a field short of that nutrient just stays short, and it won&apos;t appear on the spread list.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {granular.map((p) => {
                  const on = !excludedProductIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setExcludedProductIds((prev) => toggleIn(prev, p.id))}
                      style={{
                        background: on ? 'var(--forest)' : 'var(--card)',
                        color: on ? 'var(--paper)' : 'var(--muted)',
                        border: on ? 'none' : '1px solid var(--line)',
                        borderRadius: 20, padding: '6px 12px', fontSize: 12, fontWeight: 700,
                        cursor: 'pointer', textDecoration: on ? 'none' : 'line-through',
                      }}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </>
          )}
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

      {/* Compile spread lists for the contractor */}
      {computed.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => openSpreadList('granular')}
            style={{ flex: 1, background: 'var(--forest)', color: 'var(--paper)', border: 'none', borderRadius: 10, padding: '11px 10px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            Granular spread list
          </button>
          <button
            type="button"
            onClick={() => openSpreadList('slurry')}
            style={{ flex: 1, background: SRC.slurry, color: '#fff', border: 'none', borderRadius: 10, padding: '11px 10px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            Slurry spread list
          </button>
        </div>
      )}

      {/* P & K source legend */}
      {computed.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10, fontSize: 11 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: SRC.carry }} /><span style={{ color: 'var(--muted)' }}>Carryover</span></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: SRC.slurry }} /><span style={{ color: 'var(--muted)' }}>Slurry / digestate</span></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: SRC.granular }} /><span style={{ color: 'var(--muted)' }}>Granular</span></span>
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
        const excluded = excludedFieldIds.includes(row.id);
        const slurryOff = slurryOffFieldIds.includes(row.id);
        const cutLabel = row.cutType === 'grazing' ? 'grazing'
          : row.cutType === 'bales' ? `cut ${row.cutNumber} (bales)`
          : `cut ${row.cutNumber}`;
        const atTarget = c.nothingGranular && c.slurryTotal === 0
          && row.p2o5ToApply === 0 && row.k2oToApply === 0 && row.nToApply === 0
          && !row.pHeld && !row.kHeld;

        return (
          <div key={row.id} className="card" style={{ padding: 13, marginBottom: 8, opacity: excluded ? 0.5 : 1 }}>
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
              {excluded ? (
                <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: 'var(--muted)', background: 'var(--card)', border: '1px solid var(--line)', padding: '4px 9px', borderRadius: 6 }}>
                  off list
                </span>
              ) : atTarget && (
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
                {c.organicName}: delivers ~{disp(c.slurryN)}N · {disp(c.slurryP)}P · {disp(c.slurryK)}K {nUnit}
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
                      <div className="nutrient-num" style={{ fontSize: 18, color: 'var(--ink)' }}>{disp(p.rateKgPerHa)}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{nUnit}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : !atTarget ? (
              <div style={{ fontSize: 12, color: 'var(--forest-dark)', marginTop: 9, fontWeight: 600 }}>
                {c.slurryTotal > 0 ? 'Slurry covers it — no granular needed.' : 'No granular needed.'}
              </div>
            ) : null}

            {/* Need-vs-supply bars. N stays a simple supply bar; P & K show
                the source breakdown (carryover / slurry / granular), with the
                per-source figures revealed when the field is expanded. */}
            {!atTarget && (
              <div style={{ marginTop: 9 }}>
                <SupplyBar label="N"  need={disp(row.nNeed)} supply={disp(c.supplyN)} unit={nUnit} />
                <SourceBar label="P₂O₅" bands={c.pBands} unit={nUnit} disp={disp} showFigures={isOpen} />
                <SourceBar label="K₂O"  bands={c.kBands} unit={nUnit} disp={disp} showFigures={isOpen} />
                {!isOpen && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>
                    Tap to see P &amp; K split by source · carryover is an estimated release
                  </div>
                )}
              </div>
            )}

            {/* Low-rate hold notice — P or K shortfall too small to spread, so
                it's held in the season balance and will combine with a later
                cut once it's worth applying. */}
            {(row.pHeld || row.kHeld) && (
              <div style={{
                marginTop: 8, padding: '7px 10px', borderRadius: 8,
                background: '#F4EFE2', border: '1px solid #E4D9BD',
                fontSize: 11, color: '#6B5D34', lineHeight: 1.45,
              }}>
                {row.pHeld && row.kHeld
                  ? `P and K shortfalls are below your minimum spread rate — held for now and carried forward; they'll show once they build up enough to be worth spreading.`
                  : row.pHeld
                  ? `P₂O₅ shortfall is below your minimum spread rate — too small to spread this cut. It's held and carried forward to combine with a later cut.`
                  : `K₂O shortfall is below your minimum spread rate — too small to spread this cut. It's held and carried forward to combine with a later cut.`}
              </div>
            )}

            {/* Field-level spread toggles (shown when expanded) */}
            {isOpen && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setExcludedFieldIds((prev) => toggleIn(prev, row.id))}
                  style={{
                    fontSize: 12, fontWeight: 700, cursor: 'pointer', borderRadius: 8, padding: '7px 11px',
                    background: excluded ? 'var(--forest)' : 'var(--card)',
                    color: excluded ? 'var(--paper)' : 'var(--ink-soft)',
                    border: excluded ? 'none' : '1px solid var(--line)',
                  }}
                >
                  {excluded ? 'Add back to spread list' : 'Take off spread list'}
                </button>
                {(c.organicName || slurryOff || defaultOrganicId !== '') && (
                  <button
                    type="button"
                    onClick={() => setSlurryOffFieldIds((prev) => toggleIn(prev, row.id))}
                    style={{
                      fontSize: 12, fontWeight: 700, cursor: 'pointer', borderRadius: 8, padding: '7px 11px',
                      background: slurryOff ? 'var(--card)' : SRC.slurry,
                      color: slurryOff ? 'var(--muted)' : '#fff',
                      border: slurryOff ? '1px solid var(--line)' : 'none',
                    }}
                  >
                    {slurryOff ? 'Slurry off — turn on' : 'Slurry on — turn off'}
                  </button>
                )}
              </div>
            )}

            {/* Per-field override (expand) */}
            {isOpen && organics.length > 0 && !slurryOff && (
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
        application. The grey <strong>carryover</strong> band is an <em>estimate</em> of P &amp; K
        from earlier applications still becoming available (slurry fast, FYM over months) net of
        crop offtake — it is a model, not an RB209 figure. Always sense-check rates and consult a
        FACTS adviser where needed.
      </p>
    </div>
  );
}
