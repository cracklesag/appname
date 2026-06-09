'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, X, Calculator as CalcIcon, Settings as SettingsIcon } from 'lucide-react';
import { computeSprayMix, type SprayLine } from '@/lib/spray';

interface CalcField { id: string; name: string; ha: number; }
interface CalcProduct { id: string; name: string; default_l_per_ha: number | null; }
interface SprayerCfg {
  widthM: number | null;
  nozzleFlowLMin: number | null;
  nozzleCount: number | null;
  defaultSpeedKmh: number | null;
}

interface Line { key: number; productId: string; name: string; lPerHa: string; }

export function SprayCalculator({
  fields,
  products,
  sprayer,
  unitSystem,
}: {
  fields: CalcField[];
  products: CalcProduct[];
  sprayer: SprayerCfg;
  unitSystem: 'acres' | 'hectares';
}) {
  const areaUnit = unitSystem === 'acres' ? 'ac' : 'ha';
  const toHa = (x: number) => (unitSystem === 'acres' ? x / 2.47105 : x);

  const [areaMode, setAreaMode] = useState<'field' | 'manual'>(fields.length ? 'field' : 'manual');
  const [fieldId, setFieldId] = useState<string>(fields[0]?.id ?? '');
  const [manualArea, setManualArea] = useState<string>('');
  const [speed, setSpeed] = useState<string>(sprayer.defaultSpeedKmh != null ? String(sprayer.defaultSpeedKmh) : '');
  const [lines, setLines] = useState<Line[]>([{ key: 1, productId: '', name: '', lPerHa: '' }]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const areaHa = useMemo(() => {
    if (areaMode === 'field') {
      const f = fields.find((x) => x.id === fieldId);
      return f ? f.ha : 0;
    }
    const v = parseFloat(manualArea);
    return Number.isFinite(v) && v > 0 ? toHa(v) : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaMode, fieldId, manualArea, fields]);

  const calcLines: SprayLine[] = lines
    .filter((l) => (l.name.trim() || l.productId) && parseFloat(l.lPerHa) > 0)
    .map((l) => ({
      name: l.productId ? (productById.get(l.productId)?.name ?? 'Spray') : (l.name.trim() || 'Spray'),
      lPerHa: parseFloat(l.lPerHa) || 0,
    }));

  const result = useMemo(
    () => computeSprayMix({
      areaHa,
      widthM: sprayer.widthM,
      nozzleFlowLMin: sprayer.nozzleFlowLMin,
      nozzleCount: sprayer.nozzleCount,
      speedKmh: parseFloat(speed) || null,
      lines: calcLines,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [areaHa, sprayer.widthM, sprayer.nozzleFlowLMin, sprayer.nozzleCount, speed, JSON.stringify(calcLines)],
  );

  const sprayerSet = !!(sprayer.widthM && sprayer.nozzleFlowLMin && sprayer.nozzleCount);
  const totalFlow = (sprayer.nozzleFlowLMin ?? 0) * (sprayer.nozzleCount ?? 0);

  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, { key: Date.now(), productId: '', name: '', lPerHa: '' }]);
  const removeLine = (key: number) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));

  const onPickProduct = (key: number, productId: string) => {
    if (!productId) { setLine(key, { productId: '', name: '' }); return; }
    const p = productById.get(productId);
    setLine(key, {
      productId,
      name: p?.name ?? '',
      // Pre-fill the rate from the product's typical L/ha (only if the field is empty).
      lPerHa: (() => {
        const cur = lines.find((l) => l.key === key)?.lPerHa ?? '';
        if (cur.trim() !== '') return cur;
        return p?.default_l_per_ha != null ? String(p.default_l_per_ha) : '';
      })(),
    });
  };

  const fmt = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1));

  return (
    <div className="card" style={{ padding: 14, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <CalcIcon size={18} style={{ color: 'var(--forest)' }} />
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>Spray calculator</div>
      </div>

      {/* Area */}
      <div className="label" style={{ marginBottom: 6 }}>Area to spray</div>
      <div className="toggle-group" style={{ marginBottom: 10 }}>
        <button type="button" className={`toggle-btn ${areaMode === 'field' ? 'active' : ''}`} onClick={() => setAreaMode('field')} disabled={fields.length === 0}>A field</button>
        <button type="button" className={`toggle-btn ${areaMode === 'manual' ? 'active' : ''}`} onClick={() => setAreaMode('manual')}>An area</button>
      </div>
      {areaMode === 'field' ? (
        <select className="input" value={fieldId} onChange={(e) => setFieldId(e.target.value)} style={{ marginBottom: 12 }}>
          {fields.length === 0 && <option value="">No fields</option>}
          {fields.map((f) => (
            <option key={f.id} value={f.id}>{f.name} · {(unitSystem === 'acres' ? f.ha * 2.47105 : f.ha).toFixed(2)} {areaUnit}</option>
          ))}
        </select>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input type="number" className="input" inputMode="decimal" step="any" min="0" placeholder="e.g. 4.5" value={manualArea} onChange={(e) => setManualArea(e.target.value)} style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{areaUnit}</span>
        </div>
      )}
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -6, marginBottom: 14 }}>
        Area: <strong>{areaHa > 0 ? `${(unitSystem === 'acres' ? areaHa * 2.47105 : areaHa).toFixed(2)} ${areaUnit}` : '—'}</strong>
        {areaHa > 0 && unitSystem === 'acres' ? ` (${areaHa.toFixed(2)} ha)` : ''}
      </div>

      {/* Sprays in the tank */}
      <div className="label" style={{ marginBottom: 6 }}>Sprays in the tank</div>
      {lines.map((l) => (
        <div key={l.key} style={{ marginBottom: 10, padding: 10, background: 'var(--paper-deep)', borderRadius: 8 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <select className="input" value={l.productId} onChange={(e) => onPickProduct(l.key, e.target.value)} style={{ flex: 1, padding: '8px 10px' }}>
              <option value="">Other (type name)</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {lines.length > 1 && (
              <button type="button" onClick={() => removeLine(l.key)} aria-label="Remove spray" style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--muted)', cursor: 'pointer', padding: '0 10px' }}><X size={15} /></button>
            )}
          </div>
          {!l.productId && (
            <input type="text" className="input" placeholder="Spray name" value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} style={{ marginBottom: 8 }} maxLength={120} />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="number" className="input" inputMode="decimal" step="any" min="0" placeholder="rate" value={l.lPerHa} onChange={(e) => setLine(l.key, { lPerHa: e.target.value })} style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: 'var(--muted)', width: 90 }}>L / ha product</span>
          </div>
          {l.productId && productById.get(l.productId)?.default_l_per_ha != null && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>Typical: {productById.get(l.productId)?.default_l_per_ha} L/ha</div>
          )}
        </div>
      ))}
      <button type="button" onClick={addLine} className="btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', marginBottom: 14 }}>
        <Plus size={15} /> Add another spray
      </button>

      {/* Sprayer / speed */}
      <div className="label" style={{ marginBottom: 6 }}>Forward speed</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <input type="number" className="input" inputMode="decimal" step="any" min="0" placeholder="e.g. 10" value={speed} onChange={(e) => setSpeed(e.target.value)} style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>km/h</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
        {sprayerSet ? (
          <>Sprayer: <strong>{sprayer.widthM} m</strong> wide · <strong>{fmt(totalFlow)} L/min</strong> total flow ({sprayer.nozzleFlowLMin} × {sprayer.nozzleCount}). <Link href="/spray/sprayer" style={{ color: 'var(--forest)' }}>Change</Link></>
        ) : (
          <span style={{ color: 'var(--clay, #b06a37)' }}>
            <SettingsIcon size={12} style={{ verticalAlign: -1 }} /> Set your sprayer width, flow rate and nozzles to calculate volumes. <Link href="/spray/sprayer" style={{ color: 'var(--forest)', fontWeight: 700 }}>Set up sprayer →</Link>
          </span>
        )}
      </div>

      {/* Result */}
      <div style={{ background: 'var(--forest-soft)', border: '1px solid var(--line)', borderRadius: 10, padding: 14 }}>
        {!result.ok ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{result.reason}</div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
              Application volume <strong style={{ color: 'var(--ink)' }}>{fmt(result.appRateLPerHa)} L/ha</strong> (water + product) over {(unitSystem === 'acres' ? areaHa * 2.47105 : areaHa).toFixed(2)} {areaUnit}
            </div>
            {result.lines.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {result.lines.map((l, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '4px 0' }}>
                    <span style={{ color: 'var(--ink)' }}>{l.name} <span style={{ color: 'var(--muted)', fontSize: 12 }}>@ {l.lPerHa} L/ha</span></span>
                    <strong style={{ color: 'var(--forest-dark)' }}>{fmt(l.volumeL)} L</strong>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
              <span style={{ fontWeight: 700, color: 'var(--ink)' }}>Water for the tank</span>
              <strong style={{ color: 'var(--forest-dark)', fontSize: 17 }}>{fmt(result.waterL)} L</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--muted)' }}>
              <span>Total in tank (water + product)</span>
              <span>{fmt(result.totalSprayL)} L</span>
            </div>
            {result.waterNegative && (
              <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--clay, #b06a37)', lineHeight: 1.45 }}>
                Product volume ({fmt(result.totalProductL)} L) is more than the total spray volume at this application rate — there&apos;s no room for water. Increase the application rate (slow down, or larger nozzles) or check the product L/ha.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
