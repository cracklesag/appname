'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Droplets, Sprout, Mountain, Save } from 'lucide-react';
import { Field, Product, Settings } from '@/lib/types';
import {
  calcNutrients, fmt, METHOD_LABELS,
} from '@/lib/rules';
import { saveApplication } from '@/lib/actions';

const LIME_RATES = [1, 1.5, 2, 2.5, 3] as const;

export function LogApplicationForm({
  field, products, settings,
}: {
  field: Field;
  products: Product[];
  settings: Settings;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [type, setType] = useState<'slurry' | 'bag_fert' | 'lime'>('slurry');
  const [productId, setProductId] = useState<number>(() => products.find((p) => p.type === 'slurry')?.id ?? 4);
  const [date, setDate] = useState(today);
  const [rateValue, setRateValue] = useState('');
  const [method, setMethod] = useState<'splash_plate' | 'dribble_bar' | 'trail_shoe'>('splash_plate');
  const [limeRate, setLimeRate] = useState<number>(2);
  const [notes, setNotes] = useState('');

  const product = products.find((p) => p.id === productId);
  const availableProducts = products.filter((p) => p.type === type);

  const displayUnit =
    type === 'slurry' ? settings.slurryUnit :
    type === 'lime' ? settings.limeUnit :
    settings.bagFertUnit;

  // When type changes, swap to first product of that type and clear rate
  function changeType(newType: typeof type) {
    setType(newType);
    const first = products.find((p) => p.type === newType);
    if (first) setProductId(first.id);
    if (newType !== 'lime') setRateValue('');
  }

  const numericRate = type === 'lime' ? limeRate : parseFloat(rateValue) || 0;
  const storedUnit = type === 'lime' ? 't/ac' : displayUnit;

  const nut = useMemo(
    () => calcNutrients(product, numericRate, storedUnit as any, date, type === 'slurry' ? method : null),
    [product, numericRate, storedUnit, date, type, method]
  );

  const totalQty = useMemo(() => {
    if (type === 'lime') return { value: limeRate * field.acres, unit: 't' };
    if (type === 'slurry') {
      const galPerAc = displayUnit === 'm3/ha' ? numericRate * 89.0 : numericRate;
      return { value: galPerAc * field.acres, unit: 'gal' };
    }
    let kgPerHa = numericRate;
    if (displayUnit === 'kg/ac') kgPerHa = numericRate * 2.4711;
    else if (displayUnit === 'lb/ac') kgPerHa = numericRate * 1.1209;
    return { value: kgPerHa * field.ha, unit: 'kg' };
  }, [type, limeRate, numericRate, displayUnit, field]);

  const canSave = product && date && numericRate > 0;

  return (
    <form action={saveApplication} style={{ paddingBottom: 100 }}>
      <input type="hidden" name="field_id" value={field.id} />
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="rate_value" value={numericRate} />
      <input type="hidden" name="rate_unit" value={storedUnit} />
      {type === 'slurry' && <input type="hidden" name="method" value={method} />}

      <div style={{ padding: 16 }}>
        <div className="toggle-group" style={{ marginBottom: 16 }}>
          <button type="button" className={`toggle-btn ${type === 'slurry' ? 'active' : ''}`} onClick={() => changeType('slurry')}><Droplets size={16} /> Slurry</button>
          <button type="button" className={`toggle-btn ${type === 'bag_fert' ? 'active' : ''}`} onClick={() => changeType('bag_fert')}><Sprout size={16} /> Bag fert</button>
          <button type="button" className={`toggle-btn ${type === 'lime' ? 'active' : ''}`} onClick={() => changeType('lime')}><Mountain size={16} /> Lime</button>
        </div>

        {type !== 'lime' && (
          <div style={{ marginBottom: 14 }}>
            <div className="label">Product</div>
            <select className="select" value={productId} onChange={(e) => setProductId(parseInt(e.target.value))}>
              {availableProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <div className="label">Date applied</div>
          <input type="date" name="date_applied" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>

        {type === 'lime' ? (
          <div style={{ marginBottom: 14 }}>
            <div className="label">Rate (t/ac)</div>
            <select className="select" value={limeRate} onChange={(e) => setLimeRate(parseFloat(e.target.value))}>
              {LIME_RATES.map((r) => <option key={r} value={r}>{r} t/ac</option>)}
            </select>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              = {fmt(totalQty.value, 1)} t total over {field.acres} ac
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <div className="label">Rate ({displayUnit})</div>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              className="input"
              placeholder={
                type === 'slurry'
                  ? (displayUnit === 'gal/ac' ? 'e.g. 2000' : 'e.g. 22')
                  : (displayUnit === 'kg/ha' ? 'e.g. 440' : displayUnit === 'kg/ac' ? 'e.g. 178' : 'e.g. 392')
              }
              value={rateValue}
              onChange={(e) => setRateValue(e.target.value)}
            />
            {numericRate > 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                = {fmt(totalQty.value)} {totalQty.unit} total over {field.acres} ac
              </div>
            )}
          </div>
        )}

        {type === 'slurry' && (
          <div style={{ marginBottom: 14 }}>
            <div className="label">Application method</div>
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value as any)}>
              {(['splash_plate', 'dribble_bar', 'trail_shoe'] as const).map((m) => (
                <option key={m} value={m}>{METHOD_LABELS[m]}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <div className="label">Notes (optional)</div>
          <textarea name="notes" className="textarea" rows={2} placeholder="Anything worth recording…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {type !== 'lime' && numericRate > 0 && (
          <div className="card" style={{ padding: 14, background: 'var(--forest-soft)', borderColor: 'var(--forest)' }}>
            <div className="label" style={{ color: 'var(--forest-dark)' }}>This application delivers</div>
            <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--forest-dark)', textTransform: 'uppercase', fontWeight: 700 }}>N</div>
                <div className="nutrient-num" style={{ fontSize: 22, color: 'var(--forest-dark)' }}>{fmt(nut.nPerHa)}</div>
                <div style={{ fontSize: 11, color: 'var(--forest-dark)' }}>kg/ha {type === 'slurry' ? 'avail' : ''}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--forest-dark)', textTransform: 'uppercase', fontWeight: 700 }}>P₂O₅</div>
                <div className="nutrient-num" style={{ fontSize: 22, color: 'var(--forest-dark)' }}>{fmt(nut.p2o5PerHa)}</div>
                <div style={{ fontSize: 11, color: 'var(--forest-dark)' }}>kg/ha</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--forest-dark)', textTransform: 'uppercase', fontWeight: 700 }}>K₂O</div>
                <div className="nutrient-num" style={{ fontSize: 22, color: 'var(--forest-dark)' }}>{fmt(nut.k2oPerHa)}</div>
                <div style={{ fontSize: 11, color: 'var(--forest-dark)' }}>kg/ha</div>
              </div>
            </div>
            {nut.nNote && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--forest-dark)', fontStyle: 'italic' }}>N basis: {nut.nNote}</div>}
            {type === 'slurry' && nut.availFactor === 0 && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--forest)', fontSize: 12, color: 'var(--forest-dark)' }}>
                <strong>Autumn application:</strong> N assumed leached before spring growth. P and K still bank in the soil and count in full.
              </div>
            )}
          </div>
        )}
        {type === 'lime' && (
          <div className="card" style={{ padding: 14, background: 'var(--stone-soft)', borderColor: 'var(--stone)' }}>
            <div style={{ fontSize: 13, color: 'var(--stone)', fontWeight: 700 }}>pH amendment</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
              Lime doesn't deliver N/P/K. It raises soil pH, which unlocks N uptake and lifts grass response — resample 6–12 months after application to confirm pH movement.
            </div>
          </div>
        )}
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: 16, background: 'linear-gradient(to top, var(--paper) 70%, transparent)', display: 'flex', gap: 10 }}>
        <Link href={`/fields/${field.id}`} className="btn-ghost" style={{ flex: 1, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Cancel</Link>
        <button type="submit" className="btn-primary" style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} disabled={!canSave}>
          <Save size={18} /> Save entry
        </button>
      </div>
    </form>
  );
}
