import Link from 'next/link';

// 404 — a deleted field, a stale bookmark, a mistyped share link.

export default function NotFound() {
  return (
    <main style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="card" style={{ maxWidth: 420, width: '100%', padding: 24, textAlign: 'center' }}>
        <h1 className="display" style={{ fontSize: 22, margin: '0 0 8px' }}>Page not found</h1>
        <p style={{ color: 'var(--ink-soft)', fontSize: 15, lineHeight: 1.5, margin: '0 0 18px' }}>
          This page doesn&rsquo;t exist — it may have been deleted, or the link is out of date.
        </p>
        <Link href="/" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
          Back to the farm
        </Link>
      </div>
    </main>
  );
}
