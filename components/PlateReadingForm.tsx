'use client';

import { useState, useTransition } from 'react';
import { Ruler, Check } from 'lucide-react';
import { logPlateReading } from '@/lib/actions';
import { coverFromHeightCm } from '@/lib/rules';

interface FieldOpt { id: string; name: string; }

export function PlateReadingForm({ fields, todayISO }: { fields: FieldOpt[]; todayISO: string }) {
  const [pending, start] = useTransition();
  const [fieldId, setFieldId] = useState('');
  const [date, setDate] = useState(todayISO);
  const [mode, setMode] = useState<'cover' | 'height'>('cover');
  const [cover, setCover] = useState('');
  const [height, setHeight] = useState('');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live cover preview when entering height.
  const heightCover = height ? coverFromHeightCm(parseFloat(height)) : null;

  function submit() {
    setError(null);
    const coverValue = mode === 'cover'
      ? cover
      : (heightCover != null ? String(heightCover) : '');
    if (!fieldId) { setError('Pick a field'); return; }
    if (!coverValue) { setError(mode === 'cover' ? 'Enter the cover' : 'Enter the height'); return; }

    const fd = new FormData();
    fd.set('field_id', fieldId);
    fd.set('reading_date', date);
    fd.set('cover_kg_dm_ha', coverValue);
    if (mode === 'height' && height) fd.set('height_cm', height);
    fd.set('note', note);

    start(async () => {
      try {
        await logPlateReading(fd);
        setSaved(true);
        setCover(''); setHeight(''); setNote('');
        setTimeout(() => setSaved(false), 2200);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save');
      }
    });
  }

  if (fields.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--muted)' }}>
        Add a field first, then you can log plate-meter readings here.
      </div>
    );
  }

  return (
    <div>
      <div className="label" style={{ marginBottom: 5 }}>Field</div>
      <select className="select" value={fieldId} onChange={(e) => setFieldId(e.target.value)} style={{ fontSize: 14, marginBottom: 12 }}>
        <option value="">— Pick a field —</option>
        {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>

      <div className="label" style={{ marginBottom: 5 }}>Date</div>
      <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} style={{ fontSize: 14, marginBottom: 12 }} />

      {/* Cover vs height toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {(['cover', 'height'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            style={{
              flex: 1, padding: '7px', fontSize: 12.5, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
              background: mode === m ? 'var(--forest)' : 'var(--card)',
              color: mode === m ? '#fff' : 'var(--ink-soft)',
              border: `1px solid ${mode === m ? 'var(--forest)' : 'var(--line)'}`,
            }}
          >
            {m === 'cover' ? 'Cover (kg DM/ha)' : 'Height (cm)'}
          </button>
        ))}
      </div>

      {mode === 'cover' ? (
        <>
          <input
            type="number" inputMode="numeric" className="input"
            placeholder="e.g. 2400"
            value={cover} onChange={(e) => setCover(e.target.value)}
            style={{ fontSize: 14 }}
          />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            What your plate meter shows for this paddock, in kg DM/ha.
          </div>
        </>
      ) : (
        <>
          <div style={{ position: 'relative' }}>
            <Ruler size={15} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--muted)' }} />
            <input
              type="number" inputMode="decimal" className="input"
              placeholder="e.g. 8"
              value={height} onChange={(e) => setHeight(e.target.value)}
              style={{ fontSize: 14, paddingLeft: 32 }}
            />
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {heightCover != null ? `≈ ${heightCover.toLocaleString()} kg DM/ha` : 'Compressed sward height in cm.'} (rough conversion)
          </div>
        </>
      )}

      <div className="label" style={{ margin: '12px 0 5px' }}>Note (optional)</div>
      <input type="text" className="input" maxLength={120} placeholder="e.g. pre-grazing" value={note} onChange={(e) => setNote(e.target.value)} style={{ fontSize: 14 }} />

      {error && <div style={{ fontSize: 12, color: 'var(--red, #b85b3a)', marginTop: 10 }}>{error}</div>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="btn-primary"
        style={{ width: '100%', padding: '11px', fontSize: 14, fontWeight: 700, marginTop: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
      >
        {saved ? <><Check size={16} /> Saved</> : pending ? 'Saving…' : 'Log reading'}
      </button>
    </div>
  );
}
