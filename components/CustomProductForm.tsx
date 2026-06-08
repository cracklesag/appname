'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Droplets, Sprout, Mountain, Save, Tractor } from 'lucide-react';
import { ProductType, Product } from '@/lib/types';
import { createCustomProduct, updateCustomProduct } from '@/lib/actions';

/**
 * Form for creating OR editing a user-owned product.
 *
 * Create mode submits to createCustomProduct. Edit mode submits to
 * updateCustomProduct, which writes a new dated analysis version (effective
 * from the chosen date — backdatable) so past applications keep the values they
 * were spread with. In edit mode the product type is fixed (changing slurry <->
 * bag fert would break valuation), so the type picker is hidden.
 */
export function CustomProductForm({
  returnTo,
  initialType = 'slurry',
  mode = 'create',
  productId,
  initial,
}: {
  returnTo: string;
  initialType?: ProductType;
  mode?: 'create' | 'edit';
  productId?: number;
  initial?: Partial<Product>;
}) {
  const isEdit = mode === 'edit';
  const [type, setType] = useState<ProductType>(initial?.type ?? initialType);
  const [bagForm, setBagForm] = useState<'granular' | 'liquid'>(
    (initial?.form as 'granular' | 'liquid' | undefined) ?? 'granular',
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      if (isEdit) await updateCustomProduct(fd);
      else await createCustomProduct(fd);
    } catch (err) {
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) {
        setSubmitError(err.message);
      }
      setSubmitting(false);
    }
  }

  const unitsLabel =
    type === 'bag_fert'     ? 'as % w/w of the product' :
    type === 'slurry'       ? 'kg per cubic metre (m³) of slurry' :
    type === 'solid_manure' ? 'kg per tonne (t) of fresh-weight product' :
    null;

  const typeLabel =
    type === 'bag_fert'     ? 'Bag fert' :
    type === 'slurry'       ? 'Slurry' :
    type === 'solid_manure' ? 'Solid manure' :
    'Lime';
  const TypeIcon = type === 'slurry' ? Droplets : type === 'solid_manure' ? Tractor : type === 'bag_fert' ? Sprout : Mountain;

  return (
    <form onSubmit={handleSubmit} style={{ paddingBottom: 100 }}>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="return_to" value={returnTo} />
      {isEdit && productId != null && <input type="hidden" name="product_id" value={productId} />}

      <div style={{ padding: 16 }}>
        {/* Type picker (create) or fixed type (edit) */}
        {isEdit ? (
          <div style={{ marginBottom: 16 }}>
            <div className="label" style={{ marginBottom: 6 }}>Product type</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--line)', fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
              <TypeIcon size={16} style={{ color: 'var(--forest)' }} /> {typeLabel}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Type can&apos;t be changed. To switch type, add a new product instead.</div>
          </div>
        ) : (
          <>
            <div className="label" style={{ marginBottom: 6 }}>Product type</div>
            <div className="toggle-group" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
              <button type="button" className={`toggle-btn ${type === 'slurry' ? 'active' : ''}`} onClick={() => setType('slurry')}><Droplets size={16} /> Slurry</button>
              <button type="button" className={`toggle-btn ${type === 'solid_manure' ? 'active' : ''}`} onClick={() => setType('solid_manure')}><Tractor size={16} /> Solid manure</button>
              <button type="button" className={`toggle-btn ${type === 'bag_fert' ? 'active' : ''}`} onClick={() => setType('bag_fert')}><Sprout size={16} /> Bag fert</button>
              <button type="button" className={`toggle-btn ${type === 'lime' ? 'active' : ''}`} onClick={() => setType('lime')}><Mountain size={16} /> Lime</button>
            </div>
          </>
        )}

        {/* Name */}
        <div style={{ marginBottom: 14 }}>
          <div className="label">Name</div>
          <input
            type="text"
            name="name"
            className="input"
            defaultValue={initial?.name ?? ''}
            placeholder={
              type === 'slurry'       ? 'e.g. Tank 2 dairy slurry'      :
              type === 'solid_manure' ? 'e.g. Heifer FYM (stored 2yr)'   :
              type === 'bag_fert'     ? 'e.g. 20-10-10 blend'            :
              'e.g. Mag-lime'
            }
            required
            maxLength={80}
          />
        </div>

        {/* DM% - slurry and solid only */}
        {(type === 'slurry' || type === 'solid_manure') && (
          <div style={{ marginBottom: 14 }}>
            <div className="label">Dry matter (%) <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--muted)' }}>· optional</span></div>
            <input type="number" name="dm_pct" className="input" inputMode="decimal" step="any" min="0" max="100" defaultValue={initial?.dm_pct ?? undefined} placeholder="e.g. 6" />
          </div>
        )}

        {/* Nutrient inputs */}
        {type !== 'lime' && (
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 4 }}>Nutrient values</div>
            {unitsLabel && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{unitsLabel}</div>}
            {(type === 'slurry' || type === 'solid_manure') && (
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.45, marginBottom: 10 }}>
                Enter the figures from your own {type === 'slurry' ? 'slurry' : 'manure'} analysis if you have one. Leave blank anything you do not have, and use the placeholders as typical guides.
              </div>
            )}

            {type === 'bag_fert' && (
              <>
                <input type="hidden" name="form" value={bagForm} />
                <div className="toggle-group" style={{ marginBottom: 12 }}>
                  <button type="button" className={`toggle-btn ${bagForm === 'granular' ? 'active' : ''}`} onClick={() => setBagForm('granular')}>Granular</button>
                  <button type="button" className={`toggle-btn ${bagForm === 'liquid' ? 'active' : ''}`} onClick={() => setBagForm('liquid')}>Liquid</button>
                </div>
                {bagForm === 'liquid' && (
                  <div style={{ marginBottom: 12 }}>
                    <NutrientRow label="Density" name="density_kg_per_l" suffix="kg/L" placeholder="e.g. 1.28" defaultValue={initial?.density_kg_per_l} />
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontStyle: 'italic' }}>
                      From the product label. Used to convert your litres/ha rate into kg of nutrient. Typical liquid N is around 1.25–1.30 kg/L.
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
                  Analysis as % w/w (e.g. 20-0-0 +15S = N 20, SO₃ 15)
                </div>
                <NutrientRow label="N"    name="n_pct"    suffix="%" placeholder="e.g. 20" defaultValue={initial?.n_pct} />
                <NutrientRow label="P₂O₅" name="p2o5_pct" suffix="%" placeholder="e.g. 0" defaultValue={initial?.p2o5_pct} />
                <NutrientRow label="K₂O"  name="k2o_pct"  suffix="%" placeholder="e.g. 0" defaultValue={initial?.k2o_pct} />
                <NutrientRow label="SO₃"  name="s_pct"    suffix="%" placeholder="e.g. 15" optional defaultValue={initial?.s_pct} />
              </>
            )}
            {type === 'slurry' && (
              <>
                <NutrientRow label="N"    name="n_kg_per_m3"    suffix="kg/m³" placeholder="e.g. 2.6" defaultValue={initial?.n_kg_per_m3} />
                <NutrientRow label="P₂O₅" name="p2o5_kg_per_m3" suffix="kg/m³" placeholder="e.g. 1.2" defaultValue={initial?.p2o5_kg_per_m3} />
                <NutrientRow label="K₂O"  name="k2o_kg_per_m3"  suffix="kg/m³" placeholder="e.g. 2.5" defaultValue={initial?.k2o_kg_per_m3} />
                <NutrientRow label="SO₃"  name="so3_kg_per_m3"  suffix="kg/m³" placeholder="e.g. 0.7" optional defaultValue={initial?.so3_kg_per_m3} />
                <NutrientRow label="MgO"  name="mgo_kg_per_m3"  suffix="kg/m³" placeholder="e.g. 0.6" optional defaultValue={initial?.mgo_kg_per_m3} />
              </>
            )}
            {type === 'solid_manure' && (
              <>
                <NutrientRow label="N"    name="n_kg_per_t"    suffix="kg/t" placeholder="e.g. 6.0" defaultValue={initial?.n_kg_per_t} />
                <NutrientRow label="P₂O₅" name="p2o5_kg_per_t" suffix="kg/t" placeholder="e.g. 3.2" defaultValue={initial?.p2o5_kg_per_t} />
                <NutrientRow label="K₂O"  name="k2o_kg_per_t"  suffix="kg/t" placeholder="e.g. 9.4" defaultValue={initial?.k2o_kg_per_t} />
                <NutrientRow label="SO₃"  name="so3_kg_per_t"  suffix="kg/t" placeholder="e.g. 2.4" optional defaultValue={initial?.so3_kg_per_t} />
                <NutrientRow label="MgO"  name="mgo_kg_per_t"  suffix="kg/t" placeholder="e.g. 1.8" optional defaultValue={initial?.mgo_kg_per_t} />
              </>
            )}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>
              Leave a field blank if you don&apos;t have the value - it&apos;ll be treated as zero in calculations.
            </div>
          </div>
        )}

        {/* Effective-from - edit mode only, for versioned (non-lime) products */}
        {isEdit && type !== 'lime' && (
          <div className="card" style={{ padding: 14, marginBottom: 14, background: 'var(--forest-soft)', borderColor: 'var(--line)' }}>
            <div className="label" style={{ marginBottom: 6 }}>These values apply from</div>
            <input type="date" name="effective_from" className="input" defaultValue={today} max={today} />
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.45, marginTop: 8 }}>
              Applications on or after this date use the new values; anything spread before it keeps the old ones. If an analysis came back after you&apos;d already spread, backdate this to the sample date so that spreading recalculates.
            </div>
          </div>
        )}

        {type === 'lime' && (
          <div className="card" style={{ padding: 14, marginBottom: 14, background: 'var(--stone-soft)', borderColor: 'var(--stone)' }}>
            <div style={{ fontSize: 13, color: 'var(--stone)', fontWeight: 700 }}>pH amendment</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
              Lime products don&apos;t carry N/P/K values in this app - the rate captures the application and a separate soil-pH workflow handles the response.
            </div>
          </div>
        )}
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: '0 16px 16px', background: 'linear-gradient(to top, var(--paper) 70%, transparent)' }}>
        {submitError && (
          <div style={{ marginBottom: 10, padding: 10, background: 'var(--red-soft, #ffe5e5)', color: 'var(--red, #b00)', fontSize: 13, borderRadius: 6 }}>
            {submitError}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href={returnTo} className="btn-ghost" style={{ flex: 1, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Cancel</Link>
          <button type="submit" className="btn-primary" style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} disabled={submitting}>
            <Save size={18} /> {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save product'}
          </button>
        </div>
      </div>
    </form>
  );
}

function NutrientRow({
  label, name, suffix, placeholder, optional, defaultValue,
}: {
  label: string; name: string; suffix: string; placeholder?: string; optional?: boolean; defaultValue?: number | null;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <div style={{ width: 48, fontSize: 13, color: 'var(--ink)', fontWeight: 700 }}>{label}</div>
      <input
        type="number"
        name={name}
        inputMode="decimal"
        step="any"
        min="0"
        className="input"
        placeholder={placeholder}
        defaultValue={defaultValue ?? undefined}
        style={{ flex: 1 }}
      />
      <div style={{ width: 52, fontSize: 12, color: 'var(--muted)' }}>
        {suffix}{optional && <span style={{ marginLeft: 4, fontStyle: 'italic' }}>·opt</span>}
      </div>
    </div>
  );
}
