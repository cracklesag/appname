'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Save, MapPin, Pencil, X, Plus } from 'lucide-react';
import { Field } from '@/lib/types';
import type { FieldGeometry } from '@/lib/geo';
import { createSprayRecord } from '@/lib/actions';
import { enqueue, isOfflineError } from '@/lib/offline/queue';
import PartApplicationDraw from './PartApplicationDraw';

const WIND_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const COMMON_TARGETS = ['Docks', 'Thistles', 'Buttercup', 'Chickweed', 'Nettles', 'Ragwort', 'Dandelion'];
const LEFTOVER_MIN_HA = 0.1; // only prompt about a leftover load above this

// Handed over from the spray calculator's "Log this event" button (consumed once).
const PREFILL_KEY = 'swardly:spray-log';

interface ProdLine { key: number; productId: string; name: string; litres: string; rate: string; litresEdited: boolean; }

export function SprayRecordForm({
  fields,
  sprayProducts,
  unitSystem,
  defaultFieldId,
  tankLitres = null,
  returnTo = '/spray',
}: {
  fields: Field[];
  sprayProducts: { id: string; name: string; default_l_per_ha?: number | null }[];
  unitSystem: 'acres' | 'hectares';
  defaultFieldId?: string;
  tankLitres?: number | null;
  returnTo?: string;
}) {
  const usable = fields.filter((f) => !f.needs_setup);
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [remainingMix, setRemainingMix] = useState(false);
  const [fieldId, setFieldId] = useState<string>(defaultFieldId ?? usable[0]?.id ?? '');
  const [lines, setLines] = useState<ProdLine[]>([{ key: 1, productId: '', name: '', litres: '', rate: '', litresEdited: false }]);
  const [water, setWater] = useState('');
  const [windDir, setWindDir] = useState<string>('');
  const [targets, setTargets] = useState<string[]>([]);
  const [targetInput, setTargetInput] = useState('');
  const [partOnly, setPartOnly] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [drawnGeo, setDrawnGeo] = useState<FieldGeometry | null>(null);
  const [drawnHa, setDrawnHa] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  // Pull the calculator hand-off (field, water rate, spray lines) once on mount.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PREFILL_KEY);
      if (raw) {
        const v = JSON.parse(raw) as Partial<{
          fieldId: string;
          waterLPerHa: number;
          remaining: boolean;
          lines: { name?: string; spray_product_id?: string | null; litres?: number | null; rate?: number | null }[];
        }>;
        if (typeof v.fieldId === 'string' && v.fieldId) setFieldId(v.fieldId);
        if (v.waterLPerHa != null && Number.isFinite(v.waterLPerHa)) setWater(String(Math.round(v.waterLPerHa)));
        if (Array.isArray(v.lines) && v.lines.length > 0) {
          setLines(v.lines.map((l, i) => {
            const hasRate = l.rate != null && Number.isFinite(Number(l.rate)) && Number(l.rate) > 0;
            return {
              key: Date.now() + i,
              productId: l.spray_product_id ? String(l.spray_product_id) : '',
              name: l.name ? String(l.name) : '',
              // With a rate we let litres auto-fill for the next field's area; without, keep the given litres.
              litres: !hasRate && l.litres != null && Number.isFinite(Number(l.litres)) ? String(l.litres) : '',
              rate: hasRate ? String(l.rate) : '',
              litresEdited: !hasRate,
            };
          }));
          if (v.remaining) setRemainingMix(true); else setPrefilled(true);
        }
        sessionStorage.removeItem(PREFILL_KEY);
      }
    } catch { /* ignore */ }
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const field = usable.find((f) => f.id === fieldId);
  const boundary = (field?.boundary ?? null) as FieldGeometry | null;
  const areaUnit = unitSystem === 'acres' ? 'ac' : 'ha';
  const toUnit = (ha: number) => (unitSystem === 'acres' ? ha * 2.47105 : ha);
  const wholeHa = field?.ha ?? 0;
  const isPartial = partOnly && !!drawnGeo;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  // The area the chemical actually went on: the drawn part, or the whole field.
  const effectiveArea = isPartial ? (drawnHa ?? 0) : wholeHa;
  // Litres auto-fill from rate x area unless the user has typed their own figure.
  const effLitres = (l: ProdLine): string => {
    if (l.litresEdited) return l.litres;
    const rate = parseFloat(l.rate);
    if (rate > 0 && effectiveArea > 0) return String(round1(rate * effectiveArea));
    return l.litres;
  };

  const addTarget = (t: string) => {
    const v = t.trim();
    if (!v) return;
    setTargets((prev) => (prev.some((x) => x.toLowerCase() === v.toLowerCase()) ? prev : [...prev, v]));
  };
  const removeTarget = (t: string) => setTargets((prev) => prev.filter((x) => x !== t));

  const setLine = (key: number, patch: Partial<ProdLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, { key: Date.now(), productId: '', name: '', litres: '', rate: '', litresEdited: false }]);
  const removeLine = (key: number) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  const onPickProduct = (key: number, productId: string) => {
    const prod = sprayProducts.find((p) => p.id === productId);
    const rate = prod?.default_l_per_ha != null ? String(prod.default_l_per_ha) : '';
    // Picking a product loads its typical rate and lets litres auto-fill from area again.
    setLine(key, rate ? { productId, rate, litresEdited: false } : { productId });
  };

  const lineName = (l: ProdLine) => (l.productId ? (sprayProducts.find((p) => p.id === l.productId)?.name ?? '') : l.name.trim());
  const firstName = lines.length ? lineName(lines[0]) : '';
  const productLinesJson = JSON.stringify(
    lines
      .map((l) => {
        const v = effLitres(l);
        return { name: lineName(l), spray_product_id: l.productId || null, litres: v.trim() === '' ? null : Number(v) };
      })
      .filter((l) => l.name !== ''),
  );
  const usesStock = lines.some((l) => l.productId);

  // ---- Leftover-load estimate --------------------------------------------
  // A full tank holds tankLitres of mix; total application rate = water rate +
  // every product's rate, so tank capacity (ha) = tank / rate. After spraying
  // the effective area, the mix left in the part-used last tank covers
  // (capacity − area-used-in-that-tank). Needs a tank size, a water rate and at
  // least one product rate to mean anything.
  const waterNum = parseFloat(water) || 0;
  const sumRates = lines.reduce((a, l) => { const r = parseFloat(l.rate); return a + (r > 0 ? r : 0); }, 0);
  const totalRate = waterNum + sumRates;
  const tankCapHa = tankLitres && tankLitres > 0 && totalRate > 0 ? tankLitres / totalRate : 0;
  let leftoverHa = 0;
  if (tankCapHa > 0 && effectiveArea > 0 && waterNum > 0) {
    const rem = effectiveArea % tankCapHa;
    leftoverHa = rem < 1e-6 ? 0 : tankCapHa - rem;
  }
  const showLeftover = leftoverHa > LEFTOVER_MIN_HA;

  const [queuedOffline, setQueuedOffline] = useState(false);

  async function doSave(fd: FormData, andAnother: boolean) {
    setConfirmOpen(false);
    if (andAnother) {
      // Carry the same mix (products + rates + water) to a fresh record so the
      // remaining tank can go on another field; litres re-fill for its area.
      fd.set('return_to', '/spray/new');
      try {
        sessionStorage.setItem(PREFILL_KEY, JSON.stringify({
          remaining: true,
          waterLPerHa: waterNum > 0 ? waterNum : undefined,
          lines: lines
            .map((l) => ({ name: lineName(l), spray_product_id: l.productId || null, rate: parseFloat(l.rate) > 0 ? parseFloat(l.rate) : null }))
            .filter((l) => l.name !== ''),
        }));
      } catch { /* ignore */ }
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const result = await createSprayRecord(fd);
      // A successful save redirects (throws NEXT_REDIRECT, handled below). A
      // returned object means a validation or save problem to show inline.
      if (result && result.error) {
        setSubmitError(result.error);
        setSubmitting(false);
        return;
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) return;
      if (isOfflineError(err)) {
        await enqueue('spray_record', { fd });
        setQueuedOffline(true);
        setSubmitting(false);
        return;
      }
      if (err instanceof Error) setSubmitError(err.message);
      setSubmitting(false);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // With a meaningful leftover, confirm the area + offer the rest on another
    // field first; otherwise save straight away.
    if (showLeftover && !confirmOpen) {
      setConfirmOpen(true);
      return;
    }
    void doSave(new FormData(e.currentTarget), false);
  }

  if (queuedOffline) {
    return (
      <div className="card" style={{ padding: 18, textAlign: 'center', margin: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)', marginBottom: 6 }}>Saved on this phone</div>
        <div style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.5 }}>No signal just now — this spray record is queued and will log itself automatically when you're back in coverage. You can carry on working.</div>
      </div>
    );
  }

  if (drawing && boundary) {
    return (
      <PartApplicationDraw
        boundary={boundary}
        productName={firstName || 'Spray'}
        k2oPerHa={0}
        showLoading={false}
        unitSystem={unitSystem}
        onCancel={() => setDrawing(false)}
        onDone={(geo, ha) => { setDrawnGeo(geo); setDrawnHa(ha); setPartOnly(true); setDrawing(false); }}
      />
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} style={{ paddingBottom: 100 }}>
      <input type="hidden" name="field_id" value={fieldId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <input type="hidden" name="product_lines" value={productLinesJson} />
      {isPartial ? (
        <>
          <input type="hidden" name="coverage" value="partial" />
          <input type="hidden" name="spray_area" value={JSON.stringify(drawnGeo)} />
        </>
      ) : (
        <input type="hidden" name="area_ha" value={wholeHa} />
      )}

      <div style={{ padding: 16 }}>
        {remainingMix && (
          <div style={{ background: 'var(--forest-soft)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.45 }}>
            Remaining mix from your last spray. Pick the next field — litres fill in for its area automatically.
          </div>
        )}
        {prefilled && (
          <div style={{ background: 'var(--forest-soft)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.45 }}>
            Filled in from the calculator. Add your target and weather, then save.
          </div>
        )}

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

        {/* Operator + times — optional hardening for assurance-scheme records */}
        <div style={{ marginBottom: 14 }}>
          <div className="label">Operator <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--muted)' }}>· optional</span></div>
          <input type="text" name="operator_name" className="input" placeholder="Who sprayed it" maxLength={80} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4 }}>Start</div>
              <input type="time" name="start_time" className="input" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4 }}>Finish</div>
              <input type="time" name="finish_time" className="input" />
            </div>
          </div>
        </div>

        {/* Sprays used — one or more products in the tank; each draws its own stock */}
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: lines.length > 1 ? 4 : 8 }}>Spray{lines.length > 1 ? 's' : ''} used</div>
          {lines.length > 1 && (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.4 }}>A tank mix — this all saves as one spray record for the field.</div>
          )}
          {lines.map((l, idx) => (
            <div key={l.key} style={{ marginBottom: 10, paddingBottom: idx < lines.length - 1 ? 12 : 0, borderBottom: idx < lines.length - 1 ? '1px solid var(--line)' : 'none' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                {sprayProducts.length > 0 ? (
                  <select className="input" value={l.productId} onChange={(e) => onPickProduct(l.key, e.target.value)} style={{ flex: 1 }}>
                    <option value="">Other (type below)</option>
                    {sprayProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                ) : null}
                {lines.length > 1 && (
                  <button type="button" onClick={() => removeLine(l.key)} aria-label="Remove spray" style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--muted)', cursor: 'pointer', padding: '0 10px' }}><X size={15} /></button>
                )}
              </div>
              {l.productId === '' && (
                <input type="text" className="input" value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} placeholder="Spray name (e.g. Doxstar Pro)" maxLength={120} style={{ marginBottom: 8 }} />
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <input type="number" className="input" inputMode="decimal" step="any" min="0" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value, litresEdited: false })} placeholder="rate" style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: 'var(--muted)', width: 56 }}>L / ha</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" className="input" inputMode="decimal" step="any" min="0" value={effLitres(l)} onChange={(e) => setLine(l.key, { litres: e.target.value, litresEdited: true })} placeholder="e.g. 4" style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: 'var(--muted)', width: 56 }}>litres total</span>
              </div>
              {!l.litresEdited && parseFloat(l.rate) > 0 && effectiveArea > 0 ? (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>Auto: {l.rate} L/ha × {toUnit(effectiveArea).toFixed(2)} {areaUnit}{isPartial ? ' drawn' : ''}. Edit litres to override.</div>
              ) : l.litresEdited && parseFloat(l.rate) > 0 ? (
                <button type="button" onClick={() => setLine(l.key, { litresEdited: false })} style={{ fontSize: 11, color: 'var(--forest)', background: 'none', border: 'none', padding: '5px 0 0', cursor: 'pointer' }}>↻ Back to auto ({l.rate} L/ha × area)</button>
              ) : null}
            </div>
          ))}
          <button type="button" onClick={addLine} className="btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px' }}>
            <Plus size={15} /> Add another spray
          </button>
          {usesStock && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>Litres used will draw the chosen products down in your stock list.</div>
          )}
        </div>

        {/* Water volume (shared across the mix) */}
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label">Water volume</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="number" name="water_l_per_ha" className="input" inputMode="decimal" step="any" min="0" value={water} onChange={(e) => setWater(e.target.value)} placeholder="e.g. 200" style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: 'var(--muted)', width: 56 }}>L / ha</span>
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
            <button type="button" onClick={() => setDrawing(true)} className="btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 12px' }}>
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
              <button key={d} type="button" onClick={() => setWindDir(windDir === d ? '' : d)} className={`toggle-btn ${windDir === d ? 'active' : ''}`} style={{ minWidth: 44, padding: '7px 0' }}>
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

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setConfirmOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--paper)', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 520, padding: 20, boxShadow: '0 -8px 30px rgba(0,0,0,0.2)' }}
          >
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink)', marginBottom: 12 }}>Log this spray?</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>{isPartial ? 'Area drawn' : 'Whole field'}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{toUnit(effectiveArea).toFixed(2)} {areaUnit}{isPartial ? ' (part)' : ''}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>Mix left estimate</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--forest)' }}>≈ {toUnit(leftoverHa).toFixed(2)} {areaUnit}</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 16 }}>
              Roughly how much of the tank is left, as the area it would cover at this rate. An estimate — the drawn area is approximate.
            </div>
            <button
              type="button"
              onClick={() => { if (formRef.current) void doSave(new FormData(formRef.current), true); }}
              className="btn-primary"
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}
            >
              <MapPin size={17} /> Log &amp; spray the rest on another field
            </button>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setConfirmOpen(false)} className="btn-ghost" style={{ flex: 1 }}>Back</button>
              <button type="button" onClick={() => { if (formRef.current) void doSave(new FormData(formRef.current), false); }} className="btn-ghost" style={{ flex: 1 }}>Just log this</button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
