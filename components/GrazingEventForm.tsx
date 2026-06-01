'use client';

import { useState, useTransition } from 'react';
import { Check } from 'lucide-react';
import { logGrazingEvent } from '@/lib/actions';

interface FieldOpt { id: string; name: string; }

export function GrazingEventForm({ fields, todayISO }: { fields: FieldOpt[]; todayISO: string }) {
  const [pending, start] = useTransition();
  const [fieldId, setFieldId] = useState('');
  const [date, setDate] = useState(todayISO);
  const [pre, setPre] = useState('');
  const [post, setPost] = useState('');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preN = parseFloat(pre);
  const postN = parseFloat(post);
  const offtake = isFinite(preN) && isFinite(postN) && preN >= postN ? Math.round(preN - postN) : null;

  function submit() {
    setError(null);
    if (!fieldId) { setError('Pick a field'); return; }
    if (!pre) { setError('Enter the pre-grazing cover'); return; }
    if (!post) { setError('Enter the post-grazing residual'); return; }
    if (isFinite(preN) && isFinite(postN) && postN > preN) {
      setError('Residual is higher than pre-grazing cover — check the figures.'); return;
    }
    const fd = new FormData();
    fd.set('field_id', fieldId);
    fd.set('graze_date', date);
    fd.set('pre_cover_kg_dm_ha', pre);
    fd.set('post_cover_kg_dm_ha', post);
    fd.set('note', note);
    start(async () => {
      try {
        await logGrazingEvent(fd);
        setSaved(true);
        setPre(''); setPost(''); setNote('');
        setTimeout(() => setSaved(false), 2200);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save');
      }
    });
  }

  if (fields.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--muted)' }}>Add a field first, then you can log grazings here.</div>;
  }

  return (
    <div>
      <div className="label" style={{ marginBottom: 5 }}>Field</div>
      <select className="select" value={fieldId} onChange={(e) => setFieldId(e.target.value)} style={{ fontSize: 14, marginBottom: 12 }}>
        <option value="">— Pick a field —</option>
        {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>

      <div className="label" style={{ marginBottom: 5 }}>Date grazed</div>
      <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} style={{ fontSize: 14, marginBottom: 12 }} />

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className="label" style={{ marginBottom: 5 }}>Pre-grazing cover</div>
          <input type="number" inputMode="numeric" className="input" placeholder="2800" value={pre} onChange={(e) => setPre(e.target.value)} style={{ fontSize: 14 }} />
          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3 }}>kg DM/ha going in</div>
        </div>
        <div style={{ flex: 1 }}>
          <div className="label" style={{ marginBottom: 5 }}>Residual left</div>
          <input type="number" inputMode="numeric" className="input" placeholder="1600" value={post} onChange={(e) => setPost(e.target.value)} style={{ fontSize: 14 }} />
          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3 }}>kg DM/ha after</div>
        </div>
      </div>

      {offtake != null && (
        <div style={{ fontSize: 12, color: 'var(--forest-dark)', background: 'var(--forest-soft, #e7efe2)', borderRadius: 7, padding: '7px 10px', marginTop: 10, fontWeight: 600 }}>
          Grass removed: {offtake.toLocaleString()} kg DM/ha
        </div>
      )}

      <div className="label" style={{ margin: '12px 0 5px' }}>Note (optional)</div>
      <input type="text" className="input" maxLength={120} placeholder="e.g. main cow group, 2 days" value={note} onChange={(e) => setNote(e.target.value)} style={{ fontSize: 14 }} />

      {error && <div style={{ fontSize: 12, color: 'var(--red, #b85b3a)', marginTop: 10 }}>{error}</div>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="btn-primary"
        style={{ width: '100%', padding: '11px', fontSize: 14, fontWeight: 700, marginTop: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
      >
        {saved ? <><Check size={16} /> Saved</> : pending ? 'Saving…' : 'Log grazing'}
      </button>
    </div>
  );
}
