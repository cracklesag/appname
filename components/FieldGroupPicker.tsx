'use client';

import { useState, useTransition } from 'react';
import { Group } from '@/lib/types';
import { setFieldGroup } from '@/lib/actions';

/**
 * Tiny picker for changing the field's group from the detail page.
 * Auto-submits on change — no separate Save button. Uses useTransition
 * to keep the UI responsive and shows a subtle "Saving…" hint while
 * the server action is in flight.
 *
 * If there are no groups defined yet, shows a hint linking to settings
 * instead of an empty dropdown.
 */
export function FieldGroupPicker({
  fieldId,
  currentGroupId,
  groups,
}: {
  fieldId: string;
  currentGroupId: string | null;
  groups: Group[];
}) {
  const [value, setValue] = useState<string>(currentGroupId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: string) {
    if (next === value) return;
    setValue(next);
    setError(null);
    const fd = new FormData();
    fd.set('field_id', fieldId);
    fd.set('group_id', next);
    startTransition(async () => {
      try {
        await setFieldGroup(fd);
      } catch (err) {
        if (err instanceof Error) setError(err.message);
        // Roll back optimistic update on failure
        setValue(currentGroupId ?? '');
      }
    });
  }

  if (groups.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        No groups yet — <a href="/settings/groups" style={{ color: 'var(--forest-dark, #3d5b29)' }}>create one in settings</a>.
      </div>
    );
  }

  return (
    <div>
      <select
        className="select"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={isPending}
        style={{ fontSize: 13 }}
      >
        <option value="">— Ungrouped —</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>{g.name}</option>
        ))}
      </select>
      {isPending && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>
          Saving…
        </div>
      )}
      {error && (
        <div style={{ fontSize: 11, color: 'var(--red, #b85b3a)', marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}
