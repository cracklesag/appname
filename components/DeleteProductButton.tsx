'use client';

import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { deleteCustomProduct } from '@/lib/actions';

export function DeleteProductButton({ productId }: { productId: number }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function doDelete() {
    setError(null);
    const fd = new FormData();
    fd.set('id', String(productId));
    start(async () => {
      try {
        await deleteCustomProduct(fd);
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
      <div style={{ maxWidth: 220, textAlign: 'right' }}>
        <div style={{ fontSize: 11, color: 'var(--red, #b00)', lineHeight: 1.4, marginBottom: 4 }}>{error}</div>
        <button
          type="button"
          onClick={() => setError(null)}
          className="btn-ghost"
          style={{ padding: '4px 8px', fontSize: 11, color: 'var(--muted)' }}
        >
          OK
        </button>
      </div>
    );
  }

  if (confirming) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          type="button"
          onClick={doDelete}
          disabled={pending}
          className="btn-ghost"
          style={{ padding: '6px 10px', fontSize: 12, color: 'var(--red, #b00)', fontWeight: 700 }}
        >
          {pending ? 'Deleting…' : 'Confirm'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="btn-ghost"
          style={{ padding: '6px 8px', fontSize: 12, color: 'var(--muted)' }}
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
      style={{ padding: '6px 10px', fontSize: 12, color: 'var(--red, #b00)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      title="Delete this product"
    >
      <Trash2 size={14} /> Delete
    </button>
  );
}
