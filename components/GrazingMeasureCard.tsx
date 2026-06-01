'use client';

import { useState } from 'react';
import { GrazingEventForm } from '@/components/GrazingEventForm';
import { PlateReadingForm } from '@/components/PlateReadingForm';

interface FieldOpt { id: string; name: string; }

export function GrazingMeasureCard({ fields, todayISO }: { fields: FieldOpt[]; todayISO: string }) {
  const [tab, setTab] = useState<'graze' | 'cover'>('graze');

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {([['graze', 'Log a grazing'], ['cover', 'Log a cover reading']] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            style={{
              flex: 1, padding: '8px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, cursor: 'pointer',
              background: tab === k ? 'var(--forest)' : 'var(--card)',
              color: tab === k ? '#fff' : 'var(--ink-soft)',
              border: `1px solid ${tab === k ? 'var(--forest)' : 'var(--line)'}`,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'graze' ? (
        <>
          <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
            Record what was on the paddock and what was left after grazing. The difference is the grass that
            grew and got eaten — this builds the measured “grass grown” figure for the field-history report.
          </p>
          <GrazingEventForm fields={fields} todayISO={todayISO} />
        </>
      ) : (
        <>
          <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
            Record a paddock’s standing cover (what the plate meter shows). Useful for tracking growth between
            grazings and seeing the current wedge.
          </p>
          <PlateReadingForm fields={fields} todayISO={todayISO} />
        </>
      )}
    </div>
  );
}
