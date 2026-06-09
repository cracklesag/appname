'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export function CopyText({ value, mono = false }: { value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="input" style={{ flex: 1, fontFamily: mono ? 'ui-monospace, monospace' : undefined, fontWeight: mono ? 700 : undefined, letterSpacing: mono ? '0.08em' : undefined }} />
      <button type="button" onClick={copy} className="btn-ghost" style={{ padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}
