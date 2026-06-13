'use client';

// Route error boundary. Catches anything thrown during render or by a server
// action invoked from a plain <form action={...}> (dozens of actions throw
// new Error(...)). Without this file, production users got Next's unstyled
// default crash screen. error.message from a server action is Next's
// sanitised text in production; we show our own copy and keep the digest for
// support. reset() re-renders the segment — usually all that's needed after
// a transient Supabase hiccup.

import { useEffect } from 'react';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface in the browser console / Vercel logs for diagnosis.
    console.error('[route error]', error);
  }, [error]);

  return (
    <main style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="card" style={{ maxWidth: 420, width: '100%', padding: 24, textAlign: 'center' }}>
        <h1 className="display" style={{ fontSize: 22, margin: '0 0 8px' }}>That didn&rsquo;t save</h1>
        <p style={{ color: 'var(--ink-soft)', fontSize: 15, lineHeight: 1.5, margin: '0 0 6px' }}>
          Something went wrong on our side — nothing you logged has been lost from earlier,
          but this last action didn&rsquo;t go through.
        </p>
        <p style={{ color: 'var(--ink-soft)', fontSize: 14, lineHeight: 1.5, margin: '0 0 18px' }}>
          Try again — if it keeps happening, check your signal and give it a minute.
        </p>
        {error?.digest && (
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 14px' }}>Ref: {error.digest}</p>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button type="button" className="btn-primary" onClick={() => reset()}>
            Try again
          </button>
          <a href="/" className="btn-ghost" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Go home
          </a>
        </div>
      </div>
    </main>
  );
}
