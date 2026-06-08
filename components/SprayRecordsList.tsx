'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, SprayCan, MapPin, Wind, Trash2, Map as MapIcon } from 'lucide-react';
import { deleteSprayRecord } from '@/lib/actions';

export interface SprayView {
  id: string;
  fieldName: string;
  dateLabel: string;
  product_name: string;
  product_litres: number | null;
  water_l_per_ha: number | null;
  area_ha: number | null;
  coverage: string;
  wind_dir: string | null;
  wind_speed_mph: number | null;
  temp_c: number | null;
  weather_note: string | null;
  targets: string[] | null;
  notes: string | null;
}

export function SprayRecordsList({
  records,
  unitSystem,
}: {
  records: SprayView[];
  unitSystem: 'acres' | 'hectares';
}) {
  const areaUnit = unitSystem === 'acres' ? 'ac' : 'ha';
  const toUnit = (ha: number) => (unitSystem === 'acres' ? ha * 2.47105 : ha);

  const products = useMemo(
    () => Array.from(new Set(records.map((r) => r.product_name))).sort((a, b) => a.localeCompare(b)),
    [records],
  );
  const targets = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) for (const t of r.targets ?? []) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [records]);

  const [product, setProduct] = useState('all');
  const [target, setTarget] = useState('all');

  const filtered = records.filter((r) => {
    if (product !== 'all' && r.product_name !== product) return false;
    if (target !== 'all' && !(r.targets ?? []).some((t) => t === target)) return false;
    return true;
  });

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <Link href="/spray/new" className="btn-primary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none' }}>
          <Plus size={18} /> New
        </Link>
        <Link href="/spray/map" className="btn-ghost" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none' }}>
          <MapIcon size={18} /> Map view
        </Link>
      </div>

      {records.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Product</div>
            <select className="input" value={product} onChange={(e) => setProduct(e.target.value)} style={{ padding: '8px 10px' }}>
              <option value="all">All products</option>
              {products.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Target</div>
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} style={{ padding: '8px 10px' }}>
              <option value="all">All targets</option>
              {targets.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
      )}

      {records.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <SprayCan size={26} style={{ color: 'var(--muted)' }} />
          <div className="display" style={{ fontSize: 16, fontWeight: 600, marginTop: 8 }}>No spray records yet</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
            Record sprays as you apply them — product, rate, water volume, weather and the area treated.
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          No records match those filters.
        </div>
      ) : (
        filtered.map((r) => {
          const areaHa = r.area_ha ?? 0;
          const weatherBits = [
            r.wind_dir ? `${r.wind_dir}${r.wind_speed_mph != null ? ` ${r.wind_speed_mph} mph` : ''}` : null,
            r.temp_c != null ? `${r.temp_c}°C` : null,
            r.weather_note,
          ].filter(Boolean).join(' · ');
          return (
            <div key={r.id} className="card" style={{ padding: 14, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{r.product_name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{r.fieldName} · {r.dateLabel}</div>
                </div>
                <form action={deleteSprayRecord}>
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" aria-label="Delete spray record" style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
                    <Trash2 size={16} />
                  </button>
                </form>
              </div>

              {(r.targets ?? []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                  {(r.targets ?? []).map((t) => (
                    <span key={t} style={{ fontSize: 11.5, background: 'var(--forest-soft)', border: '1px solid var(--line)', borderRadius: 12, padding: '3px 9px', color: 'var(--ink)' }}>{t}</span>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 8, fontSize: 12.5, color: 'var(--ink-soft)' }}>
                {r.coverage === 'partial' ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={12} /> Part field · {toUnit(areaHa).toFixed(2)} {areaUnit}</span>
                ) : (
                  <span>Whole field · {toUnit(areaHa).toFixed(2)} {areaUnit}</span>
                )}
                {r.water_l_per_ha != null && <span>{r.water_l_per_ha} L/ha water</span>}
                {r.product_litres != null && <span>{r.product_litres} L product</span>}
              </div>

              {weatherBits && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
                  <Wind size={12} /> {weatherBits}
                </div>
              )}
              {r.notes && <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--ink-soft)' }}>{r.notes}</div>}
            </div>
          );
        })
      )}
    </div>
  );
}
