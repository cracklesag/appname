'use client';

import { useState, useTransition } from 'react';
import { NextAction } from '@/lib/types';
import { setCutNextAction } from '@/lib/actions';

const LABELS: Record<NextAction, string> = {
  another_cut_silage:  'Another silage cut',
  another_cut_bales:   'Another bales cut',
  rotational_grazing:  'Rotational grazing',
  maintenance_grazing: 'Maintenance — one fert top-up then leave',
};

/**
 * Inline picker for the field detail page. Updates the `next_action` field
 * on the cut id passed in. When no cuts have been logged this season for
 * the field, `cutId` is null and the picker is disabled with a hint.
 *
 * The cut id is the MOST RECENT cut for the field, since "what's next" is
 * a per-cut value and the most recent one is the authoritative source.
 */
export function NextActionPicker({
  cutId,
  fieldId,
  current,
}: {
  cutId: string | null;
  fieldId: string;
  current: NextAction | null;
}) {
  const [value, setValue] = useState<NextAction | ''>(current ?? '');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!cutId) {
    return (
      <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
        Set this when you log the first cut of the season.
      </div>
    );
  }

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as NextAction | '';
    setValue(next);
    if (!next) return;
    setError(null);
    const fd = new FormData();
    fd.set('cut_id', cutId!);
    fd.set('field_id', fieldId);
    fd.set('next_action', next);
    startTransition(async () => {
      try {
        await setCutNextAction(fd);
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      }
    });
  }

  return (
    <div>
      <select
        className="select"
        value={value}
        onChange={handleChange}
        disabled={isPending}
        style={{ width: '100%' }}
      >
        <option value="" disabled>Pick what&apos;s next…</option>
        {(['another_cut_silage', 'another_cut_bales', 'rotational_grazing', 'maintenance_grazing'] as NextAction[]).map((k) => (
          <option key={k} value={k}>{LABELS[k]}</option>
        ))}
      </select>
      {error && (
        <div style={{ fontSize: 11, color: 'var(--red, #b85b3a)', marginTop: 4 }}>{error}</div>
      )}
    </div>
  );
}
