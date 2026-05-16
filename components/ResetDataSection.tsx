'use client';

import { useState } from 'react';
import { Trash2, AlertCircle } from 'lucide-react';
import { resetAllData } from '@/lib/actions';
import { ErrorBanner } from './InlineWarning';

export function ResetDataSection() {
  const [expanded, setExpanded] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const matches = confirm.trim() === 'DELETE';

  async function handleReset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      await resetAllData(fd);
    } catch (err) {
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) {
        setError(err.message);
      }
      setSubmitting(false);
    }
  }

  if (!expanded) {
    return (
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="label" style={{ marginBottom: 6 }}>Reset data</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
          Removes all fields, applications, and cuts on your account. Settings and
          login are kept. Useful for trying things out or starting fresh.
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            background: 'transparent',
            color: 'var(--red)',
            border: '1px solid var(--red-soft)',
            borderRadius: 4,
            padding: '8px 12px',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Trash2 size={13} /> Reset all data…
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 14, marginBottom: 14, background: 'var(--red-soft)', borderColor: 'var(--red)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
        <AlertCircle size={16} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontSize: 13, color: 'var(--red)', fontWeight: 700, marginBottom: 4 }}>
            Reset all data
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
            This removes every field, application, and cut on your account.
            There is no undo. Type <strong>DELETE</strong> (capitals) below to
            confirm.
          </div>
        </div>
      </div>

      <form onSubmit={handleReset}>
        <input
          type="text"
          name="confirm"
          className="input"
          placeholder='Type "DELETE" to confirm'
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
          style={{ marginBottom: 10, background: 'var(--card)' }}
        />
        <ErrorBanner error={error} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => { setExpanded(false); setConfirm(''); setError(null); }}
            style={{
              flex: 1,
              background: 'transparent',
              color: 'var(--ink-soft)',
              border: '1px solid var(--line)',
              borderRadius: 4,
              padding: '10px 12px',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!matches || submitting}
            style={{
              flex: 2,
              background: matches ? 'var(--red)' : 'var(--muted)',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              padding: '10px 12px',
              fontSize: 14,
              fontWeight: 700,
              cursor: matches && !submitting ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Trash2 size={14} />
            {submitting ? 'Resetting…' : 'Reset everything'}
          </button>
        </div>
      </form>
    </div>
  );
}
