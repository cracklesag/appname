'use client';

// Last-resort boundary: catches errors thrown in the root layout, where
// app/error.tsx can't help. Must render its own <html>/<body> because the
// layout is what failed. Inline styles only — globals.css may not have loaded.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#F7F5EE', color: '#26301F' }}>
        <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 420, width: '100%', padding: 24, textAlign: 'center', background: '#fff', border: '1px solid #E0DCCB', borderRadius: 6 }}>
            <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Swardly hit a problem</h1>
            <p style={{ fontSize: 15, lineHeight: 1.5, margin: '0 0 18px', color: '#55604A' }}>
              Something broke loading the app. Your farm data is safe — try reloading.
            </p>
            {error?.digest && (
              <p style={{ fontSize: 12, margin: '0 0 14px', color: '#8A927E' }}>Ref: {error.digest}</p>
            )}
            <button
              type="button"
              onClick={() => reset()}
              style={{ background: '#3B5A3A', color: '#F7F5EE', fontWeight: 700, border: 'none', padding: '14px 20px', borderRadius: 4, fontSize: 16, cursor: 'pointer' }}
            >
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
