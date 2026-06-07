'use client';

import { useMemo, useState } from 'react';
import { SoilSample } from '@/lib/types';
import { fmtDate } from '@/lib/rules';

// ---------------------------------------------------------------------------
// Micronutrient / extras formatting
//
// Extracted samples dump the full panel into `extras` as snake_case keys, with
// the lab's unit folded into the suffix (e.g. sulphur_ppm, cec_meq_per_100g,
// organic_matter_loi_pct). Turn those into a readable label + unit + value, and
// bucket them so the grid reads sensibly.
// ---------------------------------------------------------------------------

const SUFFIX_UNITS: [string, string][] = [
  ['_meq_per_100g', 'meq/100g'],
  ['_mg_per_kg', 'mg/kg'],
  ['_percent_sat', '% sat'],
  ['_loi_pct', '% LOI'],
  ['_pct', '%'],
  ['_percent', '%'],
  ['_ppm', 'ppm'],
];

function splitKey(key: string): { name: string; unit: string } {
  const lower = key.toLowerCase();
  for (const [suf, unit] of SUFFIX_UNITS) {
    if (lower.endsWith(suf)) return { name: key.slice(0, key.length - suf.length), unit };
  }
  return { name: key, unit: '' };
}

function titleize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

const SECONDARY = ['calcium', 'magnesium', 'sulphur', 'sulfur', 'sodium'];
const MICRO = ['manganese', 'copper', 'boron', 'zinc', 'molybdenum', 'iron', 'cobalt', 'selenium', 'aluminium', 'aluminum', 'chloride', 'silicon', 'nickel'];

function groupFor(name: string): 'secondary' | 'micro' | 'other' {
  const n = name.toLowerCase();
  if (SECONDARY.some((s) => n.includes(s))) return 'secondary';
  if (MICRO.some((s) => n.includes(s))) return 'micro';
  return 'other';
}

function fmtVal(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return String(v ?? '');
}

type Row = { key: string; label: string; unit: string; value: string; group: 'secondary' | 'micro' | 'other' };

function extrasToRows(extras: Record<string, unknown>): { texture: string | null; rows: Row[] } {
  let texture: string | null = null;
  const rows: Row[] = [];
  for (const [key, raw] of Object.entries(extras ?? {})) {
    if (raw == null || raw === '') continue;
    if (key === 'soil_texture' || key === 'textural_class' || key === 'texture') {
      texture = String(raw);
      continue;
    }
    const { name, unit } = splitKey(key);
    rows.push({ key, label: titleize(name), unit, value: fmtVal(raw), group: groupFor(name) });
  }
  rows.sort((a, b) => a.label.localeCompare(b.label));
  return { texture, rows };
}

const GROUP_TITLES: Record<'secondary' | 'micro' | 'other', string> = {
  secondary: 'Secondary nutrients',
  micro: 'Micronutrients',
  other: 'Other',
};

