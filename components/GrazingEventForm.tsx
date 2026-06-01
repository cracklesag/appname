'use client';

import { useState, useTransition } from 'react';
import { Check } from 'lucide-react';
import { logGrazingEvent } from '@/lib/actions';

interface FieldOpt { id: string; name: string; }
interface LatestCover { cover: number; date: string; }

const DEFAULT_RESIDUAL = 1550; // typical dairy post-grazing residual (~4 cm)

function daysAgo(iso: string): number {
  return Math.round((Date.now() - new Date(iso + 'T00:00:00').getTime()) / 86400000);
}

export function GrazingEventForm({
  fields, todayISO, latestCoverByField,
}: {
  fields: FieldOpt[];
  todayISO: string;
  latestCoverByField: Record<string, LatestCover>;
}) {
  const [pending, start] = useTransition();
  const [fieldId, setFieldId] = useState('');
  const [date, setDate] = useState(todayISO);
  const [residual, setResidual] = useState(String(DEFAULT_RESIDUAL));
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = fieldId ? latestCoverByField[fieldId] : undefined;
  const resN = parseFloat(residual);
  const removed = latest && isFinite(resN) && latest.cover >= resN
    ? Math.round(latest.cover - resN)
    : null;

  function submit() {
    setError(null);
    if (!fieldId) { setError('Pick a field'); return; }
    if (!residual) { setError('Enter the residual left after grazing'); return; }
    const fd = new FormData();
    fd.set('field_id', fieldId);
    fd.set('graze_date', date);
    fd.set('post_cover_kg_dm_ha', residual);
    fd.set('note', note);
    start(async () => {
      try {
        await logGrazingEvent(fd);
        setSaved(true);
        setNote('');
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

      <div className="label" style={{ marginBottom: 5 }}>Residual left after grazing</div>
      <input type="number" inputMode="numeric" className="input" placeholder={String(DEFAULT_RESIDUAL)} value={residual} onChange={(e) => setResidual(e.target.value)} style={{ fontSize: 14 }} />
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.45 }}>
        kg DM/ha grazed down to. A typical dairy residual is ~1500–1600 (≈4 cm). Pre-set, change if needed.
      </div>

      {/* Derived pre-grazing cover from the latest walk */}
      {fieldId && (
        latest ? (
          <div style={{ fontSize: 12, color: removed != null ? 'var(--forest-dark)' : 'var(--muted)', background: removed != null ? 'var(--forest-soft, #e7efe2)' : 'var(--paper-deep, #F4EFE2)', borderRadius: 7, padding: '8px 10px', marginTop: 10, lineHeight: 1.45 }}>
            Last cover reading: <strong>{latest.cover.toLocaleString()} kg DM/ha</strong> ({daysAgo(latest.date) <= 0 ? 'today' : `${daysAgo(latest.date)} days ago`}).
            {removed != null
              ? <> Grass removed ≈ <strong>{removed.toLocaleString()} kg DM/ha</strong>.</>
              : <> Residual is above the last reading — check the figures.</>}
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: '#6B5616', background: '#FBF1D9', border: '1px solid #E8D08A', borderRadius: 7, padding: '8px 10px', marginTop: 10, lineHeight: 1.45 }}>
            No cover reading yet for this field. Log a cover reading (the “Log a cover reading” tab) so the grass-removed and growth figures can be worked out.
          </div>
        )
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
