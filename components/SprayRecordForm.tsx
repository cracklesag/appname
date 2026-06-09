'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Save, MapPin, Pencil, X } from 'lucide-react';
import { Field } from '@/lib/types';
import type { FieldGeometry } from '@/lib/geo';
import { createSprayRecord } from '@/lib/actions';
import PartApplicationDraw from './PartApplicationDraw';

const WIND_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const COMMON_TARGETS = ['Docks', 'Thistles', 'Buttercup', 'Chickweed', 'Nettles', 'Ragwort', 'Dandelion'];

export function SprayRecordForm({
  fields,
  sprayProducts,
  unitSystem,
  defaultFieldId,
  returnTo = '/spray',
}: {
  fields: Field[];
  sprayProducts: { id: string; name: string }[];
  unitSystem: 'acres' | 'hectares';
  defaultFieldId?: string;
  returnTo?: string;
}) {
  const usable = fields.filter((f) => !f.needs_setup);
  const [fieldId, setFieldId] = useState<string>(defaultFieldId ?? usable[0]?.id ?? '');
  const [productName, setProductName] = useState('');
  const [productId, setProductId] = useState('');
  const [windDir, setWindDir] = useState<string>('');
  const [targets, setTargets] = useState<string[]>([]);
  const [targetInput, setTargetInput] = useState('');
  const [partOnly, setPartOnly] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [drawnGeo, setDrawnGeo] = useState<FieldGeometry | null>(null);
  const [drawnHa, setDrawnHa] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const field = usable.find((f) => f.id === fieldId);
  const boundary = (field?.boundary ?? null) as FieldGeometry | null;
  const areaUnit = unitSystem === 'acres' ? 'ac' : 'ha';
  const toUnit = (ha: number) => (unitSystem === 'acres' ? ha * 2.47105 : ha);
  const wholeHa = field?.ha ?? 0;
  const isPartial = partOnly && !!drawnGeo;
  const addTarget = (t: string) => {
    const v = t.trim();
    if (!v) return;
    setTargets((prev) => (prev.some((x) => x.toLowerCase() === v.toLowerCase()) ? prev : [...prev, v]));
  };
  const removeTarget = (t: string) => setTargets((prev) => prev.filter((x) => x !== t));
  const effectiveName = productId ? (sprayProducts.find((p) => p.id === productId)?.name ?? '') : productName;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      await createSprayRecord(fd);
    } catch (err) {
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) setSubmitError(err.message);
      setSubmitting(false);
    }
  }

  if (drawing && boundary) {
    return (
      <PartApplicationDraw
        boundary={boundary}
        productName={effectiveName || 'Spray'}
        k2oPerHa={0}
        showLoading={false}
        unitSystem={unitSystem}
        onCancel={() => setDrawing(false)}
        onDone={(geo, ha) => { setDrawnGeo(geo); setDrawnHa(ha); setPartOnly(true); setDrawing(false); }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ paddingBottom: 100 }}>
      <input type="hidden" name="field_id" value={fieldId} />
      <input type="hidden" name="return_to" value={returnTo} />
      {isPartial ? (
        <>
          <input type="hidden" name="coverage" value="partial" />
          <input type="hidden" name="spray_area" value={JSON.stringify(drawnGeo)} />
        </>
      ) : (
        <input type="hidden" name="area_ha" value={wholeHa} />
      )}

      <div style={{ padding: 16 }}>
        {/* Field */}
        <div style={{ marginBottom: 14 }}>
          <div className="label">Field</div>
          <select className="input" value={fieldId} onChange={(e) => { setFieldId(e.target.value); setPartOnly(false); setDrawnGeo(null); setDrawnHa(null); }} required>
            {usable.length === 0 && <option value="">No fields yet</option>}
            {usable.map((f) => (
              <option key={f.id} value={f.id}>{f.name} · {toUnit(f.ha).toFixed(1)} {areaUnit}</option>
            ))}
          </select>
        </div>

        {/* Date */}
        <div style={{ marginBottom: 14 }}>
          <div className="label">Date</div>
          <input type="date" name="date_applied" className="input" defaultValue={today} max={today} required />
        </div>

        {/* Spray used — pick from the stock list (draws down stock) or type a one-off */}
        <div style={{ marginBottom: 14 }}>
          <div className="label">Spray used</div>
          {sprayProducts.length > 0 && (
            <select
              className="input"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              style={{ marginBottom: productId === '' ? 8 : 0 }}
            >
              <option value="">Other (type below)</option>
              {sprayProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {productId === '' && (
            <input
              type="text" className="input"
              value={productName} onChange={(e) => setProductName(e.target.value)}
              placeholder="e.g. Doxstar Pro" required maxLength={120}
            />
          )}
          <input type="hidden" name="product_name" value={effectiveName} />
          {productId && <input type="hidden" name="spray_product_id" value={productId} />}
          {sprayProducts.length > 0 && productId && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Logging litres used will draw this product down in your stock list.</div>
          )}
        </div>

        {/* Rates */}
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div className="label">Product used</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" name="product_litres" className="input" inputMode="decimal" step="any" min="0" placeholder="e.g. 4" style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: 'var(--muted)', width: 56 }}>litres total</span>
              </div>
            </div>
          </div>
          <div>
            <div className="label">Water volume</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="number" name="water_l_per_ha" className="input" inputMode="decimal" step="any" min="0" placeholder="e.g. 200" style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: 'var(--muted)', width: 56 }}>L / ha</span>
            </div>
          </div>
        </div>

        {/* Area / part-field */}
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>Area sprayed</div>
          {!isPartial ? (
            <div style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 10 }}>
              Whole field — {toUnit(wholeHa).toFixed(2)} {areaUnit}
            </div>
          ) : (
            <div style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <MapPin size={15} style={{ color: 'var(--forest)' }} />
              Part of field — {toUnit(drawnHa ?? 0).toFixed(2)} {areaUnit} drawn
            </div>
          )}
          {boundary ? (
            <button
              type="button"
              onClick={() => setDrawing(true)}
              className="btn-ghost"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 12px' }}
            >
              <Pencil size={15} /> {isPartial ? 'Redraw sprayed area' : 'Sprayed only part? Draw it'}
            </button>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>
              To record a part-field spray, add this field&apos;s boundary on the Farm map first, then come back.
            </div>
          )}
        </div>

        {/* Weather */}
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 4 }}>Weather at spraying</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Wind matters for spray records — fill what you can.</div>

          <input type="hidden" name="wind_dir" value={windDir} />
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 6 }}>Wind direction</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {WIND_DIRS.map((d) => (
              <button
                key={d} type="button"
                onClick={() => setWindDir(windDir === d ? '' : d)}
                className={`toggle-btn ${windDir === d ? 'active' : ''}`}
                style={{ minWidth: 44, padding: '7px 0' }}
              >
                {d}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4 }}>Wind speed</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="number" name="wind_speed_mph" className="input" inputMode="decimal" step="any" min="0" placeholder="e.g. 6" style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>mph</span>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4 }}>Temperature</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="number" name="temp_c" className="input" inputMode="decimal" step="any" placeholder="e.g. 14" style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>°C</span>
              </div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4 }}>Conditions</div>
            <input type="text" name="weather_note" className="input" placeholder="e.g. dry, overcast, light breeze" maxLength={120} />
          </div>
        </div>

        {/* Targets (multiple) */}
        <input type="hidden" name="targets" value={JSON.stringify(targets)} />
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>Target <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--muted)' }}>· optional · add as many as apply</span></div>
          {targets.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {targets.map((t) => (
                <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--forest-soft)', border: '1px solid var(--line)', borderRadius: 14, padding: '5px 6px 5px 11px', fontSize: 13, color: 'var(--ink)' }}>
                  {t}
                  <button type="button" onClick={() => removeTarget(t)} aria-label={`Remove ${t}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'inline-flex', padding: 0 }}><X size={14} /></button>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {COMMON_TARGETS.filter((c) => !targets.some((t) => t.toLowerCase() === c.toLowerCase())).map((c) => (
              <button key={c} type="button" onClick={() => addTarget(c)} className="toggle-btn" style={{ padding: '6px 10px' }}>+ {c}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text" className="input" value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTarget(targetInput); setTargetInput(''); } }}
              placeholder="Add another…" maxLength={60} style={{ flex: 1 }}
            />
            <button type="button" className="btn-ghost" onClick={() => { addTarget(targetInput); setTargetInput(''); }} style={{ padding: '0 14px' }}>Add</button>
          </div>
        </div>
        <div style={{ marginBottom: 4 }}>
          <div className="label">Notes <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--muted)' }}>· optional</span></div>
          <input type="text" name="notes" className="input" placeholder="anything else worth recording" maxLength={240} />
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: '0 16px 16px', background: 'linear-gradient(to top, var(--paper) 70%, transparent)' }}>
        {submitError && (
          <div style={{ marginBottom: 10, padding: 10, background: 'var(--red-soft, #ffe5e5)', color: 'var(--red, #b00)', fontSize: 13, borderRadius: 6 }}>
            {submitError}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href={returnTo} className="btn-ghost" style={{ flex: 1, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Cancel</Link>
          <button type="submit" className="btn-primary" style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} disabled={submitting || !fieldId}>
            <Save size={18} /> {submitting ? 'Saving…' : 'Save spray record'}
          </button>
        </div>
      </div>
    </form>
  );
}