export function SoilSamplesShell({
  fieldName,
  samples,
}: {
  fieldName: string;
  samples: SoilSample[];
}) {
  const [tab, setTab] = useState<'history' | 'micros'>('history');
  const [selectedId, setSelectedId] = useState<string>(samples[0]?.id ?? '');

  const selected = useMemo(
    () => samples.find((s) => s.id === selectedId) ?? samples[0],
    [samples, selectedId],
  );
  const micro = useMemo(
    () => (selected ? extrasToRows(selected.extras ?? {}) : { texture: null, rows: [] as Row[] }),
    [selected],
  );

  if (samples.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>No imported soil samples for {fieldName} yet.</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
            This history is built from soil reports you import with the PDF scanner. Manually entered pH/P/K values show on the field page but don&apos;t create a sample record here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['history', 'micros'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`toggle-btn ${tab === t ? 'active' : ''}`}
            style={{ fontSize: 13, padding: '7px 14px' }}
          >
            {t === 'history' ? 'Sample history' : 'Micronutrients'}
          </button>
        ))}
      </div>

      {tab === 'history' ? (
        <div>
          {samples.map((s, i) => {
            const older = samples[i + 1];
            const delta = (cur: number | null, prev: number | null | undefined) => {
              if (cur == null || prev == null) return null;
              const d = Math.round((cur - prev) * 100) / 100;
              if (d === 0) return { txt: 'no change', up: null as boolean | null };
              return { txt: `${d > 0 ? '+' : ''}${d}`, up: d > 0 };
            };
            const cells: { label: string; value: string; sub?: string; delta: ReturnType<typeof delta> }[] = [
              { label: 'pH', value: s.ph != null ? String(s.ph) : '—', delta: delta(s.ph, older?.ph) },
              { label: 'P', value: s.p_index != null ? `idx ${s.p_index}` : '—', sub: s.p_ppm != null ? `${s.p_ppm} ppm` : undefined, delta: delta(s.p_index, older?.p_index) },
              { label: 'K', value: s.k_index != null ? `idx ${s.k_index}` : '—', sub: s.k_ppm != null ? `${s.k_ppm} ppm` : undefined, delta: delta(s.k_index, older?.k_index) },
              { label: 'Mg', value: s.mg_index != null ? `idx ${s.mg_index}` : '—', sub: s.mg_ppm != null ? `${s.mg_ppm} ppm` : undefined, delta: delta(s.mg_index, older?.mg_index) },
            ];
            return (
              <div key={s.id} className="card" style={{ padding: 13, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                    {s.sample_date ? fmtDate(s.sample_date) : 'Date not recorded'}
                  </div>
                  {i === 0 && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--forest-dark)', background: 'var(--forest-soft)', padding: '2px 7px', borderRadius: 4 }}>
                      LATEST
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  {cells.map((c) => (
                    <div key={c.label} style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{c.label}</div>
                      <div className="nutrient-num" style={{ fontSize: 16, color: 'var(--ink)' }}>{c.value}</div>
                      {c.sub && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{c.sub}</div>}
                      {c.delta && (
                        <div style={{ fontSize: 10, fontWeight: 700, color: c.delta.up == null ? 'var(--muted)' : c.delta.up ? 'var(--forest-dark, #3d5b29)' : 'var(--red, #b85b3a)' }}>
                          {c.delta.up == null ? '·' : c.delta.up ? '▲' : '▼'} {c.delta.txt}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {(s.lab_name || s.lab_sample_ref) && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>
                    {s.lab_name}{s.lab_name && s.lab_sample_ref ? ' · ' : ''}{s.lab_sample_ref}
                  </div>
                )}
              </div>
            );
          })}
          {samples.length > 1 && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
              Arrows compare each sample with the one before it — ▲ index/pH rose, ▼ fell.
            </div>
          )}
        </div>
      ) : (
        <div>
          {samples.length > 1 && (
            <div style={{ marginBottom: 12 }}>
              <div className="label" style={{ marginBottom: 6 }}>Sample</div>
              <select
                value={selected?.id ?? ''}
                onChange={(e) => setSelectedId(e.target.value)}
                style={{ width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--ink)' }}
              >
                {samples.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.sample_date ? fmtDate(s.sample_date) : 'Date not recorded'}{s.id === samples[0].id ? ' (latest)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selected && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
              From sample {selected.sample_date ? `dated ${fmtDate(selected.sample_date)}` : '(date not recorded)'}.
            </div>
          )}

          {micro.texture && (
            <div className="card" style={{ padding: '10px 13px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Soil texture (reported)</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{micro.texture}</span>
            </div>
          )}

          {micro.rows.length === 0 ? (
            <div className="card" style={{ padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
              No extra mineral or micronutrient values were captured for this sample.
            </div>
          ) : (
            (['secondary', 'micro', 'other'] as const).map((g) => {
              const rows = micro.rows.filter((r) => r.group === g);
              if (rows.length === 0) return null;
              return (
                <div key={g} style={{ marginBottom: 12 }}>
                  <div className="label" style={{ marginBottom: 6 }}>{GROUP_TITLES[g]}</div>
                  <div className="card" style={{ padding: '4px 13px' }}>
                    {rows.map((r, idx) => (
                      <div
                        key={r.key}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: idx === 0 ? 'none' : '1px solid var(--line-soft, #ece7da)' }}
                      >
                        <span style={{ fontSize: 13, color: 'var(--ink)' }}>{r.label}</span>
                        <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                          <span className="nutrient-num" style={{ fontWeight: 700 }}>{r.value}</span>
                          {r.unit && <span style={{ fontSize: 11, color: 'var(--muted)' }}> {r.unit}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}

          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
            Captured from the imported report and held for reference. Micronutrient soil indices are a weaker guide than tissue analysis — confirm before acting on them.
          </div>
        </div>
      )}
    </div>
  );
}
