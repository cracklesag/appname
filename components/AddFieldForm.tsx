'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Save } from 'lucide-react';
import { CutType } from '@/lib/types';
import { CUT_TYPE_LABELS } from '@/lib/rules';
import { createField } from '@/lib/actions';

// Conversion: 1 ha = 2.4711 acres
const ACRES_PER_HA = 2.4711;

export function AddFieldForm() {
  const [name, setName] = useState('');
  const [acres, setAcres] = useState('');
  const [ha, setHa] = useState('');
  const [cutProfile, setCutProfile] = useState<number>(2);
  const [plannedCuts, setPlannedCuts] = useState<CutType[]>(['silage', 'silage']);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Keep acres and ha in sync — flag tracks which field the user is typing in
  const [lastEdited, setLastEdited] = useState<'acres' | 'ha' | null>(null);

  useEffect(() => {
    if (lastEdited === 'acres' && acres !== '') {
      const n = parseFloat(acres);
      if (!isNaN(n)) setHa((n / ACRES_PER_HA).toFixed(2));
    }
  }, [acres, lastEdited]);

  useEffect(() => {
    if (lastEdited === 'ha' && ha !== '') {
      const n = parseFloat(ha);
      if (!isNaN(n)) setAcres((n * ACRES_PER_HA).toFixed(2));
    }
  }, [ha, lastEdited]);

  // Resize plannedCuts when cut profile changes, preserving existing entries
  useEffect(() => {
    setPlannedCuts((prev) => {
      const arr: CutType[] = Array(cutProfile).fill('silage');
      prev.slice(0, cutProfile).forEach((t, i) => { arr[i] = t; });
      return arr;
    });
  }, [cutProfile]);

  const setCutAt = (index: number, type: CutType) =>
    setPlannedCuts((prev) => prev.map((t, i) => (i === index ? type : t)));

  const canSubmit = name.trim().length > 0 && parseFloat(acres) > 0 && parseFloat(ha) > 0 && cutProfile >= 1 && cutProfile <= 4 && !submitting;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      await createField(fd);
      // Server action will redirect on success; if we're still here it's because nothing threw
    } catch (err) {
      // Next.js redirect throws a special object — only show real errors
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) {
        setError(err.message);
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ paddingBottom: 100 }}>
      <input type="hidden" name="acres" value={acres} />
      <input type="hidden" name="ha" value={ha} />
      <input type="hidden" name="cut_profile" value={cutProfile} />
      {plannedCuts.map((t, i) => (
        <input key={i} type="hidden" name={`cut_${i}`} value={t} />
      ))}

      <div style={{ padding: 16 }}>
        {error && (
          <div className="card" style={{ padding: 12, marginBottom: 14, background: 'var(--red-soft)', borderColor: 'var(--red)', color: 'var(--red)', fontSize: 13, fontWeight: 700 }}>
            {error}
          </div>
        )}

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 10 }}>Field details</div>

          <div style={{ marginBottom: 12 }}>
            <div className="label" style={{ fontSize: 11 }}>Field name</div>
            <input
              type="text"
              name="name"
              className="input"
              required
              autoFocus
              maxLength={100}
              placeholder="e.g. Top Meadow"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div className="label" style={{ fontSize: 11 }}>Acres</div>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                className="input"
                placeholder="e.g. 12.5"
                value={acres}
                onChange={(e) => { setAcres(e.target.value); setLastEdited('acres'); }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="label" style={{ fontSize: 11 }}>Hectares</div>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                className="input"
                placeholder="e.g. 5.06"
                value={ha}
                onChange={(e) => { setHa(e.target.value); setLastEdited('ha'); }}
              />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>
            Acres and hectares stay in sync as you type.
          </div>
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 10 }}>Number of cuts this season</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[1, 2, 3, 4].map((n) => {
              const isActive = n === cutProfile;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCutProfile(n)}
                  style={{
                    flex: 1,
                    padding: '14px 8px',
                    border: `1px solid ${isActive ? 'var(--forest)' : 'var(--line)'}`,
                    borderRadius: 4,
                    background: isActive ? 'var(--forest-soft)' : 'var(--card)',
                    color: isActive ? 'var(--forest-dark)' : 'var(--ink-soft)',
                    fontSize: 16,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 10 }}>Plan for each cut</div>
          {plannedCuts.map((type, i) => (
            <div key={i} style={{ marginBottom: 14, paddingBottom: i < plannedCuts.length - 1 ? 14 : 0, borderBottom: i < plannedCuts.length - 1 ? '1px solid var(--line-soft)' : 'none' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>Cut {i + 1}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['silage', 'bales', 'grazing'] as CutType[]).map((key) => {
                  const isActive = key === type;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setCutAt(i, key)}
                      style={{
                        flex: 1,
                        padding: '10px 6px',
                        border: `1px solid ${isActive ? 'var(--forest)' : 'var(--line)'}`,
                        borderRadius: 4,
                        background: isActive ? 'var(--forest-soft)' : 'var(--card)',
                        color: isActive ? 'var(--forest-dark)' : 'var(--ink-soft)',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {CUT_TYPE_LABELS[key]}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>Notes (optional)</div>
          <textarea
            name="notes"
            className="textarea"
            rows={2}
            placeholder="e.g. wet, limited winter access, recently reseeded"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: 16, background: 'linear-gradient(to top, var(--paper) 70%, transparent)', display: 'flex', gap: 10 }}>
        <Link
          href="/"
          className="btn-ghost"
          style={{ flex: 1, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
        >
          Cancel
        </Link>
        <button
          type="submit"
          className="btn-primary"
          style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          disabled={!canSubmit}
        >
          <Save size={18} /> {submitting ? 'Saving…' : 'Add field'}
        </button>
      </div>
    </form>
  );
}
