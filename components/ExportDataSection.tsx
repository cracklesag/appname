'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { ErrorBanner } from './InlineWarning';

/**
 * "Export my data" — fetches /api/account/export and saves the returned JSON
 * file. Same-origin fetch carries the auth cookie; the route scopes the export
 * to the user's resolved farm.
 */
export function ExportDataSection() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/account/export', { method: 'GET' });
      if (!res.ok) {
        let msg = 'Could not prepare your export. Please try again.';
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          // non-JSON error body — keep the default message
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `swardly-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare your export.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 14, marginBottom: 14 }}>
      <div className="label" style={{ marginBottom: 6 }}>Export my data</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
        Download a copy of your farm&apos;s records — fields, cuts, fertiliser,
        slurry, manure, lime, soil, products and settings — as a JSON file you
        can keep as a backup or take elsewhere.
      </div>
      <button
        type="button"
        onClick={handleDownload}
        disabled={busy}
        style={{
          background: 'transparent',
          color: 'var(--forest-dark)',
          border: '1px solid var(--line)',
          borderRadius: 4,
          padding: '8px 12px',
          fontSize: 13,
          fontWeight: 700,
          cursor: busy ? 'not-allowed' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Download size={14} /> {busy ? 'Preparing…' : 'Download my data'}
      </button>
      <div style={{ marginTop: error ? 10 : 0 }}>
        <ErrorBanner error={error} />
      </div>
    </div>
  );
}
