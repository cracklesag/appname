'use client';

import { useState } from 'react';
import { Link2, Copy, Check } from 'lucide-react';
import { createShareLink, revokeShareLink } from '@/lib/actions';

export function ShareLinkPanel({ jobId, shareUrl, pin, expiresAt }: { jobId: string; shareUrl: string | null; pin: string | null; expiresAt: string | null }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!shareUrl) return;
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  if (shareUrl) {
    return (
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="label" style={{ marginBottom: 8 }}>Share link</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input readOnly value={shareUrl} className="input" style={{ flex: 1, fontSize: 12 }} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={copy} className="btn-ghost" style={{ padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.45 }}>
          Anyone with this link can open the job in a browser{pin ? <> · PIN <strong>{pin}</strong></> : ''}.{expiresAt ? ` Expires ${new Date(expiresAt).toLocaleDateString()}.` : ' No expiry.'}
        </div>
        <form action={revokeShareLink}>
          <input type="hidden" name="id" value={jobId} />
          <button type="submit" className="btn-ghost" style={{ color: 'var(--clay, #b06a37)' }}>Revoke link</button>
        </form>
      </div>
    );
  }

  return (
    <form action={createShareLink} className="card" style={{ padding: 14, marginBottom: 14 }}>
      <input type="hidden" name="id" value={jobId} />
      <div className="label" style={{ marginBottom: 8 }}>Share link <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--muted)' }}>· for someone without the app</span></div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input type="text" name="pin" className="input" placeholder="PIN (optional)" inputMode="numeric" maxLength={12} style={{ flex: 1 }} />
        <select name="expiry_days" className="input" defaultValue="30" style={{ flex: 1 }}>
          <option value="7">7 days</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="never">No expiry</option>
        </select>
      </div>
      <button type="submit" className="btn-primary" style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Link2 size={16} /> Create share link</button>
    </form>
  );
}
