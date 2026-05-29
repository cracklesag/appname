'use client';

import { useState } from 'react';
import { Copy, Check, X } from 'lucide-react';

export function InviteCodeCard({
  code,
  id,
  label,
  deleteAction,
}: {
  code: string;
  id: string;
  label: string | null;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be blocked; the code is visible to type manually */
    }
  }

  return (
    <div className="card" style={{ padding: '12px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 19, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--ink)' }}>{code}</div>
        {label && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{label}</div>}
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: copied ? 'var(--forest-soft)' : 'var(--paper-deep)', border: '1px solid var(--line)', borderRadius: 7, padding: '7px 10px', fontSize: 12, fontWeight: 700, color: copied ? 'var(--forest-dark)' : 'var(--ink-soft)', fontFamily: 'inherit', cursor: 'pointer' }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
      </button>
      <form action={deleteAction}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" aria-label="Revoke code" style={{ display: 'inline-flex', alignItems: 'center', background: 'none', border: '1px solid var(--line)', borderRadius: 7, padding: '7px 8px', color: 'var(--muted)', cursor: 'pointer' }}>
          <X size={14} />
        </button>
      </form>
    </div>
  );
}
