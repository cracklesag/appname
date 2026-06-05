'use client';

import { useState } from 'react';
import { UserX, AlertCircle } from 'lucide-react';
import { deleteMyAccount } from '@/lib/actions';
import { ErrorBanner } from './InlineWarning';

/**
 * "Delete account" — irreversible. Mirrors ResetDataSection's
 * expand → type DELETE → confirm flow, but the consequences depend on the
 * user's role on their resolved farm:
 *   - admin: deletes their account AND the entire farm (Postgres cascade
 *     removes every owned row); any staff lose access.
 *   - staff: deletes their account and removes them from the farm; the farm's
 *     records are owned by the admin and are untouched.
 * The server action keys deletion on the signed-in auth user, so the cascade
 * does the right thing in both cases.
 */
export function DeleteAccountSection({
  isAdmin,
  staffCount,
  farmName,
}: {
  isAdmin: boolean;
  staffCount: number;
  farmName: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const matches = confirm.trim() === 'DELETE';
  const farm = farmName?.trim() ? farmName.trim() : 'this farm';

  async function handleDelete(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      await deleteMyAccount(fd);
    } catch (err) {
      // A successful deletion redirects, which surfaces as a NEXT_REDIRECT
      // "error" — let that through. Anything else is a real failure.
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) {
        setError(err.message);
      }
      setSubmitting(false);
    }
  }

  if (!expanded) {
    return (
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="label" style={{ marginBottom: 6 }}>Delete account</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
          {isAdmin
            ? `Permanently deletes your account and ${farm} — every field, record, product, group and setting. There is no undo.`
            : `Permanently deletes your account and removes you from ${farm}. The farm\u2019s records belong to the admin and are not affected.`}
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
          <UserX size={13} /> Delete my account…
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
            Delete account permanently
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
            {isAdmin ? (
              <>
                This deletes your account and the <strong>entire farm</strong> — every
                field, cut, fertiliser, slurry, manure and lime record, custom product,
                group, grass system and setting.
                {staffCount > 0 && (
                  <> {' '}
                    <strong>
                      {staffCount} staff member{staffCount === 1 ? '' : 's'}
                    </strong>{' '}
                    will lose access to this farm.
                  </>
                )}{' '}
                There is no undo. Type <strong>DELETE</strong> (capitals) to confirm.
              </>
            ) : (
              <>
                This deletes your account and removes you from <strong>{farm}</strong>.
                The farm&apos;s records belong to the admin and will not be affected.
                There is no undo. Type <strong>DELETE</strong> (capitals) to confirm.
              </>
            )}
          </div>
        </div>
      </div>

      <form onSubmit={handleDelete}>
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
            <UserX size={14} />
            {submitting ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
      </form>
    </div>
  );
}
