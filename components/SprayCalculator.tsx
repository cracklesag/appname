'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, X, RotateCcw, ClipboardList, Calculator as CalcIcon, Gauge } from 'lucide-react';
import {
  solveSprayMix, computeLoadSplit, calibrationLPerHa,
  type SprayLine, type SprayAnchor,
} from '@/lib/spray';
import { SprayWeather } from './SprayWeather';

interface CalcField { id: string; name: string; ha: number; lat?: number | null; lng?: number | null; }
interface CalcProduct { id: string; name: string; default_l_per_ha: number | null; }
interface SprayerCfg { widthM: number | null; totalFlowLMin: number | null; defaultSpeedKmh: number | null; tankLitres: number | null; }

// Inputs survive navigating away and back (and a reload).
const STORAGE_KEY = 'swardly:spray-calc-v2';
// Handed to the spray log form (consumed once there).
const PREFILL_KEY = 'swardly:spray-log';

interface Line { key: number; productId: string; name: string; lPerHa: string; }

/**
 * The spray calculator — a standalone tool. One identity solved from whichever
 * end you know: an area, a volume of one product ("6 L of X"), or a full tank.
 * Water volume is typed directly (the number you actually know); working it
 * out from the sprayer's calibration is an optional helper, never a gate.
 * Use it as a pure tool, or press Continue to carry the mix into a spray log.
 */
