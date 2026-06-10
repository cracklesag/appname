'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { listQueue, updateQueue, rebuildFormData, isOfflineError, QUEUE_EVENT, type QueueItem } from '@/lib/offline/queue';
import { createSprayRecord, saveJobCompletion, submitSharedJob } from '@/lib/actions';

// Mounted once in the root layout. Drains the offline queue whenever signal
// returns (online event), on a slow heartbeat, or when the pill is tapped.
// A server action that redirects throws NEXT_REDIRECT — that's success here.

let draining = false;

export function OfflineSync() {
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const refreshCount = useCallback(async () => {
    setCount((await listQueue()).length);
  }, []);

  const drain = useCallback(async () => {
    if (draining) return;
    draining = true;
    setBusy(true);
    try {
      let items = await listQueue();
      if (items.length === 0) return;
      const remaining: QueueItem[] = [];
      for (const item of items) {
        let ok = false;
        try {
          if (item.kind === 'spray_record' && item.fd) {
            await createSprayRecord(rebuildFormData(item.fd));
            ok = true;
          } else if (item.kind === 'job_completion' && item.fd) {
            await saveJobCompletion(rebuildFormData(item.fd));
            ok = true;
          } else if (item.kind === 'shared_job' && item.args) {
            const res = await submitSharedJob(item.args.token, item.args.pin || undefined, item.args.completionsJson);
            ok = !!res.ok;
            if (!ok) item.lastError = res.error ?? 'Rejected';
          } else {
            ok = true; // malformed entry — drop rather than wedge the queue
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) {
            ok = true; // action succeeded and tried to redirect
          } else {
            item.attempts += 1;
            item.lastError = err instanceof Error ? err.message.slice(0, 200) : 'Failed';
            // Offline again → keep and stop hammering. A real server rejection
            // also stays (data is never silently dropped) but waits for the
            // next drain rather than blocking this one.
            if (isOfflineError(err)) { remaining.push(item, ...items.slice(items.indexOf(item) + 1)); await updateQueue(remaining); return; }
          }
        }
        if (!ok) remaining.push(item);
      }
      await updateQueue(remaining);
    } finally {
      draining = false;
      setBusy(false);
      refreshCount();
    }
  }, [refreshCount]);

  useEffect(() => {
    refreshCount();
    const onChange = () => refreshCount();
    const onOnline = () => drain();
    window.addEventListener(QUEUE_EVENT, onChange);
    window.addEventListener('online', onOnline);
    const iv = setInterval(async () => {
      if ((await listQueue()).length > 0 && navigator.onLine) drain();
    }, 25000);
    // one attempt shortly after load (e.g. app reopened in signal)
    const t = setTimeout(() => { drain(); }, 2500);
    return () => {
      window.removeEventListener(QUEUE_EVENT, onChange);
      window.removeEventListener('online', onOnline);
      clearInterval(iv);
      clearTimeout(t);
    };
  }, [drain, refreshCount]);

  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={() => drain()}
      style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 72px)', zIndex: 1500, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 99, border: 'none', background: '#b06a37', color: '#fff', fontSize: 13, fontWeight: 700, boxShadow: '0 3px 12px rgba(0,0,0,0.25)', cursor: 'pointer', fontFamily: 'inherit' }}
    >
      <RefreshCw size={14} style={busy ? { animation: 'spin 1s linear infinite' } : undefined} />
      {busy ? 'Syncing…' : `${count} waiting to sync — tap to retry`}
    </button>
  );
}
