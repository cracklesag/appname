'use client';

import { useMemo, useState } from 'react';
import { createJobsFromPlan } from '@/lib/actions';
import { displayNutrient, bagAmountToKgPerHa, displayBagProductRate } from '@/lib/rules';
import { Settings } from '@/lib/types';

export interface GrazingJobField {
  id: string;
  name: string;
  areaHa: number;
  due: boolean;
}
export interface GrazingJobProduct {
  id: number;
  name: string;
  nPct: number;
}

const HA_TO_AC = 2.4711;

/**
 * Review screen for turning the grazing top-up into a job sheet. Pick the N
 * product, switch fields on/off, and adjust the per-field rate (defaulted from
 * the grazing cadence). Posts the selected fields to createJobsFromPlan, which
 * builds the fertiliser job sheet (one product → one sheet).
 */
export function GrazingJobSheetForm({
  fields, products, settings, cadenceKgN,
}: {
  fields: GrazingJobField[];
  products: GrazingJobProduct[];
  settings: Pick<Settings, 'unitSystem' | 'bagFertUnit'>;
  cadenceKgN: number;
}) {
  const unit = settings.bagFertUnit;
  const nutrientUnit = displayNutrient(0, unit).unit;
  const acres = settings.unitSystem === 'acres';

  const sortedProducts = useMemo(
    () => products.slice().sort((a, b) => b.nPct - a.nPct),
    [products],
  );

  const [productId, setProductId] = useState<number | ''>(sortedProducts[0]?.id ?? '');
  const product = sortedProducts.find((p) => p.id === productId) ?? null;

  // Product rate (kg/ha) that delivers the cadence N with the chosen product.
  const defaultRateKgHa = product && product.nPct > 0 ? cadenceKgN / (product.nPct / 100) : 0;
  const defaultProductRate = displayBagProductRate(defaultRateKgHa, settings.unitSystem);
  const defaultNDisp = Math.round(displayNutrient(cadenceKgN, unit).value);

  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    () => Object.fromEntries(fields.map((f) => [f.id, f.due])),
  );
  // '' means "follow the current default" — cleared whenever the product changes.
  const [rates, setRates] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map((f) => [f.id, ''])),
  );

  const changeProduct = (id: number | '') => {
    setProductId(id);
    setRates(Object.fromEntries(fields.map((f) => [f.id, ''])));
  };

  const rateFor = (id: string): string => {
    const r = rates[id];
    return r !== undefined && r !== '' ? r : defaultNDisp ? String(defaultNDisp) : '';
  };

  const items = fields
    .filter((f) => enabled[f.id])
    .map((f) => ({
      field_id: f.id,
      product_id: Number(productId),
      rate_kg_ha: product && product.nPct > 0
        ? bagAmountToKgPerHa(parseFloat(rateFor(f.id)) || 0, unit) / (product.nPct / 100)
        : 0,
    }))
    .filter((it) => it.product_id && it.rate_kg_ha > 0);

  const onCount = fields.filter((f) => enabled[f.id]).length;
  const areaOf = (ha: number) => (acres ? ha * HA_TO_AC : ha).toFixed(1) + (acres ? ' ac' : ' ha');

  if (products.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <div className="card" style={{ padding: 16, fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
          To build a top-up sheet you need a nitrogen fertiliser in your products list (one with an N %).
          Add the product you spread on grazing ground, then come back here.
        </div>
      </div>
    );
  }
  if (fields.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <div className="card" style={{ padding: 16, fontSize: 13, color: 'var(--muted)' }}>
          No grazing fields to top up.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '14px 16px' }}>
      {/* Product picker */}
      <div className="card" style={{ padding: 13, marginBottom: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 6 }}>
          Product
        </label>
        <select
          className="select"
          value={productId}
          onChange={(e) => changeProduct(e.target.value === '' ? '' : Number(e.target.value))}
          style={{ width: '100%' }}
        >
          {sortedProducts.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {product && (
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
            Default top-up <strong style={{ color: 'var(--ink-soft)' }}>{defaultNDisp} {nutrientUnit} N</strong>.
            With this product, that is about {defaultProductRate.value} {defaultProductRate.unit} of product.
            Adjust the N for any field below.
          </div>
        )}
      </div>

      {/* Field list */}
      <div className="card" style={{ padding: 6, marginBottom: 12 }}>
        {fields.map((f) => {
          const on = !!enabled[f.id];
          return (
            <div
              key={f.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 8px',
                borderBottom: '1px solid var(--line-soft, #eee)', opacity: on ? 1 : 0.5,
              }}
            >
              <button
                type="button"
                onClick={() => setEnabled((p) => ({ ...p, [f.id]: !p[f.id] }))}
                aria-label={on ? `Remove ${f.name}` : `Add ${f.name}`}
                style={{
                  flexShrink: 0, width: 22, height: 22, borderRadius: 6, cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--forest)' : 'var(--line)'}`,
                  background: on ? 'var(--forest)' : 'var(--card)', color: 'var(--paper)',
                  fontSize: 13, lineHeight: 1, display: 'grid', placeItems: 'center',
                }}
              >
                {on ? '✓' : ''}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                  {f.name}
                  {f.due && <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--amber)', marginLeft: 6 }}>DUE</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{areaOf(f.areaHa)}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                <input
                  type="number"
                  inputMode="decimal"
                  className="input"
                  value={rateFor(f.id)}
                  disabled={!on}
                  onChange={(e) => setRates((p) => ({ ...p, [f.id]: e.target.value }))}
                  style={{ width: 72, textAlign: 'right' }}
                />
                <span style={{ fontSize: 11, color: 'var(--muted)', width: 76 }}>{nutrientUnit} N</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create */}
      <form action={createJobsFromPlan}>
        <input type="hidden" name="items" value={JSON.stringify(items)} />
        <button
          type="submit"
          disabled={items.length === 0}
          style={{
            width: '100%', borderRadius: 10, padding: 13, fontSize: 14, fontWeight: 700, border: 'none',
            background: items.length === 0 ? 'var(--line)' : 'var(--forest)',
            color: items.length === 0 ? 'var(--muted)' : 'var(--paper)',
            cursor: items.length === 0 ? 'default' : 'pointer',
          }}
        >
          Create job sheet →
        </button>
        <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 7, lineHeight: 1.4 }}>
          {onCount === 0
            ? 'Switch on the fields you want to spread.'
            : `${onCount} field${onCount === 1 ? '' : 's'} on this sheet. You can edit it, then share it from Jobs.`}
        </div>
      </form>
    </div>
  );
}
