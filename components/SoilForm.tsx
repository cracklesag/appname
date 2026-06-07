'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Save } from 'lucide-react';
import { Field, GrassSystem, SoilType } from '@/lib/types';
import { SOIL_TYPE_LABELS } from '@/lib/rules';
import { saveSoil } from '@/lib/actions';
import { validatePH, validateSoilIndex } from '@/lib/validation';
import { InlineWarning, ErrorBanner } from './InlineWarning';

export function SoilForm({
  field,
  grassSystems,
  hiddenGrassSystemIds,
  returnTo,
}: {
  field: Field;
  grassSystems: GrassSystem[];
  hiddenGrassSystemIds: string[];
  returnTo?: string;
}) {
  const today = new Date().toISOString().slice(0, 7);  // YYYY-MM

  // Existing sample_date may be a full date (legacy) or already YYYY-MM-01
  // from a month-picker save. Strip down to YYYY-MM for the input.
  const initialMonth = field.sample_date ? field.sample_date.slice(0, 7) : today;
  const [sampleMonth, setSampleMonth] = useState(initialMonth);
  const [ph, setPh] = useState(field.ph != null ? String(field.ph) : '');
  const [pIdx, setPIdx] = useState(field.p_idx != null ? String(field.p_idx) : '');
  const [kIdx, setKIdx] = useState(field.k_idx != null ? String(field.k_idx) : '');
  const [mgIdx, setMgIdx] = useState(field.mg_idx != null ? String(field.mg_idx) : '');
  const [soilType, setSoilType] = useState<SoilType>(field.soil_type || 'medium_loam');
  // Grass system — include the currently-assigned system even if it's
  // hidden, so the user can see what they have and switch away from a
  // hidden custom they no longer want.
  const visibleGrassSystems = useMemo(() => {
    const hidden = new Set(hiddenGrassSystemIds);
    return grassSystems.filter((s) => !hidden.has(s.id) || s.id === field.grass_system_id);
  }, [grassSystems, hiddenGrassSystemIds, field.grass_system_id]);
  const [grassSystemId, setGrassSystemId] = useState<string>(field.grass_system_id ?? '');
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
      {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
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
            <div style={{ flex: 1 }}>
              <div className="label" style={{ fontSize: 11 }}>Mg idx</div>
              <input
                type="number" step="0.1" inputMode="decimal" name="mg_idx"
                className="input" placeholder="opt."
                value={mgIdx} onChange={(e) => setMgIdx(e.target.value)}
              />
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 5 }}>
            Mg index is optional — it picks magnesian vs calcium lime on the lime report (Index 0–1 → magnesian).
          </div>
          <InlineWarning warning={phWarning ?? pIdxWarning ?? kIdxWarning} />
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>Soil type</div>
          <select
            name="soil_type"
            className="select"
            value={soilType}
            onChange={(e) => setSoilType(e.target.value as SoilType)}
          >
            {(Object.entries(SOIL_TYPE_LABELS) as [SoilType, string][]).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>
            {soilType === 'light_sand' && 'K target bumped by ~13 kg K₂O/ha per cut. Sulphur risk flag in reports.'}
            {soilType === 'medium_loam' && 'Default — no special adjustments.'}
            {soilType === 'heavy_clay' && 'Cold-clay N timing nudge in early-spring reports.'}
            {soilType === 'deep_silt' && 'Treated as loam — no special adjustments.'}
          </div>
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>Grass system</div>
          <select
            name="grass_system_id"
            className="select"
            value={grassSystemId}
            onChange={(e) => setGrassSystemId(e.target.value)}
          >
            {visibleGrassSystems.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {(() => {
            const selected = grassSystems.find((s) => s.id === grassSystemId);
            if (!selected?.description) return null;
            return (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>
                {selected.description}
              </div>
            );
          })()}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
            <Link href="/settings/grass-systems" style={{ color: 'var(--forest-dark, #3d5b29)' }}>
              Manage available systems
            </Link>
          </div>
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
          <Link href={returnTo || `/fields/${field.id}`} className="btn-ghost" style={{ flex: 1, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Cancel</Link>
          <button type="submit" className="btn-primary" style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} disabled={submitting}>
            <Save size={18} /> {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  );
}
