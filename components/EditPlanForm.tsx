'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Save } from 'lucide-react';
import { CutType, Field } from '@/lib/types';
import { CUT_TYPE_LABELS, getPlannedCuts } from '@/lib/rules';
import { savePlan } from '@/lib/actions';

export function EditPlanForm({ field, returnTo }: { field: Field; returnTo?: string }) {
  const [cutProfile, setCutProfile] = useState<number>(field.cut_profile || 1);
  const initialPlanned = getPlannedCuts(field);
  const [plannedCuts, setPlannedCuts] = useState<CutType[]>(() => {
    const arr: CutType[] = Array(cutProfile).fill('silage');
    initialPlanned.slice(0, cutProfile).forEach((t, i) => { arr[i] = t; });
    return arr;
  });

  useEffect(() => {
    setPlannedCuts((prev) => {
      const arr: CutType[] = Array(cutProfile).fill('silage');
      prev.slice(0, cutProfile).forEach((t, i) => { arr[i] = t; });
      return arr;
    });
  }, [cutProfile]);

  const setCutAt = (index: number, type: CutType) =>
    setPlannedCuts((prev) => prev.map((t, i) => (i === index ? type : t)));

  return (
    <form action={savePlan} style={{ paddingBottom: 100 }}>
      <input type="hidden" name="field_id" value={field.id} />
      {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
      <input type="hidden" name="cut_profile" value={cutProfile} />
      {plannedCuts.map((t, i) => (
        <input key={i} type="hidden" name={`cut_${i}`} value={t} />
      ))}

      <div style={{ padding: 16 }}>
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
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, fontStyle: 'italic' }}>
            Changing this resizes the plan. Existing entries are preserved where they fit.
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
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
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: 16, background: 'linear-gradient(to top, var(--paper) 70%, transparent)', display: 'flex', gap: 10 }}>
        <Link href={returnTo || `/fields/${field.id}`} className="btn-ghost" style={{ flex: 1, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Cancel</Link>
        <button type="submit" className="btn-primary" style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Save size={18} /> Save plan
        </button>
      </div>
    </form>
  );
}
