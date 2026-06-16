'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, X, RotateCcw, ClipboardList, Calculator as CalcIcon, Settings as SettingsIcon } from 'lucide-react';
import { computeSprayMix, computeLoadSplit, areaFromProductVolume, type SprayLine } from '@/lib/spray';
import { SprayWeather } from './SprayWeather';

interface CalcField { id: string; name: string; ha: number; lat?: number | null; lng?: number | null; }
interface CalcProduct { id: string; name: string; default_l_per_ha: number | null; }
interface SprayerCfg {
  widthM: number | null;
  totalFlowLMin: number | null;
  defaultSpeedKmh: number | null;
  tankLitres: number | null;
}

// Inputs survive navigating to the sprayer-settings page and back (and a reload).
const STORAGE_KEY = 'swardly:spray-calc';

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

  const [areaMode, setAreaMode] = useState<'field' | 'manual' | 'byProduct'>(fields.length ? 'field' : 'manual');
  const [fieldId, setFieldId] = useState<string>(fields[0]?.id ?? '');
  const [manualArea, setManualArea] = useState<string>('');
  const [pivotKey, setPivotKey] = useState<number | null>(null);
  const [pivotVol, setPivotVol] = useState<string>('');
  const [speed, setSpeed] = useState<string>(sprayer.defaultSpeedKmh != null ? String(sprayer.defaultSpeedKmh) : '');
  const [lines, setLines] = useState<Line[]>([{ key: 1, productId: '', name: '', lPerHa: '' }]);
  const [restored, setRestored] = useState(false);
  const [view, setView] = useState<'field' | 'load'>('field');

  // Restore once on mount (client only — keeps SSR markup stable).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const v = JSON.parse(raw) as Partial<{ areaMode: 'field' | 'manual' | 'byProduct'; fieldId: string; manualArea: string; speed: string; lines: Line[] }>;
        if (v.areaMode === 'field' || v.areaMode === 'manual' || v.areaMode === 'byProduct') setAreaMode(v.areaMode);
        if (typeof v.fieldId === 'string') setFieldId(v.fieldId);
        if (typeof v.manualArea === 'string') setManualArea(v.manualArea);
        if (typeof v.speed === 'string' && v.speed !== '') setSpeed(v.speed);
        if (Array.isArray(v.lines) && v.lines.length > 0) setLines(v.lines);
      }
    } catch { /* ignore */ }
    setRestored(true);
  }, []);

  // Persist after restore so the initial restore doesn't clobber saved data.
  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ areaMode, fieldId, manualArea, speed, lines }));
    } catch { /* ignore */ }
  }, [restored, areaMode, fieldId, manualArea, speed, lines]);

  const clearAll = () => {
    setAreaMode(fields.length ? 'field' : 'manual');
    setFieldId(fields[0]?.id ?? '');
    setManualArea('');
    setPivotKey(null);
    setPivotVol('');
    setSpeed(sprayer.defaultSpeedKmh != null ? String(sprayer.defaultSpeedKmh) : '');
    setLines([{ key: 1, productId: '', name: '', lPerHa: '' }]);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  };

  const router = useRouter();
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const round1 = (n: number) => Math.round(n * 10) / 10;

  const areaHa = useMemo(() => {
    if (areaMode === 'field') {
      const f = fields.find((x) => x.id === fieldId);
      return f ? f.ha : 0;
    }
    if (areaMode === 'byProduct') {
      const line = lines.find((l) => l.key === pivotKey);
      const rate = line ? parseFloat(line.lPerHa) : NaN;
      const vol = parseFloat(pivotVol);
      return areaFromProductVolume(Number.isFinite(vol) ? vol : 0, Number.isFinite(rate) ? rate : 0);
    }
    const v = parseFloat(manualArea);
    return Number.isFinite(v) && v > 0 ? toHa(v) : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaMode, fieldId, manualArea, fields, pivotKey, pivotVol, lines]);

  const calcLines: SprayLine[] = lines
    .filter((l) => (l.name.trim() || l.productId) && parseFloat(l.lPerHa) > 0)
    .map((l) => ({
      name: l.productId ? (productById.get(l.productId)?.name ?? 'Spray') : (l.name.trim() || 'Spray'),
      lPerHa: parseFloat(l.lPerHa) || 0,
    }));

  // For the "by volume" pivot: lines that have a name and a rate can be measured.
  const lineLabel = (l: Line) => (l.productId ? (productById.get(l.productId)?.name ?? 'Spray') : (l.name.trim() || 'Unnamed spray'));
  const pivotable = lines.filter((l) => (l.productId || l.name.trim()) && parseFloat(l.lPerHa) > 0);

  const result = useMemo(
    () => computeSprayMix({
      areaHa,
      widthM: sprayer.widthM,
      totalFlowLMin: sprayer.totalFlowLMin,
      speedKmh: parseFloat(speed) || null,
      lines: calcLines,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [areaHa, sprayer.widthM, sprayer.totalFlowLMin, speed, JSON.stringify(calcLines)],
  );

  const loadSplit = useMemo(
    () => computeLoadSplit({ appRateLPerHa: result.appRateLPerHa, totalSprayL: result.totalSprayL, tankL: sprayer.tankLitres, lines: calcLines }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result.appRateLPerHa, result.totalSprayL, sprayer.tankLitres, JSON.stringify(calcLines)],
  );
  const tankSet = !!(sprayer.tankLitres && sprayer.tankLitres > 0);

  const sprayerSet = !!(sprayer.widthM && sprayer.totalFlowLMin);
  const totalFlow = sprayer.totalFlowLMin ?? 0;

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

  const logEvent = () => {
    const f = fields.find((x) => x.id === fieldId);
    if (!f) return;
    const payloadLines = lines
      .filter((l) => (l.name.trim() || l.productId) && parseFloat(l.lPerHa) > 0)
      .map((l) => ({
        name: l.productId ? (productById.get(l.productId)?.name ?? '') : l.name.trim(),
        spray_product_id: l.productId || null,
        litres: round1((parseFloat(l.lPerHa) || 0) * areaHa),
      }))
      .filter((l) => l.name !== '');
    const payload = { fieldId, waterLPerHa: Math.round(result.appRateLPerHa), lines: payloadLines };
    try { sessionStorage.setItem('swardly:spray-log', JSON.stringify(payload)); } catch { /* ignore */ }
    router.push('/spray/new');
  };

  const fmt = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1));

  return (
    <div className="card" style={{ padding: 14, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <CalcIcon size={18} style={{ color: 'var(--forest)' }} />
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)', flex: 1 }}>Spray calculator</div>
        <button type="button" onClick={clearAll} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12.5, cursor: 'pointer', padding: 4 }}>
          <RotateCcw size={13} /> Clear
        </button>
      </div>

      {/* Area */}
      <div className="label" style={{ marginBottom: 6 }}>Area to spray</div>
      <div className="toggle-group" style={{ marginBottom: 10 }}>
        <button type="button" className={`toggle-btn ${areaMode === 'field' ? 'active' : ''}`} onClick={() => setAreaMode('field')} disabled={fields.length === 0}>A field</button>
        <button type="button" className={`toggle-btn ${areaMode === 'manual' ? 'active' : ''}`} onClick={() => setAreaMode('manual')}>An area</button>
        <button type="button" className={`toggle-btn ${areaMode === 'byProduct' ? 'active' : ''}`} onClick={() => { setAreaMode('byProduct'); if (pivotKey == null && pivotable.length) setPivotKey(pivotable[0].key); }}>By volume</button>
      </div>
      {areaMode === 'field' ? (
        <select className="input" value={fieldId} onChange={(e) => setFieldId(e.target.value)} style={{ marginBottom: 12 }}>
          {fields.length === 0 && <option value="">No fields</option>}
          {fields.map((f) => (
            <option key={f.id} value={f.id}>{f.name} · {(unitSystem === 'acres' ? f.ha * 2.47105 : f.ha).toFixed(2)} {areaUnit}</option>
          ))}
        </select>
      ) : areaMode === 'byProduct' ? (
        <div style={{ marginBottom: 12 }}>
          {pivotable.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
              Add a spray with its rate below first, then come back and pick it here to work the mix out from how much of it you&apos;re putting in.
            </div>
          ) : (
            <>
              <select className="input" value={pivotKey ?? ''} onChange={(e) => setPivotKey(e.target.value ? Number(e.target.value) : null)} style={{ marginBottom: 8 }}>
                <option value="">Which spray are you measuring?</option>
                {pivotable.map((l) => <option key={l.key} value={l.key}>{lineLabel(l)} · {l.lPerHa} L/ha</option>)}
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" className="input" inputMode="decimal" step="any" min="0" placeholder="e.g. 10" value={pivotVol} onChange={(e) => setPivotVol(e.target.value)} style={{ flex: 1 }} />
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>litres in tank</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5 }}>Works out the area that covers — then the other sprays and water below.</div>
            </>
          )}
        </div>
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
          <>Sprayer: <strong>{sprayer.widthM} m</strong> wide · <strong>{fmt(totalFlow)} L/min</strong> total output. <Link href="/spray/sprayer" style={{ color: 'var(--forest)' }}>Change</Link></>
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

            <div className="toggle-group" style={{ marginBottom: 12 }}>
              <button type="button" className={`toggle-btn ${view === 'field' ? 'active' : ''}`} onClick={() => setView('field')}>Whole field</button>
              <button type="button" className={`toggle-btn ${view === 'load' ? 'active' : ''}`} onClick={() => setView('load')}>By load</button>
            </div>

            {view === 'field' ? (
              <>
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
                  <span style={{ fontWeight: 700, color: 'var(--ink)' }}>Water — whole field</span>
                  <strong style={{ color: 'var(--forest-dark)', fontSize: 17 }}>{fmt(result.waterL)} L</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--muted)' }}>
                  <span>Total mix — whole field</span>
                  <span>{fmt(result.totalSprayL)} L</span>
                </div>
                {result.waterNegative && (
                  <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--clay, #b06a37)', lineHeight: 1.45 }}>
                    Product volume ({fmt(result.totalProductL)} L) is more than the total spray volume at this application rate — there&apos;s no room for water. Increase the application rate (slow down, or larger nozzles) or check the product L/ha.
                  </div>
                )}
              </>
            ) : loadSplit.ok ? (
              <>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                  {loadSplit.totalLoads} load{loadSplit.totalLoads > 1 ? 's' : ''} of your {fmt(loadSplit.tankL)} L tank
                </div>
                {loadSplit.loads.map((ld, i) => (
                  <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ink)', marginBottom: 6 }}>
                      {ld.count} × {fmt(ld.volumeL)} L {ld.count > 1 ? 'loads (each)' : 'load'}
                    </div>
                    {ld.lines.map((l, j) => (
                      <div key={j} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '3px 0' }}>
                        <span style={{ color: 'var(--ink)' }}>{l.name} <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>@ {l.lPerHa} L/ha</span></span>
                        <strong style={{ color: 'var(--forest-dark)' }}>{fmt(l.volumeL)} L</strong>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '4px 0 0', borderTop: '1px solid var(--line)', marginTop: 4 }}>
                      <span style={{ color: 'var(--ink-soft)' }}>Water</span>
                      <strong style={{ color: 'var(--forest-dark)' }}>{fmt(ld.waterL)} L</strong>
                    </div>
                    {ld.waterNegative && (
                      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--clay, #b06a37)' }}>Product exceeds the load volume — check the rate.</div>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
                {loadSplit.reason}{!tankSet && <> <Link href="/spray/sprayer" style={{ color: 'var(--forest)', fontWeight: 700 }}>Set tank size →</Link></>}
              </div>
            )}
          </>
        )}
      </div>

      {/* Log this mix as a spray record (carries field, water rate and sprays through) */}
      {result.ok && (
        areaMode === 'field' && fieldId ? (
          <button type="button" onClick={logEvent} className="btn-primary" style={{ width: '100%', marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <ClipboardList size={17} /> Log whole field at this rate
          </button>
        ) : (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.45 }}>
            Pick a field above (not a typed area) to log this as a spray record.
          </div>
        )
      )}
          {(() => {
        const f = fields.find((x) => x.id === fieldId);
        return f && f.lat != null && f.lng != null ? <SprayWeather lat={f.lat} lng={f.lng} label={f.name} /> : null;
      })()}
</div>
  );
}
