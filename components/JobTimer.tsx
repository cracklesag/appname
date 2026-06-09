'use client';

import { useEffect, useState } from 'react';
import { Play, Square, Clock } from 'lucide-react';
import { startJobTimer, stopJobTimer, setJobMinutes } from '@/lib/actions';

function fmt(totalMin: number) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function JobTimer({ jobId, workStartedAt, workMinutes, editable }: { jobId: string; workStartedAt: string | null; workMinutes: number | null; editable: boolean }) {
  const running = !!workStartedAt;
  const [elapsedSec, setElapsedSec] = useState(0);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!running || !workStartedAt) return;
    const start = new Date(workStartedAt).getTime();
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [running, workStartedAt]);

  const baseMin = workMinutes ?? 0;
  const liveMin = running ? baseMin + Math.floor(elapsedSec / 60) : baseMin;
  const liveSecPart = running ? elapsedSec % 60 : 0;

  if (!editable) {
    if (baseMin === 0 && !running) return null;
    return (
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="label" style={{ marginBottom: 4 }}>Time taken</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>{fmt(liveMin)}</div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Clock size={16} style={{ color: 'var(--forest)' }} />
        <div className="label" style={{ margin: 0 }}>Time on this job</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: running ? 'var(--forest-dark)' : 'var(--ink)' }}>
          {fmt(liveMin)}{running && <span style={{ fontSize: 14, color: 'var(--muted)', marginLeft: 6 }}>{String(liveSecPart).padStart(2, '0')}s</span>}
        </div>
        {running ? (
          <form action={stopJobTimer}>
            <input type="hidden" name="id" value={jobId} />
            <button type="submit" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--clay, #b06a37)' }}><Square size={15} /> Stop</button>
          </form>
        ) : (
          <form action={startJobTimer}>
            <input type="hidden" name="id" value={jobId} />
            <button type="submit" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Play size={15} /> {baseMin > 0 ? 'Resume' : 'Start'}</button>
          </form>
        )}
      </div>
      {!running && (
        <div style={{ marginTop: 10 }}>
          {editing ? (
            <form action={setJobMinutes} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="hidden" name="id" value={jobId} />
              <input type="number" name="minutes" min="0" step="1" defaultValue={baseMin || ''} className="input" placeholder="minutes" style={{ flex: 1 }} />
              <button type="submit" className="btn-ghost">Save</button>
            </form>
          ) : (
            <button type="button" onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', color: 'var(--forest)', fontSize: 12.5, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Enter time manually</button>
          )}
        </div>
      )}
    </div>
  );
}
