'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Droplets, Layers, Sprout, Mountain, SprayCan, ClipboardList, Plus, X, type LucideIcon } from 'lucide-react';
import { createJob } from '@/lib/actions';
import type { JobTypeDef } from '@/lib/jobTypes';

const ICONS: Record<string, LucideIcon> = {
  Droplets, Layers, Sprout, Mountain, SprayCan, ClipboardList,
};

interface BField { id: string; name: string; ha: number; boundary: unknown | null; }
interface BProduct { id: number; name: string; type: string; }
interface BSprayProduct { id: string; name: string; default_l_per_ha: number | null; }
interface SprayLine { key: number; productId: string; name: string; lPerHa: string; }

export function JobBuilder({
  jobTypes,
  fields,
  products,
  sprayProducts,
  unitSystem,
}: {
  jobTypes: JobTypeDef[];
  fields: BField[];
  products: BProduct[];
  sprayProducts: BSprayProduct[];
  unitSystem: 'acres' | 'hectares';
}) {
  const [jobTypeId, setJobTypeId] = useState<string>('');
  const def = useMemo(() => jobTypes.find((t) => t.id === jobTypeId), [jobTypes, jobTypeId]);

  const [title, setTitle] = useState('');
  const [productId, setProductId] = useState('');
  const [rate, setRate] = useState('');
  const [water, setWater] = useState('');
  const [sprayLines, setSprayLines] = useState<SprayLine[]>([{ key: 1, productId: '', name: '', lPerHa: '' }]);
  const [instruction, setInstruction] = useState('');
  const [contractor, setContractor] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const areaUnit = unitSystem === 'acres' ? 'ac' : 'ha';
  const toUnit = (ha: number) => (unitSystem === 'acres' ? ha * 2.47105 : ha);
  const sprayById = useMemo(() => new Map(sprayProducts.map((p) => [p.id, p])), [sprayProducts]);

  const productOptions = useMemo(
    () => (def?.productTypes ? products.filter((p) => def.productTypes!.includes(p.type as never)) : []),
    [def, products],
  );

  const toggleField = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = fields.length > 0 && selected.size === fields.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(fields.map((f) => f.id)));

  const setSprayLine = (key: number, patch: Partial<SprayLine>) =>
    setSprayLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addSprayLine = () => setSprayLines((prev) => [...prev, { key: Date.now(), productId: '', name: '', lPerHa: '' }]);
  const removeSprayLine = (key: number) => setSprayLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  const onPickSpray = (key: number, id: string) => {
    const p = id ? sprayById.get(id) : undefined;
    setSprayLine(key, { productId: id, name: p?.name ?? '', lPerHa: (() => {
      const cur = sprayLines.find((l) => l.key === key)?.lPerHa ?? '';
      if (cur.trim() !== '') return cur;
      return p?.default_l_per_ha != null ? String(p.default_l_per_ha) : '';
    })() });
  };

  const spraySpec = sprayLines
    .map((l) => ({ name: l.productId ? (sprayById.get(l.productId)?.name ?? '') : l.name.trim(), spray_product_id: l.productId || null, l_per_ha: l.lPerHa.trim() === '' ? null : Number(l.lPerHa) }))
    .filter((l) => l.name !== '');

  const fieldsPayload = fields
    .filter((f) => selected.has(f.id))
    .map((f) => ({ field_id: f.id, field_name: f.name, boundary: f.boundary ?? null, area_ha: f.ha }));

  const canSubmit = !!def && title.trim() !== '' && selected.size > 0
    && (def.commitsTo !== 'applications' || productId !== '');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      await createJob(fd);
    } catch (err) {
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ paddingBottom: 100 }}>
      <input type="hidden" name="job_type" value={jobTypeId} />
      <input type="hidden" name="fields" value={JSON.stringify(fieldsPayload)} />
      {def?.id === 'spray' && <input type="hidden" name="spray_spec" value={JSON.stringify(spraySpec)} />}
      {def?.defaultUnit && <input type="hidden" name="rate_unit" value={def.defaultUnit} />}

      <div style={{ padding: 16 }}>
        {/* Job type */}
        <div className="label" style={{ marginBottom: 8 }}>Job type</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
          {jobTypes.map((t) => {
            const Icon = ICONS[t.icon] ?? ClipboardList;
            const active = t.id === jobTypeId;
            return (
              <button key={t.id} type="button" onClick={() => { setJobTypeId(t.id); if (!title.trim()) setTitle(t.label); }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 6px', borderRadius: 10, cursor: 'pointer',
                  background: active ? 'var(--forest)' : 'var(--card)', border: `1px solid ${active ? 'var(--forest)' : 'var(--line)'}`,
                  color: active ? 'var(--brand-cream)' : 'var(--ink)' }}>
                <Icon size={20} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>{t.label}</span>
              </button>
            );
          })}
        </div>

        {!def ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Pick a job type to start.</div>
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              <div className="label">Title</div>
              <input type="text" name="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. First slurry — silage ground" maxLength={120} required />
            </div>

            {/* Instruction by type */}
            {def.commitsTo === 'applications' && (
              <div className="card" style={{ padding: 14, marginBottom: 14 }}>
                <div className="label" style={{ marginBottom: 8 }}>What to apply</div>
                <select className="input" name="product_id" value={productId} onChange={(e) => setProductId(e.target.value)} style={{ marginBottom: 10 }} required>
                  <option value="">Choose {def.label.toLowerCase()}…</option>
                  {productOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {productOptions.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>No {def.label.toLowerCase()} products yet — add one in your products list first.</div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="number" name="rate_value" className="input" inputMode="decimal" step="any" min="0" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="rate" style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, color: 'var(--muted)', width: 70 }}>{def.rateNoun}</span>
                </div>
              </div>
            )}

            {def.id === 'spray' && (
              <div className="card" style={{ padding: 14, marginBottom: 14 }}>
                <div className="label" style={{ marginBottom: 8 }}>Spray{sprayLines.length > 1 ? 's' : ''} to apply</div>
                {sprayLines.map((l) => (
                  <div key={l.key} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      {sprayProducts.length > 0 ? (
                        <select className="input" value={l.productId} onChange={(e) => onPickSpray(l.key, e.target.value)} style={{ flex: 1 }}>
                          <option value="">Other (type below)</option>
                          {sprayProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      ) : null}
                      {sprayLines.length > 1 && (
                        <button type="button" onClick={() => removeSprayLine(l.key)} aria-label="Remove" style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--muted)', cursor: 'pointer', padding: '0 10px' }}><X size={15} /></button>
                      )}
                    </div>
                    {l.productId === '' && (
                      <input type="text" className="input" value={l.name} onChange={(e) => setSprayLine(l.key, { name: e.target.value })} placeholder="Spray name" maxLength={120} style={{ marginBottom: 8 }} />
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="number" className="input" inputMode="decimal" step="any" min="0" value={l.lPerHa} onChange={(e) => setSprayLine(l.key, { lPerHa: e.target.value })} placeholder="rate" style={{ flex: 1 }} />
                      <span style={{ fontSize: 12, color: 'var(--muted)', width: 70 }}>L/ha</span>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={addSprayLine} className="btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', marginBottom: 10 }}>
                  <Plus size={15} /> Add another spray
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="number" name="water_l_per_ha" className="input" inputMode="decimal" step="any" min="0" value={water} onChange={(e) => setWater(e.target.value)} placeholder="water rate" style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, color: 'var(--muted)', width: 70 }}>L/ha water</span>
                </div>
              </div>
            )}

            {def.id === 'generic' && (
              <div style={{ marginBottom: 14 }}>
                <div className="label">Instruction</div>
                <textarea name="instruction" className="input" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Describe the job…" rows={3} maxLength={500} style={{ resize: 'vertical' }} />
              </div>
            )}

            {/* Fields */}
            <div className="card" style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div className="label" style={{ margin: 0 }}>Fields <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--muted)' }}>· {selected.size} selected</span></div>
                {fields.length > 0 && <button type="button" onClick={toggleAll} className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }}>{allSelected ? 'Clear' : 'All'}</button>}
              </div>
              {fields.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>No fields with boundaries yet — add them on the Farm map first.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {fields.map((f) => {
                    const on = selected.has(f.id);
                    return (
                      <button key={f.id} type="button" onClick={() => toggleField(f.id)}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 4px', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${on ? 'var(--forest)' : 'var(--stone)'}`, background: on ? 'var(--forest)' : 'transparent', color: 'var(--brand-cream)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>{on ? '✓' : ''}</span>
                          <span style={{ fontSize: 14, color: 'var(--ink)' }}>{f.name}</span>
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{toUnit(f.ha).toFixed(2)} {areaUnit}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Recipient (free-text for now; share link & accounts come next) */}
            <div style={{ marginBottom: 14 }}>
              <div className="label">Who&apos;s it for <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--muted)' }}>· optional</span></div>
              <input type="text" name="contractor_label" className="input" value={contractor} onChange={(e) => setContractor(e.target.value)} placeholder="e.g. a contractor or staff name" maxLength={120} />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>Sending by share-link or to someone&apos;s app is coming next — for now this just labels the sheet.</div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <div className="label">Due date <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--muted)' }}>· optional</span></div>
                <input type="date" name="due_date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>

            <div style={{ marginBottom: 4 }}>
              <div className="label">Notes <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--muted)' }}>· optional</span></div>
              <input type="text" name="notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="anything else the operator should know" maxLength={240} />
            </div>
          </>
        )}
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: '0 16px 16px', background: 'linear-gradient(to top, var(--paper) 70%, transparent)' }}>
        {error && <div style={{ marginBottom: 10, padding: 10, background: 'var(--red-soft, #ffe5e5)', color: 'var(--red, #b00)', fontSize: 13, borderRadius: 6 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/jobs" className="btn-ghost" style={{ flex: 1, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Cancel</Link>
          <button type="submit" className="btn-primary" style={{ flex: 2 }} disabled={!canSubmit || submitting}>{submitting ? 'Creating…' : 'Create job sheet'}</button>
        </div>
      </div>
    </form>
  );
}
