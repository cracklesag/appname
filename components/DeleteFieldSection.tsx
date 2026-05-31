'use client';

import { useState } from 'react';
import { Trash2, AlertCircle } from 'lucide-react';
import { deleteField } from '@/lib/actions';
import { ErrorBanner } from './InlineWarning';

export function DeleteFieldSection({ fieldId, fieldName }: { fieldId: string; fieldName: string }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Tolerant match: ignore case, collapse whitespace, and treat smart quotes
  // the same as straight ones. A field like "Bernard's beck side" displays a
  // curly apostrophe (’) but most keyboards type a straight one ('), which a
  // strict === would reject — leaving the button stuck greyed out.
  const normalise = (s: string) =>
    s
      .replace(/[\u2018\u2019\u201B\u02BC]/g, "'") // curly/odd apostrophes → '
      .replace(/[\u201C\u201D]/g, '"')             // curly double quotes → "
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const matches = normalise(confirmName) === normalise(fieldName);

  async function handleDelete(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      await deleteField(fd);
    } catch (err) {
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) {
        setError(err.message);
      }
      setSubmitting(false);
    }
  }

  if (!expanded) {
    return (
      <div className="card" style={{ padding: 14, marginTop: 14, borderColor: 'var(--line)' }}>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--red)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Trash2 size={14} /> Delete this field
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Expand</span>
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 14, marginTop: 14, background: 'var(--red-soft)', borderColor: 'var(--red)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
        <AlertCircle size={16} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontSize: 13, color: 'var(--red)', fontWeight: 700, marginBottom: 4 }}>
            This permanently deletes {fieldName}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
            All applications, cuts, and history for this field will be removed. There is no
            undo. To proceed, type the field name <strong>exactly</strong> below.
          </div>
        </div>
      </div>

      <form onSubmit={handleDelete}>
        <input type="hidden" name="field_id" value={fieldId} />
        <input
          type="text"
          name="confirm_name"
          className="input"
          placeholder={`Type "${fieldName}" to confirm`}
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          autoComplete="off"
          style={{ marginBottom: 10, background: 'var(--card)' }}
        />
        <ErrorBanner error={error} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => { setExpanded(false); setConfirmName(''); setError(null); }}
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
            {submitting ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </form>
    </div>
  );
}
