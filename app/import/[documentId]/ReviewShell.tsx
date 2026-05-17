'use client';

import { CheckCircle2 } from 'lucide-react';
import { ImportDocument, ExtractedSample } from '@/lib/types';

/**
 * Session 1 minimal review shell.
 *
 * Just lists the extracted samples in a basic table so we can confirm the
 * upload → extract → display pipeline works end-to-end. Session 2 replaces
 * this with the real review UI (inline editing, field-match dropdown,
 * accept/reject, finalise button).
 */
export function ReviewShell({
  document,
  samples,
}: {
  document: ImportDocument;
  samples: ExtractedSample[];
}) {
  const isCommitted = document.status === 'committed';

  return (
    <div style={{ padding: 16 }}>
      <div
        className="card"
        style={{
          padding: 14,
          marginBottom: 14,
          background: isCommitted ? 'var(--forest-soft)' : 'var(--card)',
          borderColor: isCommitted ? 'var(--forest)' : 'var(--line)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 14,
            fontWeight: 700,
            color: isCommitted ? 'var(--forest-dark)' : 'var(--ink)',
          }}
        >
          {isCommitted && <CheckCircle2 size={18} />}
          {isCommitted
            ? 'This document has been committed.'
            : `${samples.length} sample${samples.length === 1 ? '' : 's'} extracted — ready for review.`}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
          {document.original_filename} · uploaded{' '}
          {new Date(document.created_at).toLocaleString()}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--paper)',
            borderBottom: '1px solid var(--line)',
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--ink-soft)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Extracted samples
        </div>
        {samples.length === 0 ? (
          <div style={{ padding: 14, fontSize: 13, color: 'var(--muted)' }}>
            No samples were extracted from this document.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--paper)' }}>
                  <Th>Sample ref</Th>
                  <Th>Date</Th>
                  <Th>pH</Th>
                  <Th>P ppm</Th>
                  <Th>P idx</Th>
                  <Th>K ppm</Th>
                  <Th>K idx</Th>
                  <Th>Mg ppm</Th>
                  <Th>Mg idx</Th>
                </tr>
              </thead>
              <tbody>
                {samples.map((s) => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--line-soft)' }}>
                    <Td><strong>{s.lab_sample_label ?? '—'}</strong></Td>
                    <Td>{s.sample_date ?? '—'}</Td>
                    <Td>{fmt(s.ph)}</Td>
                    <Td>{fmt(s.p_ppm)}</Td>
                    <Td>{fmt(s.p_index)}</Td>
                    <Td>{fmt(s.k_ppm)}</Td>
                    <Td>{fmt(s.k_index)}</Td>
                    <Td>{fmt(s.mg_ppm)}</Td>
                    <Td>{fmt(s.mg_index)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: 14,
          fontSize: 12,
          color: 'var(--muted)',
          fontStyle: 'italic',
          lineHeight: 1.5,
        }}
      >
        Session 1 view — minimal table for verifying the pipeline. The full review UI
        (inline editing, field-match dropdown, accept/reject, finalise) lands in
        Session 2.
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: '10px 12px',
        textAlign: 'left',
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--ink-soft)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
      {children}
    </td>
  );
}

function fmt(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return Number(n).toString();
}
