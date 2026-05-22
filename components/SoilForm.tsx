'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Save } from 'lucide-react';
import { Field } from '@/lib/types';
import { saveSoil } from '@/lib/actions';
import { validatePH, validateSoilIndex } from '@/lib/validation';
import { InlineWarning, ErrorBanner } from './InlineWarning';

export function SoilForm({ field }: { field: Field }) {
  const today = new Date().toISOString().slice(0, 7);  // YYYY-MM

  // Existing sample_date may be a full date (legacy) or already YYYY-MM-01
  // from a month-picker save. Strip down to YYYY-MM for the input.
  const initialMonth = field.sample_date ? field.sample_date.slice(0, 7) : today;
  const [sampleMonth, setSampleMonth] = useState(initialMonth);
  const [ph, setPh] = useState(field.ph != null ? String(field.ph) : '');
  const [pIdx, setPIdx] = useState(field.p_idx != null ? String(field.p_idx) : '');
  const [kIdx, setKIdx] = useState(field.k_idx != null ? String(field.k_idx) : '');
  const [lastPloughed, setLastPloughed] = useState(field.last_ploughed ?? '');
  const [lastReseeded, setLastReseeded] = useState(field.last_reseeded ?? '');
  const [notes, setNotes] = useState(field.notes ?? '');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const phNum = ph === '' ? null : parseFloat(ph);
  const pIdxNum = pIdx === '' ? null : parseFloat(pIdx);
  const kIdxNum = kIdx === '' ? null : parseFloat(kIdx);

  const phWarning   = useMemo(() => validatePH(phNum), [phNum]);
  const pIdxWarning = useMemo(() => validateSoilIndex(pIdxNum, 'P'), [pIdxNum]);
  const kIdxWarning = useMemo(() => validateSoilIndex(kIdxNum, 'K'), [kIdxNum]);
  // Sample month validation: empty is fine; future months are an error.
  const sampleMonthWarning = useMemo(() => {
    if (!sampleMonth) return null;
    return sampleMonth > today
      ? { kind: 'error' as const, message: 'Sample month cannot be in the future.' }
      : null;
  }, [sampleMonth, today]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    // Convert YYYY-MM → YYYY-MM-01 so the DB date column accepts it.
    const month = String(fd.get('sample_month') || '');
    fd.delete('sample_month');
    if (month) fd.set('sample_date', `${month}-01`);
    try {
      await saveSoil(fd);
    } catch (err) {
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) {
        setSubmitError(err.message);
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ paddingBottom: 100 }}>
      <input type="hidden" name="field_id" value={field.id} />
      <div style={{ padding: 16 }}>
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 10 }}>Latest soil analysis</div>
          <div style={{ marginBottom: 12 }}>
            <div className="label" style={{ fontSize: 11 }}>Sample month</div>
            <input
              type="month" name="sample_month" className="input"
              value={sampleMonth} onChange={(e) => setSampleMonth(e.target.value)}
              max={today}
            />
            <InlineWarning warning={sampleMonthWarning} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div className="label" style={{ fontSize: 11 }}>pH</div>
              <input
                type="number" step="0.1" inputMode="decimal" name="ph"
                className="input" placeholder="e.g. 5.8"
                value={ph} onChange={(e) => setPh(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="label" style={{ fontSize: 11 }}>P idx</div>
              <input
                type="number" step="0.1" inputMode="decimal" name="p_idx"
                className="input" placeholder="e.g. 2.5"
                value={pIdx} onChange={(e) => setPIdx(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="label" style={{ fontSize: 11 }}>K idx</div>
              <input
                type="number" step="0.1" inputMode="decimal" name="k_idx"
                className="input" placeholder="e.g. 2.0"
                value={kIdx} onChange={(e) => setKIdx(e.target.value)}
              />
            </div>
          </div>
          <InlineWarning warning={phWarning ?? pIdxWarning ?? kIdxWarning} />
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 10 }}>Field events</div>
          <div style={{ marginBottom: 12 }}>
            <div className="label" style={{ fontSize: 11 }}>Last ploughed</div>
            <input
              type="date" name="last_ploughed" className="input"
              value={lastPloughed} onChange={(e) => setLastPloughed(e.target.value)}
            />
          </div>
          <div>
            <div className="label" style={{ fontSize: 11 }}>Last reseeded</div>
            <input
              type="date" name="last_reseeded" className="input"
              value={lastReseeded} onChange={(e) => setLastReseeded(e.target.value)}
            />
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>Field notes</div>
          <textarea
            name="notes" className="textarea" rows={3}
            placeholder="Anything to remember about this field…"
            value={notes} onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: '0 16px 16px', background: 'linear-gradient(to top, var(--paper) 70%, transparent)' }}>
        <ErrorBanner error={submitError} />
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href={`/fields/${field.id}`} className="btn-ghost" style={{ flex: 1, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Cancel</Link>
          <button type="submit" className="btn-primary" style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} disabled={submitting}>
            <Save size={18} /> {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  );
}
