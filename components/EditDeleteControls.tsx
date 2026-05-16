'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Edit3, Trash2 } from 'lucide-react';

export function EditDeleteControls({
  editHref,
  deleteAction,
  hiddenInputs,
  label = 'item',
}: {
  editHref: string;
  deleteAction: (formData: FormData) => Promise<void>;
  hiddenInputs: Record<string, string>;
  label?: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--red)', fontWeight: 700, marginRight: 4 }}>
          Delete this {label}?
        </span>
        <form action={deleteAction} style={{ display: 'inline' }}>
          {Object.entries(hiddenInputs).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <button
            type="submit"
            style={{
              background: 'var(--red)',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Yes, delete
          </button>
        </form>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          style={{
            background: 'transparent',
            color: 'var(--ink-soft)',
            border: '1px solid var(--line)',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <Link
        href={editHref}
        style={{
          background: 'transparent',
          color: 'var(--ink-soft)',
          border: '1px solid var(--line)',
          borderRadius: 4,
          padding: '5px 9px',
          fontSize: 11,
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          textDecoration: 'none',
        }}
      >
        <Edit3 size={11} /> Edit
      </Link>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        style={{
          background: 'transparent',
          color: 'var(--red)',
          border: '1px solid var(--red-soft)',
          borderRadius: 4,
          padding: '5px 9px',
          fontSize: 11,
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
        }}
      >
        <Trash2 size={11} /> Delete
      </button>
    </div>
  );
}