export function SprayCalculator({
  fields, products, sprayer, unitSystem,
}: {
  fields: CalcField[];
  products: CalcProduct[];
  sprayer: SprayerCfg;
  unitSystem: 'acres' | 'hectares';
}) {
  const areaUnit = unitSystem === 'acres' ? 'ac' : 'ha';
  const toHa = (x: number) => (unitSystem === 'acres' ? x / 2.47105 : x);
  const fromHa = (x: number) => (unitSystem === 'acres' ? x * 2.47105 : x);
  const round1 = (n: number) => Math.round(n * 10) / 10;

  const [anchor, setAnchor] = useState<SprayAnchor>('area');
  const [fieldId, setFieldId] = useState<string>(fields[0]?.id ?? '');
  const [useField, setUseField] = useState<boolean>(fields.length > 0);
  const [manualArea, setManualArea] = useState('');
  const [pivotKey, setPivotKey] = useState<number | null>(null);
  const [pivotVol, setPivotVol] = useState('');
  const [water, setWater] = useState('');
  const [lines, setLines] = useState<Line[]>([{ key: 1, productId: '', name: '', lPerHa: '' }]);
  const [showCal, setShowCal] = useState(false);
  const [speed, setSpeed] = useState<string>(sprayer.defaultSpeedKmh != null ? String(sprayer.defaultSpeedKmh) : '');
  const [view, setView] = useState<'field' | 'load'>('field');
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const v = JSON.parse(raw) as Partial<{ anchor: SprayAnchor; fieldId: string; useField: boolean; manualArea: string; pivotVol: string; water: string; lines: Line[]; speed: string }>;
        if (v.anchor === 'area' || v.anchor === 'productVolume' || v.anchor === 'tank') setAnchor(v.anchor);
        if (typeof v.fieldId === 'string') setFieldId(v.fieldId);
        if (typeof v.useField === 'boolean') setUseField(v.useField);
        if (typeof v.manualArea === 'string') setManualArea(v.manualArea);
        if (typeof v.pivotVol === 'string') setPivotVol(v.pivotVol);
        if (typeof v.water === 'string') setWater(v.water);
        if (typeof v.speed === 'string' && v.speed !== '') setSpeed(v.speed);
        if (Array.isArray(v.lines) && v.lines.length > 0) setLines(v.lines);
      }
    } catch { /* ignore */ }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ anchor, fieldId, useField, manualArea, pivotVol, water, lines, speed })); } catch { /* ignore */ }
  }, [restored, anchor, fieldId, useField, manualArea, pivotVol, water, lines, speed]);

  const clearAll = () => {
    setAnchor('area'); setFieldId(fields[0]?.id ?? ''); setUseField(fields.length > 0);
    setManualArea(''); setPivotKey(null); setPivotVol(''); setWater('');
    setSpeed(sprayer.defaultSpeedKmh != null ? String(sprayer.defaultSpeedKmh) : '');
    setLines([{ key: 1, productId: '', name: '', lPerHa: '' }]);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  };

  const router = useRouter();
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const lineLabel = (l: Line) => (l.productId ? (productById.get(l.productId)?.name ?? 'Spray') : (l.name.trim() || 'Unnamed spray'));

  const calcLines: SprayLine[] = lines
    .filter((l) => (l.name.trim() || l.productId) && parseFloat(l.lPerHa) > 0)
    .map((l) => ({ name: lineLabel(l), lPerHa: parseFloat(l.lPerHa) || 0 }));
  const pivotable = lines.filter((l) => (l.productId || l.name.trim()) && parseFloat(l.lPerHa) > 0);

  const waterNum = parseFloat(water);
  const waterLPerHa = Number.isFinite(waterNum) && waterNum > 0 ? waterNum : null;

  const areaInput = useMemo(() => {
    if (anchor !== 'area') return 0;
    if (useField) return fields.find((f) => f.id === fieldId)?.ha ?? 0;
    const v = parseFloat(manualArea);
    return Number.isFinite(v) && v > 0 ? toHa(v) : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, useField, fieldId, manualArea, fields]);

  const pivotLine = lines.find((l) => l.key === pivotKey);
  const result = useMemo(() => solveSprayMix({
    anchor,
    waterLPerHa,
    lines: calcLines,
    areaHa: areaInput,
    pivot: pivotLine && parseFloat(pivotLine.lPerHa) > 0 && parseFloat(pivotVol) > 0
      ? { lPerHa: parseFloat(pivotLine.lPerHa), volumeL: parseFloat(pivotVol) }
      : undefined,
    tankL: sprayer.tankLitres,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [anchor, waterLPerHa, JSON.stringify(calcLines), areaInput, pivotKey, pivotVol, sprayer.tankLitres]);

  const loadSplit = useMemo(() => (result.ok && result.appRateLPerHa != null && result.totalSprayL != null
    ? computeLoadSplit({ appRateLPerHa: result.appRateLPerHa, totalSprayL: result.totalSprayL, tankL: sprayer.tankLitres, lines: calcLines })
    : { ok: false as const, reason: 'Enter a water volume to split into loads.', tankL: sprayer.tankLitres ?? 0, totalLoads: 0, loads: [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, sprayer.tankLitres, JSON.stringify(calcLines)]);

  const calRate = calibrationLPerHa(sprayer.totalFlowLMin, parseFloat(speed) || null, sprayer.widthM);

  const setLine = (key: number, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, { key: Date.now(), productId: '', name: '', lPerHa: '' }]);
  const removeLine = (key: number) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  const onPickProduct = (key: number, productId: string) => {
    if (!productId) { setLine(key, { productId: '', name: '' }); return; }
    const p = productById.get(productId);
    const cur = lines.find((l) => l.key === key)?.lPerHa ?? '';
    setLine(key, { productId, name: p?.name ?? '', lPerHa: cur.trim() !== '' ? cur : (p?.default_l_per_ha != null ? String(p.default_l_per_ha) : '') });
  };

  // Continue to a spray log from ANY anchor: carry water (true water), the
  // spray rates (so litres auto-fill for whichever field gets picked), and the
  // field when one is selected. The log form consumes this once.
  const continueToLog = () => {
    const payload = {
      fieldId: anchor === 'area' && useField && fieldId ? fieldId : undefined,
      waterLPerHa: waterLPerHa ?? undefined,
      lines: calcLines.map((l) => {
        const src = lines.find((x) => lineLabel(x) === l.name);
        return { name: l.name, spray_product_id: src?.productId || null, rate: l.lPerHa };
      }),
    };
    try { sessionStorage.setItem(PREFILL_KEY, JSON.stringify(payload)); } catch { /* ignore */ }
    router.push('/spray/new?from=/spray/calculator');
  };

  const fmt = (n: number) => (n >= 100 ? Math.round(n).toString() : n >= 10 ? n.toFixed(1) : n.toFixed(2));
  const selField = fields.find((f) => f.id === fieldId);

  return (
    <div style={{ padding: 16 }}>
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <CalcIcon size={18} style={{ color: 'var(--forest)' }} />
          <div style={{ fontSize: 15.5, fontWeight: 800, color: 'var(--ink)', flex: 1 }}>What do you know?</div>
          <button type="button" onClick={clearAll} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12.5, cursor: 'pointer', padding: 4 }}>
            <RotateCcw size={13} /> Clear
          </button>
        </div>

        {/* Anchor */}
        <div className="toggle-group" style={{ marginBottom: 12 }}>
          <button type="button" className={`toggle-btn ${anchor === 'area' ? 'active' : ''}`} onClick={() => setAnchor('area')}>An area</button>
          <button type="button" className={`toggle-btn ${anchor === 'productVolume' ? 'active' : ''}`} onClick={() => { setAnchor('productVolume'); if (pivotKey == null && pivotable.length) setPivotKey(pivotable[0].key); }}>Litres of a spray</button>
          <button type="button" className={`toggle-btn ${anchor === 'tank' ? 'active' : ''}`} onClick={() => setAnchor('tank')}>One full tank</button>
        </div>

        {anchor === 'area' && (
          <div style={{ marginBottom: 12 }}>
            {fields.length > 0 && (
              <div className="toggle-group" style={{ marginBottom: 8 }}>
                <button type="button" className={`toggle-btn ${useField ? 'active' : ''}`} onClick={() => setUseField(true)}>A field</button>
                <button type="button" className={`toggle-btn ${!useField ? 'active' : ''}`} onClick={() => setUseField(false)}>Typed area</button>
              </div>
            )}
            {useField && fields.length > 0 ? (
              <select className="input" value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
                {fields.map((f) => <option key={f.id} value={f.id}>{f.name} · {fromHa(f.ha).toFixed(2)} {areaUnit}</option>)}
              </select>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" className="input" inputMode="decimal" step="any" min="0" placeholder="e.g. 4.5" value={manualArea} onChange={(e) => setManualArea(e.target.value)} style={{ flex: 1 }} />
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{areaUnit}</span>
              </div>
            )}
          </div>
        )}

        {anchor === 'productVolume' && (
          <div style={{ marginBottom: 12 }}>
            {pivotable.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>Add a spray with its rate below, then pick it here and say how many litres of it you&apos;re using.</div>
            ) : (
              <>
                <select className="input" value={pivotKey ?? ''} onChange={(e) => setPivotKey(e.target.value ? Number(e.target.value) : null)} style={{ marginBottom: 8 }}>
                  <option value="">Which spray are you measuring?</option>
                  {pivotable.map((l) => <option key={l.key} value={l.key}>{lineLabel(l)} · {l.lPerHa} L/ha</option>)}
                </select>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="number" className="input" inputMode="decimal" step="any" min="0" placeholder="e.g. 6" value={pivotVol} onChange={(e) => setPivotVol(e.target.value)} style={{ flex: 1 }} />
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>litres of it</span>
                </div>
              </>
            )}
          </div>
        )}

        {anchor === 'tank' && (
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>
            {sprayer.tankLitres && sprayer.tankLitres > 0
              ? <>Working from one full <strong>{sprayer.tankLitres} L</strong> tank. <Link href="/spray/sprayer" style={{ color: 'var(--forest)' }}>Change</Link></>
              : <>No tank size saved yet. <Link href="/spray/sprayer" style={{ color: 'var(--forest)', fontWeight: 700 }}>Set tank size →</Link></>}
          </div>
        )}

        {/* Sprays */}
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
          </div>
        ))}
        <button type="button" onClick={addLine} className="btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', marginBottom: 14 }}>
          <Plus size={15} /> Add another spray
        </button>

        {/* Water — first-class, typed */}
        <div className="label" style={{ marginBottom: 6 }}>Water volume</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="number" className="input" inputMode="decimal" step="any" min="0" placeholder="e.g. 200" value={water} onChange={(e) => setWater(e.target.value)} style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>L/ha</span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5, marginBottom: 8 }}>
          Off the product label, or what you always spray at.
        </div>

        {/* Calibration — optional helper, never a gate */}
        <button type="button" onClick={() => setShowCal((s) => !s)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--forest)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', padding: '2px 0', marginBottom: showCal ? 8 : 2 }}>
          <Gauge size={14} /> Don&apos;t know it? Work it out from your sprayer {showCal ? '▾' : '▸'}
        </button>
        {showCal && (
          <div style={{ background: 'var(--paper-deep)', borderRadius: 8, padding: 10, marginBottom: 6 }}>
            {sprayer.widthM && sprayer.totalFlowLMin ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <input type="number" className="input" inputMode="decimal" step="any" min="0" placeholder="speed" value={speed} onChange={(e) => setSpeed(e.target.value)} style={{ flex: 1 }} />
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>km/h</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                  {sprayer.widthM} m boom · {sprayer.totalFlowLMin} L/min total → {calRate != null ? <><strong style={{ color: 'var(--ink)' }}>{Math.round(calRate)} L/ha</strong> <button type="button" className="btn-ghost" onClick={() => setWater(String(Math.round(calRate)))} style={{ padding: '3px 10px', marginLeft: 6, fontSize: 12 }}>Use it</button></> : 'enter your forward speed'}
                  {' · '}<Link href="/spray/sprayer" style={{ color: 'var(--forest)' }}>Sprayer settings</Link>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Save your boom width and total output first — <Link href="/spray/sprayer" style={{ color: 'var(--forest)', fontWeight: 700 }}>Sprayer settings →</Link></div>
            )}
          </div>
        )}
      </div>

      {/* Result */}
      <div className="card" style={{ padding: 14, marginBottom: 16, background: 'var(--forest-soft)' }}>
        {!result.ok ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{result.reason}</div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
              Covers <strong style={{ color: 'var(--ink)' }}>{fromHa(result.areaHa).toFixed(2)} {areaUnit}</strong>
              {result.appRateLPerHa != null && <> · {Math.round(result.appRateLPerHa)} L/ha total mix</>}
            </div>

            {sprayer.tankLitres && anchor !== 'tank' && result.totalSprayL != null ? (
              <div className="toggle-group" style={{ marginBottom: 12 }}>
                <button type="button" className={`toggle-btn ${view === 'field' ? 'active' : ''}`} onClick={() => setView('field')}>Whole job</button>
                <button type="button" className={`toggle-btn ${view === 'load' ? 'active' : ''}`} onClick={() => setView('load')}>By tank load</button>
              </div>
            ) : null}

            {view === 'load' && anchor !== 'tank' && loadSplit.ok ? (
              <>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{loadSplit.totalLoads} load{loadSplit.totalLoads > 1 ? 's' : ''} of your {Math.round(loadSplit.tankL)} L tank</div>
                {loadSplit.loads.map((ld, i) => (
                  <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ink)', marginBottom: 6 }}>{ld.count} × {fmt(ld.volumeL)} L {ld.count > 1 ? 'loads (each)' : 'load'} · {fromHa(ld.areaHa).toFixed(2)} {areaUnit}</div>
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
                  </div>
                ))}
              </>
            ) : (
              <>
                {result.lines.map((l, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '4px 0' }}>
                    <span style={{ color: 'var(--ink)' }}>{l.name} <span style={{ color: 'var(--muted)', fontSize: 12 }}>@ {l.lPerHa} L/ha</span></span>
                    <strong style={{ color: 'var(--forest-dark)' }}>{fmt(l.volumeL)} L</strong>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, padding: '8px 0', borderTop: '1px solid var(--line)', marginTop: 4 }}>
                  <span style={{ fontWeight: 700, color: 'var(--ink)' }}>Water{anchor === 'tank' ? ' — this tank' : ''}</span>
                  <strong style={{ color: 'var(--forest-dark)', fontSize: 17 }}>{result.waterL != null ? `${fmt(result.waterL)} L` : '—'}</strong>
                </div>
                {result.waterL == null && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Enter a water volume above to get water and tank loads.</div>
                )}
                {result.totalSprayL != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>
                    <span>Total mix</span><span>{fmt(result.totalSprayL)} L</span>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {result.ok && (
        <button type="button" onClick={continueToLog} className="btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <ClipboardList size={17} /> Continue to spray log
        </button>
      )}
      <div style={{ fontSize: 11.5, color: 'var(--muted)', textAlign: 'center', marginTop: 8, lineHeight: 1.45 }}>
        Carries the mix and water through — or just use the numbers and walk away.
      </div>

      {anchor === 'area' && useField && selField && selField.lat != null && selField.lng != null && (
        <SprayWeather lat={selField.lat} lng={selField.lng} label={selField.name} />
      )}
    </div>
  );
}
