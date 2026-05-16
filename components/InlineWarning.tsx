import { AlertCircle } from 'lucide-react';
import { FieldWarning } from '@/lib/validation';

export function InlineWarning({ warning }: { warning: FieldWarning }) {
  if (!warning) return null;
  const isError = warning.kind === 'error';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 6,
        marginTop: 6,
        fontSize: 11,
        color: isError ? 'var(--red)' : 'var(--amber)',
        fontWeight: 700,
        lineHeight: 1.4,
      }}
    >
      <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{warning.message}</span>
    </div>
  );
}

// A larger banner-style error for above the submit button
export function ErrorBanner({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <div
      className="card"
      style={{
        padding: 12,
        marginBottom: 14,
        background: 'var(--red-soft)',
        borderColor: 'var(--red)',
        color: 'var(--red)',
        fontSize: 13,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
      }}
    >
      <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{error}</span>
    </div>
  );
}
