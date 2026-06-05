'use client';

import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { deleteFieldEvent } from '@/lib/actions';

export function DeleteFieldEventButton({ eventId, fieldId }: { eventId: string; fieldId: string }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function doDelete() {
    setError(null);
    const fd = new FormData();
    fd.set('id', eventId);
    fd.set('field_id', fieldId);
    start(async () => {
      try {
        await deleteFieldEvent(fd);
        // On success the action revalidates and the row disappears.
      } catch (e) {
        if (e instanceof Error && !e.message.includes('NEXT_REDIRECT')) {
          setError(e.message);
          setConfirming(false);
        }
      }
    });
  }

  if (error) {
    return (
      <button
        type="button"
        onClick={() => setError(null)}
        className="btn-ghost"
        style={{ padding: '4px 8px', fontSize: 11, color: 'var(--red, #b00)' }}
        title={error}
      >
        Error — tap
      </button>
    );
  }

  if (confirming) {
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button
          type="button"
          onClick={doDelete}
          disabled={pending}
          className="btn-ghost"
          style={{ padding: '4px 8px', fontSize: 11, color: 'var(--red, #b00)', fontWeight: 700 }}
        >
          {pending ? '…' : 'Remove'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="btn-ghost"
          style={{ padding: '4px 6px', fontSize: 11, color: 'var(--muted)' }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="btn-ghost"
      style={{ padding: 4, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center' }}
      title="Remove this event"
    >
      <Trash2 size={13} />
    </button>
  );
}
