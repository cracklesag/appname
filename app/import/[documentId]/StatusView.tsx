'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { ImportDocument, DocumentStatus } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';

const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATES: DocumentStatus[] = [
  'ready_for_review',
  'committed',
  'failed',
  'discarded',
];

export function StatusView({ document }: { document: ImportDocument }) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const [currentStatus, setCurrentStatus] = useState<DocumentStatus>(document.status);

  // Tick a counter so the user sees the timer moving — feels alive
  useEffect(() => {
    const startedAt = new Date(document.created_at).getTime();
    const tick = () => setElapsed(Math.round((Date.now() - startedAt) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [document.created_at]);

  // Poll for status; when it leaves processing/queued, refresh the page
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function check() {
      if (cancelled) return;
      const { data, error } = await supabase
        .from('documents')
        .select('status')
        .eq('id', document.id)
        .maybeSingle();
      if (cancelled) return;
      if (!error && data) {
        const status = data.status as DocumentStatus;
        setCurrentStatus(status);
        if (TERMINAL_STATES.includes(status)) {
          // Server-rendered switch to the appropriate view
          router.refresh();
          return;
        }
      }
      setTimeout(check, POLL_INTERVAL_MS);
    }

    const handle = setTimeout(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [document.id, router]);

  const message =
    currentStatus === 'queued'
      ? 'Waiting in queue…'
      : 'Extracting samples from your PDF…';

  return (
    <div style={{ padding: 16 }}>
      <div
        className="card"
        style={{
          padding: 28,
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <Loader2
          size={36}
          style={{
            color: 'var(--forest)',
            animation: 'spin 1.2s linear infinite',
          }}
        />
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{message}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, maxWidth: 360 }}>
          This usually takes 20–60 seconds for a typical soil report. You can leave
          this page and come back; we'll be ready when you return.
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Elapsed: {elapsed}s
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
