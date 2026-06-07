import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

const row = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px', textDecoration: 'none', color: 'var(--ink)',
} as const;

export function LegalLinksSection() {
  return (
    <>
      <div style={{
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.06em', color: 'var(--muted)',
        marginBottom: 8, marginTop: 18, paddingLeft: 2,
      }}>
        Legal &amp; privacy
      </div>
      <div className="card" style={{ padding: 0, marginBottom: 14, overflow: 'hidden' }}>
        <Link href="/terms" style={{ ...row, borderBottom: '1px solid var(--line-soft)' }}>
          <span style={{ fontSize: 14 }}>Terms of Service</span>
          <ChevronRight size={16} style={{ color: 'var(--muted)' }} />
        </Link>
        <Link href="/privacy" style={{ ...row, borderBottom: '1px solid var(--line-soft)' }}>
          <span style={{ fontSize: 14 }}>Privacy Policy</span>
          <ChevronRight size={16} style={{ color: 'var(--muted)' }} />
        </Link>
        <Link href="/disclaimer" style={row}>
          <span style={{ fontSize: 14 }}>Disclaimer</span>
          <ChevronRight size={16} style={{ color: 'var(--muted)' }} />
        </Link>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginBottom: 16, lineHeight: 1.5 }}>
        Swardly · <a href="mailto:[CONTACT EMAIL]" style={{ color: 'var(--muted)', textDecoration: 'underline' }}>[CONTACT EMAIL]</a>
      </div>
    </>
  );
}
