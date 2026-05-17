'use client';

import { useState } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { ImportDocument } from '@/lib/types';
import { retryExtraction } from '@/lib/actions';

export function FailedView({ document }: { document: ImportDocument }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRetry() {
    setSubmitting(true);
    setError(null);
    try {
      await retryExtraction(document.id);
      // server redirects on success
    } catch (err) {
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) {
        setError(err.message);
      }
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div
        className="card"
        style={{
          padding: 14,
          marginBottom: 14,
          background: 'var(--red-soft)',
          borderColor: 'var(--red)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            marginBottom: 10,
          }}
        >
          <AlertCircle size={18} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--red)' }}>
              Extraction failed
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 4, lineHeight: 1.5 }}>
              {document.error_message ||
                'Something went wrong while extracting samples from this PDF.'}
            </div>
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: 10,
              borderRadius: 4,
              background: 'var(--card)',
              border: '1px solid var(--red)',
              color: 'var(--red)',
              fontSize: 12,
              marginBottom: 10,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleRetry}
          disabled={submitting}
          className="btn-primary"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <RotateCcw size={14} />
          {submitting ? 'Retrying…' : 'Try again'}
        </button>
      </div>

      <div
        style={{
          fontSize: 12,
          color: 'var(--muted)',
          fontStyle: 'italic',
          lineHeight: 1.5,
        }}
      >
        Re-extraction uses the same PDF that's already uploaded. If the same error
        keeps happening, the PDF format may not be supported yet.
      </div>
    </div>
  );
}
