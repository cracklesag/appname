'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Droplets, Sprout, Mountain, Save, Tractor } from 'lucide-react';
import { ProductType } from '@/lib/types';
import { createCustomProduct } from '@/lib/actions';

/**
 * Form for creating a user-owned product. Submits to the createCustomProduct
 * server action which redirects to `return_to` on success.
 */
export function CustomProductForm({ returnTo }: { returnTo: string }) {
  const [type, setType] = useState<ProductType>('slurry');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      await createCustomProduct(fd);
    } catch (err) {
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) {
        setSubmitError(err.message);
      }
      setSubmitting(false);
    }
  }

  // Per-type helper text — what the user is entering and in what unit
  const unitsLabel =
    type === 'bag_fert'     ? 'as % w/w of the product' :
    type === 'slurry'       ? 'kg per cubic metre (m³) of slurry' :
    type === 'solid_manure' ? 'kg per tonne (t) of fresh-weight product' :
    null;

  return (
    <form onSubmit={handleSubmit} style={{ paddingBottom: 100 }}>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="return_to" value={returnTo} />

      <div style={{ padding: 16 }}>
        {/* Type picker */}
        <div className="label" style={{ marginBottom: 6 }}>Product type</div>
        <div className="toggle-group" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
          <button type="button" className={`toggle-btn ${type === 'slurry' ? 'active' : ''}`} onClick={() => setType('slurry')}><Droplets size={16} /> Slurry</button>
          <button type="button" className={`toggle-btn ${type === 'solid_manure' ? 'active' : ''}`} onClick={() => setType('solid_manure')}><Tractor size={16} /> Solid manure</button>
          <button type="button" className={`toggle-btn ${type === 'bag_fert' ? 'active' : ''}`} onClick={() => setType('bag_fert')}><Sprout size={16} /> Bag fert</button>
          <button type="button" className={`toggle-btn ${type === 'lime' ? 'active' : ''}`} onClick={() => setType('lime')}><Mountain size={16} /> Lime</button>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 14 }}>
          <div className="label">Name</div>
          <input
            type="text"
            name="name"
            className="input"
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

        {/* DM% — slurry and solid only */}
        {(type === 'slurry' || type === 'solid_manure') && (
          <div style={{ marginBottom: 14 }}>
            <div className="label">Dry matter (%) <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--muted)' }}>· optional</span></div>
            <input type="number" name="dm_pct" className="input" inputMode="decimal" step="any" min="0" max="100" placeholder="e.g. 6" />
          </div>
        )}

        {/* Nutrient inputs */}
        {type !== 'lime' && (
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 4 }}>Nutrient values</div>
            {unitsLabel && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{unitsLabel}</div>}

            {type === 'bag_fert' && (
              <>
                <NutrientRow label="N"    name="n_pct"    suffix="%" placeholder="e.g. 25" />
                <NutrientRow label="P₂O₅" name="p2o5_pct" suffix="%" placeholder="e.g. 5" />
                <NutrientRow label="K₂O"  name="k2o_pct"  suffix="%" placeholder="e.g. 5" />
                <NutrientRow label="SO₃"  name="s_pct"    suffix="%" placeholder="e.g. 8" optional />
              </>
            )}
            {type === 'slurry' && (
              <>
                <NutrientRow label="N"    name="n_kg_per_m3"    suffix="kg/m³" placeholder="e.g. 2.6" />
                <NutrientRow label="P₂O₅" name="p2o5_kg_per_m3" suffix="kg/m³" placeholder="e.g. 1.2" />
                <NutrientRow label="K₂O"  name="k2o_kg_per_m3"  suffix="kg/m³" placeholder="e.g. 2.5" />
                <NutrientRow label="SO₃"  name="so3_kg_per_m3"  suffix="kg/m³" placeholder="e.g. 0.7" optional />
                <NutrientRow label="MgO"  name="mgo_kg_per_m3"  suffix="kg/m³" placeholder="e.g. 0.6" optional />
              </>
            )}
            {type === 'solid_manure' && (
              <>
                <NutrientRow label="N"    name="n_kg_per_t"    suffix="kg/t" placeholder="e.g. 6.0" />
                <NutrientRow label="P₂O₅" name="p2o5_kg_per_t" suffix="kg/t" placeholder="e.g. 3.2" />
                <NutrientRow label="K₂O"  name="k2o_kg_per_t"  suffix="kg/t" placeholder="e.g. 9.4" />
                <NutrientRow label="SO₃"  name="so3_kg_per_t"  suffix="kg/t" placeholder="e.g. 2.4" optional />
                <NutrientRow label="MgO"  name="mgo_kg_per_t"  suffix="kg/t" placeholder="e.g. 1.8" optional />
              </>
            )}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>
              Leave a field blank if you don't have the value — it'll be treated as zero in calculations.
            </div>
          </div>
        )}

        {type === 'lime' && (
          <div className="card" style={{ padding: 14, marginBottom: 14, background: 'var(--stone-soft)', borderColor: 'var(--stone)' }}>
            <div style={{ fontSize: 13, color: 'var(--stone)', fontWeight: 700 }}>pH amendment</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
              Lime products don't carry N/P/K values in this app — the rate captures the application and a separate soil-pH workflow handles the response.
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
            <Save size={18} /> {submitting ? 'Saving…' : 'Save product'}
          </button>
        </div>
      </div>
    </form>
  );
}

function NutrientRow({
  label, name, suffix, placeholder, optional,
}: {
  label: string; name: string; suffix: string; placeholder?: string; optional?: boolean;
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
        style={{ flex: 1 }}
      />
      <div style={{ width: 52, fontSize: 12, color: 'var(--muted)' }}>
        {suffix}{optional && <span style={{ marginLeft: 4, fontStyle: 'italic' }}>·opt</span>}
      </div>
    </div>
  );
}
