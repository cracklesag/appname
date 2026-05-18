'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Save, Scissors } from 'lucide-react';
import { Cut, CutType, Field, Settings, YieldClass } from '@/lib/types';
import {
  CUT_TYPE_LABELS, displayBagAmount, fmt, getOfftakeForCut, YIELD_CLASS_LABELS,
} from '@/lib/rules';
import { saveCut, updateCut } from '@/lib/actions';
import { validateDate } from '@/lib/validation';
import { InlineWarning, ErrorBanner } from './InlineWarning';

export function LogCutForm({
  field, settings, nextCutNumber, plannedType, existing,
}: {
  field: Field;
  settings: Settings;
  nextCutNumber: number;
  plannedType: CutType;
  existing?: Cut;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = !!existing;
  const cutNumberForRules = existing ? existing.cut_number : nextCutNumber;

  const [date, setDate] = useState(existing?.cut_date ?? today);
  const [cutType, setCutType] = useState<CutType>(existing?.cut_type ?? plannedType);
  const [yieldClass, setYieldClass] = useState<YieldClass>(existing?.yield_class ?? 'average');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const offtake = getOfftakeForCut(field.cut_profile, cutNumberForRules, yieldClass, settings, cutType);
  const baseOfftake = getOfftakeForCut(field.cut_profile, cutNumberForRules, 'average', settings, cutType);

  const dateWarning = useMemo(() => validateDate(date), [date]);
  const canSave = !!date && dateWarning?.kind !== 'error' && !submitting;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      if (isEdit) {
        await updateCut(fd);
      } else {
        await saveCut(fd);
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) {
        setSubmitError(err.message);
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ paddingBottom: 100 }}>
      {isEdit && existing && <input type="hidden" name="id" value={existing.id} /> }
      <input type="hidden" name="field_id" value={field.id} />
      <input type="hidden" name="cut_number" value={cutNumberForRules} />
      <input type="hidden" name="cut_type" value={cutType} />
      <input type="hidden" name="yield_class" value={yieldClass} />

      <div style={{ padding: 16 }}>
        <div className="card" style={{ padding: 14, marginBottom: 14, background: 'var(--amber-soft)', borderColor: 'var(--amber)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Scissors size={20} style={{ color: 'var(--amber)' }} />
            <div>
              <div style={{ fontSize: 13, color: 'var(--amber)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {isEdit ? `Editing cut ${cutNumberForRules}` : `Logging cut ${nextCutNumber} of ${field.cut_profile}`}
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                {isEdit ? 'Changes apply on save' : 'This resets the "since last cut" tracker'}
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div className="label">Cut date</div>
          <input type="date" name="cut_date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
          <InlineWarning warning={dateWarning} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div className="label">Cut type</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['silage', 'bales', 'grazing'] as CutType[]).map((key) => {
              const isActive = key === cutType;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCutType(key)}
                  style={{
                    flex: 1,
                    padding: '12px 8px',
                    border: `1px solid ${isActive ? 'var(--forest)' : 'var(--line)'}`,
                    borderRadius: 4,
                    background: isActive ? 'var(--forest-soft)' : 'var(--card)',
                    color: isActive ? 'var(--forest-dark)' : 'var(--ink-soft)',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {CUT_TYPE_LABELS[key]}
                </button>
              );
            })}
          </div>
          {plannedType !== cutType && (
            <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 6, fontStyle: 'italic' }}>
              Differs from planned ({CUT_TYPE_LABELS[plannedType]}). The plan can be updated on the field screen.
            </div>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <div className="label">How heavy was the cut?</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['light', 'average', 'heavy'] as YieldClass[]).map((key) => {
              const isActive = key === yieldClass;
              const mult = settings.yieldMultipliers[key] ?? 1;
              const typeMult = settings.cutTypeMultipliers[cutType] ?? 1;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setYieldClass(key)}
                  style={{
                    flex: 1,
                    padding: '14px 8px',
                    border: `1px solid ${isActive ? 'var(--forest)' : 'var(--line)'}`,
                    borderRadius: 4,
                    background: isActive ? 'var(--forest-soft)' : 'var(--card)',
                    color: isActive ? 'var(--forest-dark)' : 'var(--ink-soft)',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span>{YIELD_CLASS_LABELS[key]}</span>
                  <span className="nutrient-num" style={{ fontSize: 11, fontWeight: 400, color: isActive ? 'var(--forest-dark)' : 'var(--muted)' }}>
                    {(baseOfftake.baseYieldDM * mult * typeMult).toFixed(1)} t DM/ha
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div className="label">Notes (optional)</div>
          <textarea name="notes" className="textarea" rows={2} placeholder="Bale count, conditions, wilt time…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div className="label">Estimated net offtake</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            {fmt(offtake.yieldDM, 1)} t DM/ha · {CUT_TYPE_LABELS[cutType]} · cut {nextCutNumber} of {field.cut_profile}
            {cutType === 'grazing' && ` · ${Math.round((settings.grazingReturnPct ?? 0.70) * 100)}% returned via dung/urine`}
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            {(() => {
              const nView = displayBagAmount(offtake.n,    settings.bagFertUnit);
              const pView = displayBagAmount(offtake.p2o5, settings.bagFertUnit);
              const kView = displayBagAmount(offtake.k2o,  settings.bagFertUnit);
              return (
                <>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>N</div>
                    <div className="nutrient-num" style={{ fontSize: 20, color: 'var(--ink)' }}>{fmt(nView.value)}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{nView.unit}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>P₂O₅</div>
                    <div className="nutrient-num" style={{ fontSize: 20, color: 'var(--ink)' }}>{fmt(pView.value)}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{pView.unit}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>K₂O</div>
                    <div className="nutrient-num" style={{ fontSize: 20, color: 'var(--ink)' }}>{fmt(kView.value)}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{kView.unit}</div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: '0 16px 16px', background: 'linear-gradient(to top, var(--paper) 70%, transparent)' }}>
        <ErrorBanner error={submitError} />
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href={`/fields/${field.id}`} className="btn-ghost" style={{ flex: 1, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Cancel</Link>
          <button type="submit" className="btn-primary" style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} disabled={!canSave}>
            <Save size={18} /> {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save cut'}
          </button>
        </div>
      </div>
    </form>
  );
}
